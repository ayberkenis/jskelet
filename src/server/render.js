/**
 * EJS render katmanı + HTML TTL cache (ISR ikamesi).
 *
 * Controller sözleşmesi:
 *   async (ctx) => { view, data?, metadata?, status?, revalidate?, head?,
 *                    bodyClass?, entries? }
 * `ctx` → { params, query, pathname, req }
 *
 * `route()` üç kapsamı belirli bir sırayla iç içe kurar:
 *   withHtmlCache( withUpstreamTracking( withRequestCache( controller ) ) )
 * Sıra önemli — istek içi cache en içte olmalı ki aynı render'daki iki
 * çağrı tek upstream isteğine düşsün; upstream takibi HTML cache'in içinde
 * olmalı ki eksik veriyle üretilen çıktı önbelleğe yazılmasın.
 */
import path from "node:path";
import process from "node:process";
import ejs from "ejs";
import { withHtmlCache } from "./html-cache.js";
import { getConfig, hook } from "../config/index.js";
import { matchPattern } from "../config/pattern.js";
import { encodeText, negotiateEncoding } from "./middleware/compression.js";
import { navigationHints, preconnectHints } from "./head-hints.js";
import { withRequestCache } from "../http/request-cache.js";
import {
  createRequestContext,
  getRequestContext,
  guardRequest,
  withRequestContext,
} from "../http/request-context.js";
import {
  getUpstreamFailures,
  isTransientStatus,
  withUpstreamTracking,
} from "./upstream-tracking.js";
import { isNotFoundError, isRedirectError } from "../http/control-flow.js";
import { renderHeadMeta } from "./metadata.js";
import { asset, hasAsset } from "./assets.js";
import * as html from "../views/helpers/html.js";
import * as tags from "../views/helpers/tags.js";
import { loadComponents } from "../views/components/loader.js";
import { renderStatusPage } from "./status-page.js";
import { suppressForPrewarm } from "./prewarm.js";

const isDev = process.env.NODE_ENV === "development";

/**
 * Şablonlara otomatik geçen yardımcılar ve EJS ayarları. Bileşen taraması
 * dosya sistemine dokunduğu için bir kez yapılır; config yüklenmeden
 * hesaplanamaz, bu yüzden ilk render'da kurulur.
 *
 * @type {{ helpers: Record<string, unknown>, options: ejs.Options,
 *   viewsDir: string, layout: string } | null}
 */
let engine = null;

/**
 * @returns {Promise<NonNullable<typeof engine>>}
 */
async function getEngine() {
  if (engine) return engine;

  const config = getConfig();
  const viewsDir = config.dirs.views;

  engine = {
    viewsDir,
    layout: config.layout,
    helpers: {
      ...html,
      ...tags,
      ...(await loadComponents(path.join(viewsDir, "components"))),
      asset,
      hasAsset,
    },
    options: {
      // `include('partials/header')` gibi çağrılar views kökünden çözülür.
      root: viewsDir,
      views: [viewsDir],
      cache: !isDev,
      rmWhitespace: true,
      async: true,
    },
  };

  return engine;
}

/**
 * Uygulama geliştirirken bileşen dosyaları değişince kayıt yenilenmeli.
 * Dev sunucusu süreci yeniden başlattığı için normalde gerekmez; gömülü
 * kullanımlar (test, script) için dışa açık.
 *
 * @returns {void}
 */
export function resetRenderEngine() {
  engine = null;
}

/**
 * Layout kullanmadan tek bir şablon render eder. Fragment/partial uçları
 * ve e-posta şablonları bunu kullanır.
 *
 * @param {string} view `views/` altındaki yol, uzantısız (örn. "pages/home")
 * @param {object} [data]
 * @returns {Promise<string>}
 */
export async function renderView(view, data = {}) {
  const { viewsDir, helpers, options } = await getEngine();
  const file = path.join(viewsDir, `${view}.ejs`);
  return ejs.renderFile(file, { ...helpers, ...data }, options);
}

/**
 * Sayfayı layout içinde render eder.
 *
 * @param {{ view: string, data?: object, metadata?: object, head?: string,
 *   bodyClass?: string, entries?: string[], pathname?: string }} page
 * @returns {Promise<string>}
 */
