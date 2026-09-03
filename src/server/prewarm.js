/**
 * Sunucu açılışında veya ziyaret sırasında sayfaları önden render edip HTML
 * cache'ini doldurur.
 *
 * İki karşılıklı dışlayan mod:
 *
 * 1. **Klasik** — `hooks.prewarmPaths()` listesi, açılış/`intervalSeconds`
 *    turları, `priority` / `rotate` / `max`.
 * 2. **onVisit** — herkese açık bir sayfa servis edilince HTML'deki
 *    aynı-origin linkler kuyruğa alınır; tıklanabilir komşular ısınır.
 *
 * Next'teki build-time prerender'ın karşılığı, ama çıktı diske yazılmaz:
 * HTML cache süreç belleğinde yaşadığı için ısıtma da süreç ayağa kalkınca
 * (veya trafik geldikçe) yapılır.
 *
 * Isıtma gerçek HTTP istekleriyle yapılır: cache anahtarı, sıkıştırma ve
 * middleware zinciri normal trafikle bire bir aynı olsun.
 */
import process from "node:process";
import { getConfig, hook } from "../config/index.js";
import { getRequestContext } from "../http/request-context.js";
import { isHtmlCacheFresh, takeInvalidatedPaths } from "./html-cache.js";
import { getDataCacheStats } from "./data-cache.js";
import { isTransientStatus } from "./upstream-tracking.js";
import { upstreamCooldownMs } from "./upstream-limiter.js";

/** Klasik turu yöneten env'ler; `onVisit` ile birlikte yasak. */
const CLASSIC_PREWARM_ENV = [
  "PREWARM_MAX",
  "PREWARM_INTERVAL_SECONDS",
  "PREWARM_DELAY_MS",
  "PREWARM_RETRY_DELAY_MS",
];

/**
 * onVisit turu sürerken concurrency/rps. Klasik moda dokunmaz (`null`).
 * @type {{ concurrency: number | null, rps: number | null }}
 */
const visitWarmSettings = { concurrency: null, rps: null };

/**
 * Isıtmanın canlı durumu. Dev araçları bunu okuyup ilerlemeyi gösterir;
 * üretimde kimse okumazsa da maliyeti bir nesnedir.
 */
export const prewarmProgress = {
  active: false,
  done: 0,
  total: 0,
  ok: 0,
  failed: 0,
  /** @type {number | null} */
  startedAt: null,
  /** @type {number | null} */
  finishedAt: null,
  /**
   * Denenen her yolun sonucu; dev panelindeki Prewarming sekmesi bunu listeler.
   * @type {{ path: string, status: number, ms: number, bytes: number,
   *   cache: string | null, error: string | null }[]}
   */
  entries: [],
};

/**
 * Isıtma turu sırasında bastırılan uyarılar: mesaj → kaç kez görüldü.
 *
 * Yüzlerce yolu tarayan bir tur, upstream bir an için tıksırdığında yüzlerce
 * satır loga döküyor ve asıl bilgi (kaç sayfa ısındı) kayboluyor. Tur boyunca
 * mesajlar burada toplanır, tur bitince tek satırda özetlenir. Yol adı
 * anahtara girmez: gruplanabilmesi için mesajın kendisi yeterli, tek bir yolun
 * ayrıntısı zaten `entries` üzerinden dev panelinde görünüyor.
 * @type {Map<string, number>}
 */
const suppressed = new Map();

/**
 * İstek ısıtma turunun kendi isteği mi? Yalnızca tur çalışırken ve istek
 * ısıtmanın user-agent'ıyla geldiğinde doğru; gerçek trafiğin hataları her
 * zaman loglanmaya devam eder.
 *
 * @param {{ get?: (name: string) => string | undefined } | null | undefined} req
 * @returns {boolean}
 */
export function isPrewarmRequest(req) {
  if (!prewarmProgress.active || !req) return false;
  const ua = req.get?.("user-agent");
  return Boolean(ua) && ua === getConfig().brand.prewarmUserAgent;
}

