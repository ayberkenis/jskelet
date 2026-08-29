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
import { getUpstreamFailures, withUpstreamTracking } from "./upstream-tracking.js";
import { isNotFoundError, isRedirectError } from "../http/control-flow.js";
import { renderHeadMeta } from "./metadata.js";
import { asset, hasAsset } from "./assets.js";
import * as html from "../views/helpers/html.js";
import * as tags from "../views/helpers/tags.js";
import { loadComponents } from "../views/components/loader.js";

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
 * Controller'ı çalıştırıp yanıtı yazar; notFound/redirect kontrol akışını,
 * HTML cache'ini ve hata yönetimini üstlenir.
 *
 * @param {(ctx: { params: object, query: object, pathname: string,
 *   req: import('express').Request }) => Promise<object>} controller
 * @param {{ revalidate?: number }} [options]
 * @returns {import('express').RequestHandler}
 */
export function route(controller, options = {}) {
  return async (req, res, next) => {
    const ctx = {
      params: req.params ?? {},
      query: req.query ?? {},
      pathname: req.path,
      req,
    };

    const revalidate = resolveRevalidate(req.path, options.revalidate);
    const cacheable = req.method === "GET" && Boolean(revalidate);
    const cacheKey = `${req.path}?${new URLSearchParams(
      Object.entries(ctx.query).map(([k, v]) => [k, String(v)]),
    ).toString()}`;

    try {
      const result = await withHtmlCache(cacheKey, cacheable ? revalidate : 0, () =>
        withUpstreamTracking(() => withRequestCache(() => produce(controller, ctx))),
      );

      res.status(result.status);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (cacheable) {
        res.setHeader(
          "Cache-Control",
          `public, max-age=0, s-maxage=${revalidate}, stale-while-revalidate=60`,
        );
      }
      res.setHeader(
        getConfig().brand.cacheHeader,
        result.cached ? (result.stale ? "STALE" : "HIT") : "MISS",
      );
      await sendHtml(req, res, result.html, result.encoded);
    } catch (error) {
      if (isRedirectError(error)) {
        res.redirect(error.statusCode, error.location);
        return;
      }
      next(error);
    }
  };
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
 * @returns {Promise<void>}
 */
async function sendHtml(req, res, body, encoded) {
  const encoding =
    req.method === "HEAD" ? null : negotiateEncoding(req.headers["accept-encoding"]);

  if (!encoding || !encoded) {
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
 * @param {Function} controller
 * @param {{ pathname: string }} ctx
 * @returns {Promise<{ html: string, status: number, degraded?: boolean }>}
 */
async function produce(controller, ctx) {
  try {
    const page = await controller(ctx);
    const rendered = await renderPage({ pathname: ctx.pathname, ...page });
    return {
      html: rendered,
      status: page.status ?? 200,
      degraded: hasUpstreamFailures(ctx.pathname),
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { html: await renderNotFound(), status: 404 };
    }
    throw error;
  }
}

/** Ağ hatası (0) ve geçici olduğu varsayılan durumlar. */
const TRANSIENT_STATUSES = new Set([0, 408, 425, 429]);

/** @param {number} status */
function isTransient(status) {
  return TRANSIENT_STATUSES.has(status) || status >= 500;
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

  /** @param {typeof failures} list */
  const summarize = (list) =>
    list.map((failure) => `${failure.status} ${failure.path}`).join(", ");

  const transient = failures.filter((failure) => isTransient(failure.status));
  const permanent = failures.filter((failure) => !isTransient(failure.status));

  if (permanent.length) {
    console.warn(
      `[render] ${pathname} eksik veriyle üretildi, upstream kalıcı hata veriyor (${summarize(permanent)})`,
    );
  }

  if (!transient.length) return false;

  console.warn(
    `[render] ${pathname} eksik veriyle üretildi, önbelleğe alınmıyor (${summarize(transient)})`,
  );

  return true;
}

/**
 * 404 sayfası. Uygulama `hooks.notFound()` ile kendi sayfasını verebilir;
 * vermezse framework tarayıcıda okunabilir minimal bir HTML döner. Bu geri
 * dönüş bilinçli olarak şablonsuz: 404 render'ı da patlarsa ziyaretçi boş
 * yanıt görmesin.
 *
 * @returns {Promise<string>}
 */
export async function renderNotFound() {
  const page = await hook("notFound", null);
  if (!page) return FALLBACK_NOT_FOUND;

  try {
    return await renderPage({ pathname: "/404", ...page });
  } catch (error) {
    console.error("[render] 404 sayfası render edilemedi", error);
    return FALLBACK_NOT_FOUND;
  }
}

const FALLBACK_NOT_FOUND =
  '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  "<title>404</title></head><body><h1>404</h1>" +
  "<p>Sayfa bulunamadı.</p></body></html>";