export async function renderPage(page) {
  const { helpers, options, layout } = await getEngine();
  const config = getConfig();

  const metadata = {
    ...(await hook("metadata", {}, page)),
    ...(page.metadata ?? {}),
  };

  // Layout bağlamı ve gövde paralel üretilir: navigasyon çoğu projede
  // upstream'den geliyor ve gövde render'ıyla sırayla beklemek her sayfaya
  // gereksiz gecikme ekliyor.
  const [body, context] = await Promise.all([
    renderView(page.view, { ...(page.data ?? {}), metadata }),
    hook("layoutContext", {}, { pathname: page.pathname ?? "", metadata }),
  ]);

  return ejs.renderFile(
    layout,
    {
      ...helpers,
      ...context,
      metadata,
      // Boş varsayılan bilinçli: "/" yazmak her sayfayı ana sayfa sanıp
      // logoyu <h1> olarak bastıran türde hatalara yol açıyor.
      pathname: page.pathname ?? "",
      lang: context.lang ?? config.brand.lang ?? "en",
      headMeta: renderHeadMeta(metadata),
      structuredData: context.structuredData ?? [],
      // Preconnect her sayfada aynı; LCP preload'ını sayfa kendisi ekler.
      // Gezinme ipuçları preconnect'ten sonra: spekülasyon bir sonraki sayfayı
      // ilgilendiriyor, bu sayfanın LCP'sinin önüne geçmemeli.
      extraHead:
        preconnectHints() +
        navigationHints() +
        (page.head ?? "") +
        (context.extraHead ?? ""),
      bodyClass: page.bodyClass ?? context.bodyClass ?? "",
      entries: page.entries ?? [],
      devtools: isDev,
      devBasePath: config.brand.devBasePath,
      body,
    },
    options,
  );
}

/**
 * Kişiye özel yanıtın cache direktifi. Dinamik (cache'lenmeyen) her sayfa da
 * bunu alır: bir yanıt hiçbir direktif taşımadığında HTTP onu "sezgisel olarak
 * cache'lenebilir" sayar ve araya giren bir proxy ya da tarayıcının geri
 * tuşu kullanıcıya özel HTML'i saklayabilir.
 */
const PRIVATE_CACHE = "private, no-store";

/**
 * Controller'ı çalıştırıp yanıtı yazar; notFound/redirect kontrol akışını,
 * HTML cache'ini ve hata yönetimini üstlenir.
 *
 * `private: true` kişiye özel sayfaları public cache yolundan tamamen ayırır:
 * HTML cache devre dışı kalır, config'in `cache.html` deseni bu kararı
 * ezemez, yanıt `no-store` ile ve ETag'siz gider. Dashboard tipi sayfalarda
 * bu bayrak olmadan çalışmak, bir kullanıcının HTML'inin bir başkasına
 * servis edilmesi anlamına gelir.
 *
 * @param {(ctx: { params: object, query: object, pathname: string,
 *   req: import('express').Request }) => Promise<object>} controller
 * @param {{ revalidate?: number, private?: boolean }} [options]
 * @returns {import('express').RequestHandler}
 */