/**
 * Şu an işlenen istek ısıtma turuna mı ait? `req` elde olmayan derin
 * katmanlar (render, cache) için: yanıt nesnesi istek bağlamında taşınıyor.
 *
 * @returns {boolean}
 */
function inPrewarmRequest() {
  if (!prewarmProgress.active) return false;
  return isPrewarmRequest(getRequestContext()?.res?.req);
}

/**
 * Isıtma turuna ait bir uyarıyı loglamak yerine sayar.
 *
 * @param {string} message Gruplama anahtarı; yol adı içermemeli.
 * @returns {boolean} `true` ise sayıldı, çağıran taraf loglamamalı.
 */
export function suppressForPrewarm(message) {
  if (!inPrewarmRequest()) return false;
  suppressed.set(message, (suppressed.get(message) ?? 0) + 1);
  return true;
}

/**
 * Bastırılan bir istek hatasını sayaca ekler. Yığın izi saklanmaz: özet
 * satırının amacı "neyin bozulduğunu" göstermek, hatayı ayıklamak değil.
 *
 * @param {number} status
 * @param {unknown} error
 * @returns {void}
 */
export function notePrewarmError(status, error) {
  const message = error instanceof Error ? error.message : String(error);
  const key = `${status} ${message.split("\n")[0]}`;
  suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
}

/** @param {unknown} value @param {number} fallback */
function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Ayar sırası: ortam değişkeni → `jskelet.config.mjs` → kod varsayılanı.
 * Env önde, çünkü tek seferlik deneyler config'i düzenlemeden yapılabilsin.
 *
 * @param {string} envKey
 * @param {string} configKey
 * @param {number} fallback
 * @returns {number}
 */
function setting(envKey, configKey, fallback) {
  if (
    visitWarmSettings.concurrency != null &&
    configKey === "concurrency"
  ) {
    return visitWarmSettings.concurrency;
  }
  if (visitWarmSettings.rps != null && configKey === "rps") {
    return visitWarmSettings.rps;
  }
  return num(process.env[envKey], num(getConfig().prewarm?.[configKey], fallback));
}

/**
 * @returns {Promise<string[]>}
 */
async function collectPaths() {
  const { prewarmSkip } = getConfig();
  const paths = await hook("prewarmPaths", []);

  if (!Array.isArray(paths)) {
    console.warn("[prewarm] hooks.prewarmPaths() must return an array, ignoring it");
    return [];
  }

  // Tekilleştirme sırayı korur: liste `PREWARM_MAX` ile budandığı için
  // uygulamanın verdiği öncelik sırası anlamlıdır.
  return [...new Set(paths)].filter(
    (candidate) =>
      typeof candidate === "string" &&
      candidate.startsWith("/") &&
      !prewarmSkip.some((prefix) => candidate.startsWith(prefix)),
  );
}

/**
 * `cache().prewarm.priority` desenlerine göre sıralar. Eşleşmeyen yollar
 * listenin sonuna, kendi aralarındaki sırayı koruyarak gider — uygulamanın
 * verdiği sıra hâlâ anlamlı olsun.
 *
 * @param {string[]} paths
 * @returns {{ head: string[], tail: string[] }}
 *   `head` öncelikli yollar (her turda ısıtılır), `tail` geri kalan kuyruk
 *   (turlar arasında dolaşılır).
 */
function byPriority(paths) {
  const rules = getConfig().prewarmPriority;
  if (!rules.length) return { head: [], tail: paths };

  /** @type {string[][]} */
  const buckets = rules.map(() => []);
  /** @type {string[]} */
  const tail = [];

  for (const candidate of paths) {
    const rank = rules.findIndex((rule) => rule.test(candidate));
    if (rank === -1) tail.push(candidate);
    else buckets[rank].push(candidate);
  }

  return { head: buckets.flat(), tail };
}

/**
 * Kuyruğun kaldığı yer. Periyodik turlar listeyi baştan ısıtıp aynı ilk
 * `max` yolu tekrar tekrar tazelemesin: her tur bir sonraki dilimi alır ve
 * yeterli tur sonunda liste baştan sona ısınır.
 */
let queueCursor = 0;

/**
 * Bir turda ısıtılacak dilimi seçer: önce `priority` eşleşenler, sonra
 * kuyruğun sırası gelen parçası. Dışa açık olması bilinçli — sıralama ve
 * rotasyon, tur çalışmadan doğrulanabilen tek davranış.
 *
 * @param {string[]} all
 * @param {number} limit
 * @param {boolean} rotate
 * @returns {string[]}
 */
export function selectPrewarmPaths(all, limit, rotate = true) {
  if (all.length <= limit) return all;

  const { head, tail } = byPriority(all);
  const selected = head.slice(0, limit);
  const room = limit - selected.length;
  if (room <= 0 || !tail.length) return selected;

  if (!rotate) return [...selected, ...tail.slice(0, room)];

  // Dilim listenin sonunu aşarsa başa sarar: kuyruk halkasal dolaşılır.
  const start = queueCursor % tail.length;
  const slice = tail.slice(start, start + room);
  if (slice.length < room) slice.push(...tail.slice(0, room - slice.length));
  queueCursor = (start + room) % tail.length;

  return [...selected, ...slice];
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

/**
 * Saniyedeki istek sayısını sınırlar. Fren `concurrency`'den bağımsız
 * olmalı: paralellik gecikmeyi kapatmak için var, kotayı koruyan şey toplam
 * hız. İşçiler aynı sayacı paylaştığı için sıra kimde olursa olsun tur
 * verilen hızın üstüne çıkmaz.
 *
 * @param {number} rps 0 → sınırsız
 * @returns {() => Promise<void>}
 */
function createPacer(rps) {
  if (!rps) return async () => {};

  const gap = 1000 / rps;
  let nextSlot = 0;

  return async () => {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + gap;
    if (slot > now) await sleep(slot - now);
  };
}

/**
 * `DEV_TOKEN` ayarlıyken `devGate` token taşımayan her isteğe 404 döner.
 * Isıtma kendi sunucusuna istek attığı için token'ı çerez olarak taşımalı;
 * yoksa tüm sayfalar 404 alır ve önbellek hiç dolmaz.
 *
 * @returns {Record<string, string>}
 */
function devGateHeader() {
  const token = process.env.DEV_TOKEN;
  if (!token) return {};

  const cookie = getConfig().brand.devTokenCookie;
  return { cookie: `${cookie}=${encodeURIComponent(token)}` };
}

/**
 * @param {string} origin
 * @param {string[]} paths
 * @param {number} concurrency
 * @param {(ok: number, failed: number) => void} [report]
 *   Tur ilerlemesini `prewarmProgress`'e yazar. Tekrar turunda sayaçların
 *   anlamı değiştiği için çağıran taraf kendi formülünü verir.
 * @param {() => Promise<void>} [pace] İstek başına beklenen hız freni.
 * @returns {Promise<{ ok: number, failed: number,
 *   failures: { path: string, status: number }[] }>}
 *   `failures` durum koduyla birlikte döner: tekrar turuna yalnızca geçici
 *   hatalar alınıyor, kalıcı olanı yeniden denemek boşa çağrı.
 */
async function crawl(origin, paths, concurrency, report = undefined, pace = undefined) {
  const { brand } = getConfig();
  const cacheHeader = brand.cacheHeader.toLowerCase();

  let index = 0;
  let ok = 0;
  let failed = 0;
  /** @type {{ path: string, status: number }[]} */
  const failures = [];

  async function worker() {
    while (index < paths.length) {
      const target = paths[index];
      index += 1;

      if (pace) await pace();

      const startedAt = Date.now();

      try {
        const response = await fetch(`${origin}${target}`, {
          headers: {
            // Sıkıştırılmış gövde de cache'lensin.
            "accept-encoding": "br, gzip",
            "user-agent": brand.prewarmUserAgent,
            ...devGateHeader(),
          },
        });
        // Gövde okunmadan bağlantı açık kalır.
        const body = await response.arrayBuffer();
        if (response.ok) ok += 1;
        else {
          failed += 1;
          failures.push({ path: target, status: response.status });
        }

        prewarmProgress.entries.push({
          path: target,
          status: response.status,
          ms: Date.now() - startedAt,
          bytes: body.byteLength,
          cache: response.headers.get(cacheHeader),
          error: response.ok ? null : `HTTP ${response.status}`,
        });
      } catch (error) {
        failed += 1;
        // Yanıt hiç gelmedi: ağ hatası her zaman geçici, tekrar denenir.
        failures.push({ path: target, status: 0 });
        prewarmProgress.entries.push({
          path: target,
          status: 0,
          ms: Date.now() - startedAt,
          bytes: 0,
          cache: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (report) {
        report(ok, failed);
      } else {
        prewarmProgress.done = ok + failed;
        prewarmProgress.ok = ok;
        prewarmProgress.failed = failed;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, paths.length) }, worker),
  );

  return { ok, failed, failures };
}

/**
 * Tekrar turuna girecek yollar. Yalnızca geçici hatalar: `400`/`403`/`404` gibi
 * deterministik cevaplar tekrar denemekle düzelmez ve o çağrılar kotadan
 * karşılıksız yiyor. Sınıflandırma render tarafıyla aynı listeden
 * (`isTransientStatus`), yoksa iki yer birbirinden kayar.
 *
 * @param {{ path: string, status: number }[]} failures
 * @returns {string[]}
 */
function retryablePaths(failures) {
  return failures
    .filter((failure) => isTransientStatus(failure.status))
    .map((failure) => failure.path);
}

/**
 * Tekrar turundan önce beklenecek süre.
 *
 * Sabit bekleme yanlış soruyu cevaplıyordu: doğru süreyi upstream biliyor.
 * Hız freni açıkken `Retry-After` ya da devre kesicinin soğuma süresi zaten
 * elimizde; 10 saniye kapalı kalacak bir kesiciden 2 saniye sonra tekrar
 * denemek, aynı 429'u peşin peşin almak demek.
 *
 * @returns {number} ms
 */
function retryDelayMs() {
  const configured = setting("PREWARM_RETRY_DELAY_MS", "retryDelayMs", 2000);
  const cooldown = upstreamCooldownMs();

  // Fren kapalıysa `cooldown` 0 olur ve davranış eskisi gibi kalır. Üst sınır
  // turun sonsuza kadar açık kalmasını engelliyor.
  return Math.min(Math.max(configured, cooldown), 60_000);
}

/**
 * Turun veri önbelleği üzerinden upstream'e ne kadar dokunduğunu özetler.
 *
 * @param {ReturnType<typeof getDataCacheStats>} before Tur başındaki sayaçlar.
 * @returns {string} Okunacak bir şey yoksa boş dize.
 */
function upstreamUsage(before) {
  const after = getDataCacheStats();
  const reads = after.reads - before.reads;
  if (reads <= 0) return "";

  const produced = after.produced - before.produced;
  const coalesced = after.coalesced - before.coalesced;
  const shared = after.shared - before.shared;
  const served = reads - produced;
  const ratio = Math.round((served / reads) * 100);

  return (
    `${produced} upstream call${produced === 1 ? "" : "s"} for ${reads} data read${reads === 1 ? "" : "s"} ` +
    `(${ratio}% from the data cache` +
    `${coalesced ? `, ${coalesced} coalesced` : ""}` +
    `${shared ? `, ${shared} from the shared tier` : ""})`
  );
}

/**
 * @param {{ origin: string, quiet?: boolean, paths?: string[] }} options
 *   `paths` verilirse hook çağrılmaz, yalnızca o yollar ısıtılır (dev
 *   panelindeki "tekrar dene" bunu kullanır).
 * @returns {Promise<{ ok: number, failed: number, total: number, elapsed: number }>}
 */
export async function prewarm({ origin, quiet = false, paths: only }) {
  const started = Date.now();
  const limit = setting("PREWARM_MAX", "max", 400);
  const isDev = process.env.NODE_ENV === "development";

  // Dev'de tek işçi: tarama, o an tarayıcıda açtığın sayfanın render'ıyla CPU
  // için yarışmasın.
  const concurrency = setting(
    "PREWARM_CONCURRENCY",
    "concurrency",
    isDev ? 1 : 4,
  );

  // Render tek bir olay döngüsünde çalışıyor: aralıksız bir tur, geliştirme
  // sırasında sayfa isteklerini ve dev panelinin kanalını arkasında bekletiyor.
  // Dev'de varsayılan bir hız freni bu yüzden var; üretimde ısıtma bir kez
  // olup bittiği için fren yalnızca istenirse (`prewarm.rps`) devreye girer.
  // onVisit turlarında `visitWarmSettings.rps` `setting()` üzerinden iner.
  const rps = setting("PREWARM_RPS", "rps", isDev ? 4 : 0);
  const pace = createPacer(rps);

  const all = only?.length ? only : await collectPaths();
  // Elle verilen liste budanmaz ve sıralanmaz: çağıran tam olarak neyi
  // istediğini biliyor (dev panelindeki "tekrar dene" bunu kullanır).
  const selected = only?.length
    ? all
    : selectPrewarmPaths(all, limit, getConfig().prewarm?.rotate !== false);

  // Invalidate edilmiş sayfalar kuyruğun önüne geçer: "içerik güncellendi"
  // bilgisi geldiğinde sayfa, ziyaretçi gelmesini beklemeden tazelenir. Bu
  // yollar `max` bütçesinin dışında tutulur — sayıları zaten gerçekleşen
  // invalidation kadar ve rotasyonun sırasını bozmaları istenmez.
  const pending = only?.length ? [] : takeInvalidatedPaths();
  const paths = pending.length
    ? [...new Set([...pending, ...selected])]
    : selected;

  Object.assign(prewarmProgress, {
    active: true,
    done: 0,
    total: paths.length,
    ok: 0,
    failed: 0,
    startedAt: started,
    finishedAt: null,
    entries: [],
  });
  suppressed.clear();

  // Kotanın gerçekten ne kadar harcandığı ancak veri önbelleğinden görülür:
  // 400 sayfalık bir tur, ortak bir uç için tek çağrı da yapabilir dört yüz de.
  const dataBefore = getDataCacheStats();

  let ok = 0;
  let failed = 0;
  let recovered = 0;
  let skippedRetry = 0;
  try {
    /** @type {{ path: string, status: number }[]} */
    let failures;
    ({ ok, failed, failures } = await crawl(
      origin,
      paths,
      concurrency,
      undefined,
      pace,
    ));

    // Hatalar çoğunlukla upstream rate limit'i (429): ilk tur yüzlerce sayfayı
    // aynı anda çekerken API'yi zorluyor. Tek seri tekrar turu bu sayfaların
    // önbelleğe girmesini sağlıyor; aksi hâlde ziyaretçi soğuk render'ı öder.
    const retryPaths = retryablePaths(failures);
    skippedRetry = failures.length - retryPaths.length;

    if (retryPaths.length) {
      const firstOk = ok;
      const firstFailed = failed;

      await sleep(retryDelayMs());

      const retry = await crawl(
        origin,
        retryPaths,
        1,
        (retriedOk) => {
          // Tekrar turunda her başarı bir hatayı başarıya çevirir.
          prewarmProgress.ok = firstOk + retriedOk;
          prewarmProgress.failed = firstFailed - retriedOk;
        },
        pace,
      );
      recovered = retry.ok;
      ok += retry.ok;
      failed -= retry.ok;
    }
  } finally {
    prewarmProgress.active = false;
    prewarmProgress.finishedAt = Date.now();
  }
  const elapsed = Date.now() - started;

  if (!quiet && paths.length) {
    const skipped = all.length - selected.length;
    // Rotasyon açıkken sınırın dışında kalan yollar kaybolmuyor, bir sonraki
    // tura kalıyor; log bunu ayırt etmeli, yoksa "400 yol atlandı" satırı
    // hatalı bir kurulum sanılıyor.
    const rotate = !only?.length && getConfig().prewarm?.rotate !== false;
    console.log(
      `[prewarm] warmed ${ok}/${paths.length} pages` +
        `${pending.length ? `, ${pending.length} invalidated` : ""}` +
        `${failed ? `, ${failed} failed` : ""}` +
        `${recovered ? `, ${recovered} recovered on the retry pass` : ""}` +
        `${skippedRetry ? `, ${skippedRetry} not retried (permanent)` : ""}` +
        `${skipped > 0 ? `, ${skipped} ${rotate ? "deferred to the next pass" : "over the limit"}` : ""}` +
        ` (${(elapsed / 1000).toFixed(1)}s)`,
    );

    // Turun upstream'e ne kadar dokunduğu. Asıl karar bu satıra bakılarak
    // veriliyor: oran düşükse çözüm hız freni değil, `withDataCache` TTL'ini
    // tur aralığından uzun tutmak — fren çağrıları yavaşlatır, sayısını
    // azaltmaz.
    const upstreamCalls = upstreamUsage(dataBefore);
    if (upstreamCalls) console.log(`[prewarm] ${upstreamCalls}`);

    // Tur boyunca bastırılan hatalar: en sık görülenler önce, liste uzarsa
    // kalanı tek satırda toplanır. Amaç, logu şişirmeden "ne bozuldu"yu
    // görünür tutmak.
    if (suppressed.size) {
      const ranked = [...suppressed.entries()].sort((a, b) => b[1] - a[1]);
      const shown = ranked.slice(0, 5);
      const rest = ranked.slice(shown.length).reduce((sum, [, n]) => sum + n, 0);
      const total = ranked.reduce((sum, [, n]) => sum + n, 0);

      console.warn(
        `[prewarm] ${total} problem${total === 1 ? " was" : "s were"} not logged individually:\n` +
          shown.map(([message, n]) => `  ${n}× ${message}`).join("\n") +
          (rest ? `\n  … ${rest} more in ${ranked.length - shown.length} other kinds` : ""),
      );
    }
  }

  return { ok, failed, total: paths.length, elapsed };
}

/**
 * Speculation Rules `href_matches` benzeri dışlama: tam yol veya `/*` öneki.
 *
 * @param {string} pathname
 * @param {string[]} patterns
 * @returns {boolean}
 */
function matchesHrefExclude(pathname, patterns) {
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || !pattern) continue;
    if (pattern.endsWith("/*")) {
      const base = pattern.slice(0, -2);
      if (pathname === base || pathname.startsWith(`${base}/`)) return true;
      continue;
    }
    if (pathname === pattern) return true;
  }
  return false;
}

/**
 * HTML içindeki aynı-origin `<a href>` yollarını DOM sırasıyla (üstten alta)
 * toplar. Speculation Rules ile aynı muafiyetler: `nofollow`, `_blank`,
 * `data-no-prefetch`, `prewarmSkip`, `navigation.exclude`.
 *
 * @param {string} html
 * @param {{ limit?: number, basePath?: string }} [options]
 * @returns {string[]}
 */
export function extractSameOriginLinks(html, options = {}) {
  if (typeof html !== "string" || !html) return [];

  const limit = Math.max(1, Math.floor(Number(options.limit) || 20));
  const { prewarmSkip, navigation } = getConfig();
  const exclude = navigation?.exclude ?? [];

  /** @type {string[]} */
  const links = [];
  const seen = new Set();
  const tagRe = /<a\b([^>]*)>/gi;
  let match;

  while ((match = tagRe.exec(html)) !== null && links.length < limit) {
    const attrs = match[1];
    if (/\btarget\s*=\s*(?:"_blank"|'_blank'|_blank)(?=[\s>]|$)/i.test(attrs)) {
      continue;
    }
    if (/\bdata-no-prefetch\b/i.test(attrs)) continue;

    const relMatch = attrs.match(
      /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
    );
    const rel = relMatch?.[1] ?? relMatch?.[2] ?? relMatch?.[3] ?? "";
    if (/\bnofollow\b/i.test(rel)) continue;

    const hrefMatch = attrs.match(
      /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
    );
    const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3];
    if (!href) continue;

    const path = normalizeWarmPath(href, options.basePath);
    if (!path) continue;
    if (prewarmSkip.some((prefix) => path.startsWith(prefix))) continue;
    if (matchesHrefExclude(path, exclude)) continue;
    if (seen.has(path)) continue;

    seen.add(path);
    links.push(path);
  }

  return links;
}