export function route(controller, options = {}) {
  const isPrivate = options.private === true;

  return async (req, res, next) => {
    const context = createRequestContext({ private: isPrivate, res });
    const ctx = {
      params: req.params ?? {},
      query: req.query ?? {},
      pathname: req.path,
      // Cookie/Authorization okunursa çıktı kullanıcıya bağlıdır; cache'e
      // yazılmaması için işaretlenmesi gerekiyor.
      req: guardRequest(req),
    };

    // Private route'ta desen taraması hiç yapılmaz: `cache.html` altındaki
    // geniş bir kural (`/**` gibi) bu sayfayı cache'lenebilir hâle
    // getirmesin. Kilit tek yönlü — route "özel" dediyse config açamaz.
    const revalidate = isPrivate
      ? undefined
      : resolveRevalidate(req.path, options.revalidate);
    const cacheable = !isPrivate && req.method === "GET" && Boolean(revalidate);
    const cacheKey = `${req.path}?${new URLSearchParams(
      Object.entries(ctx.query).map(([k, v]) => [k, String(v)]),
    ).toString()}`;

    try {
      const result = await withRequestContext(context, () =>
        withHtmlCache(cacheKey, cacheable ? revalidate : 0, () =>
          withUpstreamTracking(() => withRequestCache(() => produce(controller, ctx))),
        ),
      );

      // Cache'lenebilir bir route kimliğe dokunduysa yanıt yine gider ama
      // saklanmaz (`produce` bunu `storable: false` ile bildirdi) ve public
      // direktif yazılmaz.
      const leaked = cacheable && context.tainted;
      if (leaked && isDev) {
        throw new Error(
          `[render] ${req.path} is a cacheable route but read identity-bound data ` +
            `(${context.taintReasons.join(", ")}). This page must be registered with ` +
            `'route(fn, { private: true })'; otherwise one user's HTML is served to another.`,
        );
      }

      // Eksik veriyle üretilen çıktı süreç içi önbelleğe yazılmıyor; aynı
      // çıktıya CDN'de `s-maxage` vermek o kararı bir katman yukarıda geri
      // almak olurdu. Geçici bir 429 yüzünden üretilen 503, ters proxy'de
      // dakikalarca yaşamamalı.
      const publicCache = cacheable && !leaked && !result.degraded;

      res.status(result.status);
      res.setHeader("Content-Type", "text/html; charset=utf-8");

      // Geçici upstream hatası: istemciye ve bota "bu kalıcı değil, sonra gel"
      // demenin standart yolu.
      if (result.retryAfter) {
        res.setHeader("Retry-After", String(result.retryAfter));
      }

      // Teşhis başlığı `degraded` yanıtta da yazılır: "MISS" görmek, sayfanın
      // önbellek yolundan geçtiğini ama saklanmadığını anlatan tek ipucu.
      if (cacheable && !leaked) {
        res.setHeader(
          getConfig().brand.cacheHeader,
          result.cached ? (result.stale ? "STALE" : "HIT") : "MISS",
        );
      }

      if (publicCache) {
        res.setHeader(
          "Cache-Control",
          `public, max-age=0, s-maxage=${revalidate}, stale-while-revalidate=60`,
        );
      } else {
        res.setHeader("Cache-Control", PRIVATE_CACHE);
        // Anahtarında cookie olmayan bir cache'in bu yanıtı paylaşmasını
        // engeller; `no-store`'a uymayan bir katman için ikinci savunma.
        res.setHeader("Vary", "Cookie");

        if (leaked) {
          console.warn(
            `[render] ${req.path} read identity-bound data (${context.taintReasons.join(", ")}), ` +
              `not cached. The route should be registered with 'private: true'.`,
          );
        }
      }

      // ETag kişiye özel HTML için kullanıcıya özgü bir doğrulayıcıdır ve
      // `no-store` ile birlikte hiçbir işe yaramaz; üretilmesi engellenir.
      await sendHtml(req, res, result.html, result.encoded, { etag: publicCache });
    } catch (error) {
      if (isRedirectError(error)) {
        // Oturuma bağlı bir yönlendirme de kişiye özeldir: "giriş yapmalısın"
        // kararının cache'lenmesi, oturum açmış kullanıcıyı da login sayfasına
        // atan türde hatalara yol açıyor.
        if (isPrivate || context.tainted) {
          res.setHeader("Cache-Control", PRIVATE_CACHE);
          res.setHeader("Vary", "Cookie");
        }

        res.redirect(error.statusCode, error.location);
        return;
      }
      next(error);
    }
  };
}

/**
 * Layout'suz, asla cache'lenmeyen parça yanıtı.
 *
 * Fragment uçları (tablo sayfası, sekme paneli, canlı tazelenen kart) her
 * projede elle yazılıyor ve `no-store` yazmayı unutmak sessiz bir sızıntıya
 * dönüşüyor. Burada politika sabit: HTML cache'e hiç uğramaz, `no-store` ile
 * ve ETag'siz gider.
 *
 * Hata durumunda tüm sayfa yerine küçük bir hata parçası döner: takas edilen
 * bölge bir hata sayfasının tamamını içine almasın.
 *
 * @param {(ctx: { params: object, query: object, pathname: string,
 *   req: import('express').Request }) => Promise<{ view: string, data?: object,
 *   status?: number } | string>} controller
 * @returns {import('express').RequestHandler}
 */
export function fragment(controller) {
  return async (req, res, next) => {
    const context = createRequestContext({ private: true, res });
    const ctx = {
      params: req.params ?? {},
      query: req.query ?? {},
      pathname: req.path,
      req: guardRequest(req),
    };

    try {
      const result = await withRequestContext(context, () =>
        withRequestCache(async () => {
          const value = await controller(ctx);
          if (typeof value === "string") return { html: value, status: 200 };

          return {
            html: await renderView(value.view, value.data ?? {}),
            status: value.status ?? 200,
          };
        }),
      );

      res.status(result.status);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", PRIVATE_CACHE);
      res.setHeader("Vary", "Cookie");
      await sendHtml(req, res, result.html, undefined, { etag: false });
    } catch (error) {
      if (isRedirectError(error)) {
        res.setHeader("Cache-Control", PRIVATE_CACHE);
        res.redirect(error.statusCode, error.location);
        return;
      }

      if (isNotFoundError(error)) {
        res.status(404).setHeader("Cache-Control", PRIVATE_CACHE);
        res.type("html").send(fragmentError("notFound"));
        return;
      }

      console.error(`[fragment] ${req.method} ${req.originalUrl}`, error);

      if (res.headersSent) {
        next(error);
        return;
      }

      res.status(500).setHeader("Cache-Control", PRIVATE_CACHE);
      res.type("html").send(fragmentError("failed"));
    }
  };
}

/**
 * Ziyaretçiye görünen parça hatası metinleri. Framework'ün kendi logları
 * İngilizce ama bu satırlar ekranda okunuyor, bu yüzden durum sayfalarıyla
 * aynı kuralı izliyorlar: dil `brand.lang`.
 */
const FRAGMENT_MESSAGES = {
  tr: { notFound: "Bu içerik bulunamadı.", failed: "Bu bölüm yüklenemedi." },
  en: { notFound: "This content was not found.", failed: "This section could not be loaded." },
};

/**
 * Fragment hatası için minimal işaretleme. Şablona bağlı olmaması bilinçli:
 * hata yolu, hatanın kaynağı olabilecek render katmanına geri dönmemeli.
 *
 * @param {"notFound" | "failed"} kind
 * @returns {string}
 */
function fragmentError(kind) {
  let lang = "en";
  try {
    lang = getConfig().brand.lang ?? "en";
  } catch {
    /* config yüklenmemişse İngilizce kalır */
  }

  const table = FRAGMENT_MESSAGES[lang.slice(0, 2).toLowerCase()] ?? FRAGMENT_MESSAGES.en;
  return `<div role="alert" data-fragment-error>${html.esc(table[kind])}</div>`;
}

/**
 * `jskelet.config.mjs` → `cache().html` route'un kendi `revalidate`'ini ezer.
 * Sonuç yol başına hatırlanır: her istekte desen taraması yapılmaz.
 *
 * @type {Map<string, number | undefined>}
 */
const revalidateByPath = new Map();

/**
 * Yakalayıcı bir route'ta (`/:slug`) her benzersiz yol burada kalıcı bir girdi
 * bırakıyor; sınır olmadan bu, uzun ömürlü süreçte bellek sızıntısına dönüşür.
 * Desen taraması ucuz olduğu için en eski girdileri atmak güvenli.
 */
const REVALIDATE_CACHE_MAX = 2000;

/**
 * @param {string} pathname
 * @param {number | undefined} fallback
 * @returns {number | undefined}
 */
function resolveRevalidate(pathname, fallback) {
  const rules = getConfig().html;
  if (!rules.length) return fallback;

  if (revalidateByPath.has(pathname)) {
    return revalidateByPath.get(pathname) ?? fallback;
  }

  const match = rules.find((rule) => matchPattern(rule.pattern, pathname));

  if (revalidateByPath.size >= REVALIDATE_CACHE_MAX) {
    const oldest = revalidateByPath.keys().next().value;
    if (oldest !== undefined) revalidateByPath.delete(oldest);
  }

  revalidateByPath.set(pathname, match?.seconds);
  return match ? match.seconds : fallback;
}

/**
 * Cache'lenmiş bir sayfa aynı gövdeyi her istekte yeniden sıkıştırmasın diye
 * brotli/gzip çıktısı HTML ile birlikte saklanır. `Content-Encoding` burada
 * ayarlandığı için sıkıştırma middleware'i devreye girmez.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} body
 * @param {Map<string, Buffer>} [encoded]
 * @param {{ etag?: boolean }} [options] `etag: false` → `res.send()` atlanır,
 *   böylece Express kullanıcıya özel gövde için doğrulayıcı üretmez.
 * @returns {Promise<void>}
 */