/**
 * @param {string} href
 * @param {string} [basePath] Ziyaret edilen sayfa; göreli href çözümü için.
 * @returns {string | null}
 */
function normalizeWarmPath(href, basePath = "/") {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (/^(mailto|tel|javascript|data):/i.test(trimmed)) return null;

  try {
    const basePathname = basePath.startsWith("/") ? basePath : `/${basePath}`;
    const url = new URL(trimmed, `https://warm.invalid${basePathname}`);
    // Dış origin veya `https://…` mutlak linkler elenir; yalnızca site-içi
    // path / göreli href ısınır.
    if (url.origin !== "https://warm.invalid") return null;
    return url.pathname || "/";
  } catch {
    return null;
  }
}

/** @type {string | null} */
let visitOrigin = null;
/** @type {string[]} */
const visitPending = [];
/** @type {Set<string>} */
const visitQueued = new Set();
let visitDraining = false;

/**
 * Ziyaret ısıtması açık mı? `PREWARM=0` her iki modu da keser.
 *
 * @returns {boolean}
 */
export function isOnVisitPrewarm() {
  if (process.env.PREWARM === "0") return false;
  try {
    return getConfig().prewarm?.onVisit?.enabled === true;
  } catch {
    return false;
  }
}

/**
 * Yanıt gövdesindeki linkleri soğuksa kuyruğa alır. İstek yolunu bloklamamak
 * için `route()` bunu `queueMicrotask` ile çağırır.
 *
 * @param {string} html
 * @param {{ path: string, req?: { get?: (name: string) => string | undefined,
 *   headers?: Record<string, unknown> } }} context
 * @returns {void}
 */