async function sendHtml(req, res, body, encoded, options = {}) {
  const encoding =
    req.method === "HEAD" ? null : negotiateEncoding(req.headers["accept-encoding"]);

  if (!encoding || !encoded) {
    if (options.etag === false) {
      // Sıkıştırma middleware'i devreye girerse Content-Length'i kendisi
      // kaldırır; girmezse doğru uzunlukla gider.
      res.setHeader("Content-Length", String(Buffer.byteLength(body)));
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }

    res.send(body);
    return;
  }

  let buffer = encoded.get(encoding);
  if (!buffer) {
    buffer = await encodeText(body, encoding);
    encoded.set(encoding, buffer);
  }

  res.setHeader("Content-Encoding", encoding);
  res.setHeader("Vary", "Accept-Encoding");
  res.setHeader("Content-Length", String(buffer.length));
  res.end(buffer);
}

/**
 * @typedef {{ html: string, status: number, degraded?: boolean,
 *   storable?: boolean, retryAfter?: number }} Produced
 */

/**
 * Controller'ı bir kez çalıştırır. `notFound()` fırlatıldığında sonucu
 * ayırt edilebilir biçimde döner: çağıran taraf bunun gerçek bir 404 mü,
 * yoksa upstream düştüğü için verinin gelmemesi mi olduğuna karar verecek.
 *
 * @param {Function} controller
 * @param {{ pathname: string }} ctx
 * @returns {Promise<{ page: Produced } | { notFound: true,
 *   transient: import('./upstream-tracking.js').UpstreamFailure[] }>}
 */
async function attempt(controller, ctx) {
  try {
    const page = await controller(ctx);
    const rendered = await renderPage({ pathname: ctx.pathname, ...page });
    return {
      page: {
        html: rendered,
        status: page.status ?? 200,
        degraded: hasUpstreamFailures(ctx.pathname),
        // Kimliğe bağlı çıktı önbelleğe yazılmaz. Karar burada verilmeli:
        // `withHtmlCache` yazma anında controller'ın ne okuduğunu bilemez.
        storable: getRequestContext()?.tainted !== true,
      },
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { notFound: true, transient: transientUpstreamFailures() };
    }
    throw error;
  }
}

/**
 * @param {Function} controller
 * @param {{ pathname: string }} ctx
 * @returns {Promise<Produced>}
 */
async function produce(controller, ctx) {
  const first = await attempt(controller, ctx);
  if ("page" in first) return first.page;
  // Deterministik "böyle bir sayfa yok" cevabı: tekrar denemenin anlamı yok.
  if (!first.transient.length) return { html: await renderNotFound(), status: 404 };

  // Buraya gelindiyse `notFound()` veri gelmediği için çağrılmış. **Var olan
  // bir sayfayı** 404 olarak servis etmek en kötü sonuç: arama motoru geçici
  // bir rate limit'i kalıcı bir kayıp sanar. Bu yüzden sayfa yeniden denenir —
  // ısıtma günlükleri gösteriyor ki aynı yol saniyeler sonra 200 dönüyor.
  const { attempts, delayMs } = transientRetry();
  let failures = first.transient;

  for (let round = 1; round <= attempts; round += 1) {
    const retryDetail =
      `returned notFound() while upstream is failing ` +
      `(${summarizeFailures(failures)}), retrying (${round}/${attempts})`;
    if (!suppressForPrewarm(retryDetail)) {
      console.warn(`[render] ${ctx.pathname} ${retryDetail}`);
    }

    // Beklemeden tekrar denemek rate limit'e girmiş bir API'de aynı 429'u
    // getirir; kısa bekleme hem pencerenin dönmesine şans verir hem de
    // fırtınayı büyütmez.
    await sleep(delayMs * round);

    // Her deneme kendi upstream ve istek içi cache bağlamında çalışır: ilk
    // turun hataları ikinci turun kararını kirletmesin ve memoize edilmiş
    // boş cevaplar tekrar kullanılmasın.
    const retried = await withUpstreamTracking(() =>
      withRequestCache(() => attempt(controller, ctx)),
    );

    if ("page" in retried) return retried.page;
    if (!retried.transient.length) {
      // Bu kez upstream sağlam cevap verdi ve "yok" dedi: gerçek 404.
      return { html: await renderNotFound(), status: 404 };
    }

    failures = retried.transient;
  }

  // Denemeler tükendi. 404 yerine 503: önbelleğe girmez, `Retry-After` taşır
  // ve bir sonraki istek gerçek içeriği üretebilir.
  const outageDetail =
    `could not be produced, upstream is still failing ` +
    `(${summarizeFailures(failures)}), serving an uncached 503 instead of a 404`;
  if (!suppressForPrewarm(outageDetail)) {
    console.warn(`[render] ${ctx.pathname} ${outageDetail}`);
  }

  return {
    html: await renderStatusPage(503),
    status: 503,
    degraded: true,
    retryAfter: RETRY_AFTER_SECONDS,
  };
}