export function noteVisitWarm(html, context) {
  if (!isOnVisitPrewarm() || !visitOrigin) return;
  if (!context?.path || typeof html !== "string") return;

  const ua =
    context.req?.get?.("user-agent") ??
    /** @type {string | undefined} */ (context.req?.headers?.["user-agent"]);
  if (ua && ua === getConfig().brand.prewarmUserAgent) return;

  const perPage = Number(getConfig().prewarm?.onVisit?.perPage) || 20;
  const links = extractSameOriginLinks(html, {
    limit: perPage,
    basePath: context.path,
  });

  for (const path of links) {
    if (path === context.path) continue;
    if (isHtmlCacheFresh(path)) continue;
    if (visitQueued.has(path)) continue;
    visitQueued.add(path);
    visitPending.push(path);
  }

  enqueueInvalidatedForVisit();
  if (visitPending.length) void drainVisitWarm();
}

/**
 * Invalidate edilmiş yolları da kuyruğa alır (klasik turdaki
 * `takeInvalidatedPaths` karşılığı).
 *
 * @returns {void}
 */
function enqueueInvalidatedForVisit() {
  for (const path of takeInvalidatedPaths()) {
    if (visitQueued.has(path)) continue;
    visitQueued.add(path);
    visitPending.push(path);
  }
}

async function drainVisitWarm() {
  if (visitDraining || !visitOrigin) return;
  visitDraining = true;

  const onVisit = getConfig().prewarm?.onVisit ?? {};

  try {
    while (visitPending.length) {
      enqueueInvalidatedForVisit();

      const batch = visitPending.splice(0, 32);
      for (const path of batch) visitQueued.delete(path);

      const cold = batch.filter((path) => !isHtmlCacheFresh(path));
      if (!cold.length) continue;

      // Klasik `prewarm()` turunu yeniden kullan: retry, progress, UA aynı.
      // onVisit.concurrency / rps verilmişse `visitWarmSettings` ile iner;
      // yoksa `prewarm()` kendi (env → config → isDev) zincirine düşer.
      visitWarmSettings.concurrency = onVisit.concurrency;
      visitWarmSettings.rps = onVisit.rps;

      try {
        await prewarm({ origin: visitOrigin, paths: cold, quiet: true });
      } catch (error) {
        console.error("[prewarm] onVisit warm failed", error);
      } finally {
        visitWarmSettings.concurrency = null;
        visitWarmSettings.rps = null;
      }
    }
  } finally {
    visitDraining = false;
    if (visitPending.length) void drainVisitWarm();
  }
}

/**
 * Açılışta ısıtmayı tetikler. `listen` geri çağrısından çağrılır.
 * `onVisit` modunda zamanlayıcı yok: yalnızca origin kaydı ve kuyruk.
 *
 * @param {{ port: number }} options
 * @returns {void}
 */