/**
 * Geçici bir upstream hatası yüzünden üretilemeyen sayfanın `Retry-After`
 * değeri. Kısa tutuluyor: ziyaretçi de bot da birkaç saniye sonra gerçek
 * içeriği bulabilsin.
 */
const RETRY_AFTER_SECONDS = 30;

/**
 * Tekrar denemenin maliyeti upstream'e binen ikinci bir istek turu; bu yüzden
 * varsayılan tek deneme ve kısa bekleme. Rate limit fırtınasında toplam yük
 * iki katına çıkabilir, ama alternatifi var olan sayfaları 404'e düşürmek.
 *
 * @returns {{ attempts: number, delayMs: number }}
 */
function transientRetry() {
  const raw = /** @type {any} */ (getConfig().transientRetry ?? {});
  const attempts = Number(raw.attempts);
  const delayMs = Number(raw.delayMs);

  return {
    attempts: Number.isFinite(attempts) && attempts >= 0 ? Math.floor(attempts) : 1,
    delayMs: Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 300,
  };
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}


/**
 * Render sırasında upstream düştüyse çıktı eksik veri içeriyor demektir.
 * Böyle bir HTML önbelleğe yazılmaz: sonraki istek yeniden dener.
 *
 * Ancak yalnızca *geçici* hatalar için. 400/403/404 gibi deterministik
 * cevaplar tekrar denemekle düzelmez; onlar yüzünden önbelleği kapatmak
 * sayfayı her ziyarette baştan render etmek olur — içerik yine aynı eksik
 * hâliyle döner, ziyaretçi sadece render süresini öder. Bu yüzden kalıcı
 * hatalar yalnızca loglanır, önbelleği engellemez.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
function hasUpstreamFailures(pathname) {
  const failures = getUpstreamFailures();
  if (!failures.length) return false;

  const transient = failures.filter((failure) => isTransientStatus(failure.status));
  const permanent = failures.filter((failure) => !isTransientStatus(failure.status));

  // Isıtma turu yüzlerce yolu tarıyor; aynı upstream arızası her yol için bir
  // satır basınca tur özeti kayboluyor. Turun uyarıları sayılıp sonunda
  // toplanır (bkz. `suppressForPrewarm`).
  if (permanent.length) {
    const detail = `missing data, upstream is failing permanently (${summarizeFailures(permanent)})`;
    if (!suppressForPrewarm(detail)) {
      console.warn(`[render] ${pathname} was produced with ${detail}`);
    }
  }

  if (!transient.length) return false;

  const detail = `missing data, not caching it (${summarizeFailures(transient)})`;
  if (!suppressForPrewarm(detail)) {
    console.warn(`[render] ${pathname} was produced with ${detail}`);
  }

  return true;
}

/**
 * @returns {import('./upstream-tracking.js').UpstreamFailure[]}
 */
function transientUpstreamFailures() {
  return getUpstreamFailures().filter((failure) => isTransientStatus(failure.status));
}

/**
 * @param {import('./upstream-tracking.js').UpstreamFailure[]} failures
 * @returns {string}
 */
function summarizeFailures(failures) {
  return failures.map((failure) => `${failure.status} ${failure.path}`).join(", ");
}

/**
 * 404 sayfası. `renderStatusPage(404)` için kısayol; route dosyalarında en sık
 * ihtiyaç duyulan durum bu olduğu için ayrı bir ad taşımaya devam ediyor.
 *
 * @returns {Promise<string>}
 */
export async function renderNotFound() {
  return renderStatusPage(404);
}