export function startPrewarm({ port }) {
  const config = getConfig();
  if (process.env.PREWARM === "0") return;

  const origin = `http://127.0.0.1:${port}`;

  if (config.prewarm?.onVisit?.enabled) {
    const classicEnv = CLASSIC_PREWARM_ENV.filter((key) => process.env[key]);
    if (classicEnv.length) {
      throw new Error(
        "[prewarm] onVisit mode cannot be used with " +
          `${classicEnv.join(", ")}. Those env vars belong to classic prewarm.`,
      );
    }

    visitOrigin = origin;
    console.log(
      `[prewarm] onVisit mode — warming links from each public page response`,
    );
    return;
  }

  if (process.env.PREWARM !== "1" && config.prewarm?.enabled === false) return;
  // Isıtacak yol bildirmeyen bir projede zamanlayıcı kurmanın anlamı yok.
  if (typeof config.hooks?.prewarmPaths !== "function") return;

  const isDev = process.env.NODE_ENV === "development";

  // Hız frenli bir tur `intervalSeconds`'tan uzun sürebilir; üst üste binen
  // turlar `prewarmProgress`'i bozar ve upstream'e iki kat yük bindirir.
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await prewarm({ origin });
    } catch (error) {
      console.error("[prewarm] failed", error);
    } finally {
      running = false;
    }
  };

  // Isıtma ilk isteklerle yarışmasın diye gecikmeyle başlar. Dev'de gecikme
  // daha uzun: dosya kaydı süreci yeniden başlattığı için zamanlayıcı da
  // ölür; yalnızca sunucu bir süre sakin kalınca ısınır.
  const delay = setting("PREWARM_DELAY_MS", "delayMs", isDev ? 3000 : 500);
  setTimeout(() => void run(), delay).unref();

  // Girdiler `revalidate` ile yaşlanır; stale-while-revalidate sayesinde
  // ziyaretçi beklemez. Periyodik tur, hiç ziyaret edilmeyen sayfaları da
  // sıcak tutmak isteyen kurulumlar için opsiyoneldir.
  // `rotate` ile birlikte bu ayar "damla damla ısıtma"ya dönüşür: her tur
  // kuyruğun bir dilimini alır, yeterli tur sonunda liste baştan sona ısınır.
  const interval = setting("PREWARM_INTERVAL_SECONDS", "intervalSeconds", 0);
  if (interval > 0) setInterval(() => void run(), interval * 1000).unref();
}
