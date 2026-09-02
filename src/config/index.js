/**
 * `jskelet.config.mjs` yükleyicisi ve çözümlenmiş proje durumu.
 *
 * Bu modül framework'ün **tek gerçek kaynağıdır**: proje kökü, dizin yolları,
 * markalama, hook'lar ve `headers/redirects/rewrites/cache` kuralları burada
 * normalize edilir. Diğer modüller yol hesaplamaz, `getConfig()` çağırır.
 * Böylece framework `node_modules/` içine girdiğinde hiçbir dosyada
 * `../..` sayma hatası oluşmaz.
 *
 * Config dosyası **zorunlu değildir**: yoksa ya da okunamıyorsa uyarı basılır
 * ve sunucu varsayılanlarla ayağa kalkar. Bozuk bir düzenleme siteyi
 * açılamaz hâle getirmemeli.
 *
 * Desteklenen bölümler (hepsi opsiyonel, hepsi `async` olabilir):
 *   headers()   → [{ source, headers: [{ key, value }] }]
 *   redirects() → [{ source, destination, permanent?, statusCode? }]
 *   rewrites()  → [{ source, destination }] | { beforeFiles?, afterFiles? }
 *   cache()     → { html?: { [source]: saniye },
 *                   query?: { [source]: string[] | true }, maxEntries?: number,
 *                   data?: {...}, redis?: {...}, prewarm?: {...} }
 *   admin()     → { enabled?, basePath?, allowIps?, blockBots?, … }
 *   logs        → { console?, kinds?, file?, s3? }
 *
 * Fonksiyon olmayan bölümler (`brand`, `security`, `static`, `navigation`…)
 * düz nesne olarak okunur. `logs` fonksiyon ya da düz nesne olabilir.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { compilePattern, matchPattern } from "./pattern.js";
import {
  DEFAULT_ADMIN,
  DEFAULT_BRAND,
  DEFAULT_CLOUDFLARE,
  DEFAULT_DATA_CACHE,
  DEFAULT_DEV_GATE_BYPASS,
  DEFAULT_DIRS,
  DEFAULT_HTML_CACHE_MAX_ENTRIES,
  DEFAULT_LOGS,
  DEFAULT_NAVIGATION,
  DEFAULT_NAVIGATION_EXCLUDE,
  DEFAULT_PREWARM,
  DEFAULT_PREWARM_SKIP,
  DEFAULT_REDIS,
  DEFAULT_SECURITY,
  DEFAULT_STATIC,
  DEFAULT_TRANSIENT_RETRY,
  DEFAULT_UPSTREAM_LIMIT,
} from "./defaults.js";

/** Framework paketinin kökü — kendi şablonlarına ve varlıklarına erişir. */
export const FRAMEWORK_ROOT = path.resolve(import.meta.dirname, "..", "..");

const CONFIG_FILE = "jskelet.config.mjs";

/**
 * @typedef {"conservative" | "moderate" | "eager"} Eagerness
 *
 * @typedef {object} NavigationConfig
 * @property {false | Eagerness} prefetch
 * @property {false | Eagerness} prerender
 * @property {boolean} viewTransition
 * @property {string[]} exclude Spekülasyon dışı bırakılan href desenleri.
 */

/**
 * @typedef {object} RedisConfig
 * @property {boolean} enabled
 * @property {string | null} url
 * @property {string} namespace
 * @property {string} keyPrefix
 * @property {boolean} html HTML gövdeleri paylaşılsın mı.
 * @property {boolean} data Veri önbelleği paylaşılsın mı.
 * @property {boolean} storeEncoded Sıkıştırılmış gövdeler de paylaşılsın mı.
 * @property {boolean} events pub/sub invalidation yayını.
 * @property {number} commandTimeoutMs
 */

/**
 * @typedef {"http" | "event" | "error"} LogKind
 *
 * @typedef {object} LogsConfig
 * @property {boolean} console Runtime http/event/error satırları stdout'a
 *   basılsın mı (banner/build satırları etkilenmez).
 * @property {LogKind[]} kinds Sink'lere giden kayıt türleri.
 * @property {{ enabled: boolean, dir: string, rotate: "daily" }} file
 * @property {{ enabled: boolean, bucket: string | null, prefix: string,
 *   region: string | null, endpoint: string | null, flushIntervalMs: number,
 *   maxBatch: number }} s3
 */

/**
 * @typedef {import('./pattern.js').CompiledPattern} CompiledPattern
 *
 * @typedef {object} ResolvedConfig
 * @property {string} root Proje kökü (mutlak).
 * @property {boolean} loaded Config dosyası okundu mu.
 * @property {Record<string, string>} dirs Mutlak dizin yolları.
 * @property {{ pattern: CompiledPattern, headers: { key: string, value: string }[] }[]} headers
 * @property {{ pattern: CompiledPattern, destination: string, statusCode: number }[]} redirects
 * @property {{ phase: "beforeFiles" | "afterFiles", pattern: CompiledPattern, destination: string }[]} rewrites
 * @property {{ pattern: CompiledPattern, seconds: number }[]} html
 * @property {{ pattern: CompiledPattern, allow: true | string[] }[]} cacheQuery
 *   Yol deseni başına, HTML cache anahtarına girmesine izin verilen query
 *   parametreleri. Eşleşen kural yoksa query'li istek cache'lenmez.
 * @property {number} htmlMaxEntries HTML önbelleğinin girdi sınırı.
 * @property {Record<string, unknown>} data Upstream veri önbelleği ayarları.
 * @property {boolean} trackUpstream `fetch` sarılıp geçici hatalar otomatik bildirilsin mi.
 * @property {boolean} trackDependencies Render'ın okuduğu veri anahtarları kaydedilsin mi.
 * @property {{ attempts: number, delayMs: number }} transientRetry
 * @property {RedisConfig} redis Opsiyonel Redis ikinci kademesi.
 * @property {typeof DEFAULT_UPSTREAM_LIMIT} upstream Upstream hız freni.
 * @property {LogsConfig} logs Kalıcı log sink'leri (dosya + S3).
 * @property {typeof DEFAULT_ADMIN} admin Framework yönetim paneli.
 * @property {typeof DEFAULT_CLOUDFLARE} cloudflare Cloudflare cache yüzeyi.
 * @property {Record<string, unknown>} prewarm
 * @property {{ source: string, test: (pathname: string) => boolean }[]} prewarmPriority
 * @property {Record<string, unknown>} brand
 * @property {Record<string, Function>} hooks
 * @property {string} layout Layout `.ejs` dosyasının mutlak yolu.
 * @property {string[] | null} routes Açık route modülü listesi.
 * @property {boolean} trailingSlash URL'ler `/` ile bitsin mi (Next `trailingSlash`).
 * @property {{ extensions: Set<string>, prefixes: string[] }} static
 * @property {string[]} devGateBypass
 * @property {string[]} preconnect
 * @property {NavigationConfig} navigation
 * @property {SecurityConfig} security
 * @property {string[]} prewarmSkip
 * @property {string[]} watch Dev sunucusunun izlediği ek dizinler.
 * @property {{ family: string, slug?: string, weights: number[] }[]} fonts
 * @property {{ scan?: string[] } | false} icons
 * @property {{ widths?: number[], quality?: number, skip?: string[] } | false} images
 * @property {string[]} clientEnv Client bundle'a gömülecek env anahtarları.
 */

/** @type {ResolvedConfig | null} */
let config = null;

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {unknown[]}
 */
function asArray(value, label) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  console.warn(`[config] ${label} must return an array, ignoring it`);
  return [];
}

/**
 * @param {unknown} raw
 * @returns {ResolvedConfig["headers"]}
 */
function normalizeHeaders(raw) {
  /** @type {ResolvedConfig["headers"]} */
  const out = [];

  for (const entry of asArray(raw, "headers()")) {
    const pattern = compilePattern(entry?.source);
    if (!pattern) continue;

    const headers = asArray(entry?.headers, "headers()[].headers")
      .filter((header) => header?.key && header?.value !== undefined)
      .map((header) => ({ key: String(header.key), value: String(header.value) }));

    if (headers.length) out.push({ pattern, headers });
  }

  return out;
}

/**
 * @param {unknown} raw
 * @returns {ResolvedConfig["redirects"]}
 */
function normalizeRedirects(raw) {
  /** @type {ResolvedConfig["redirects"]} */
  const out = [];

  for (const entry of asArray(raw, "redirects()")) {
    const pattern = compilePattern(entry?.source);
    if (!pattern || typeof entry?.destination !== "string") continue;

    // Next semantiği: permanent → 308, geçici → 307. Farklı bir kod isteyen
    // `statusCode` verebilir (ör. eski kurulumlarla uyum için 301).
    const statusCode = Number(entry.statusCode) || (entry.permanent ? 308 : 307);

    out.push({ pattern, destination: entry.destination, statusCode });
  }

  return out;
}

/**
 * @param {unknown} raw
 * @returns {ResolvedConfig["rewrites"]}
 */
function normalizeRewrites(raw) {
  /** @type {ResolvedConfig["rewrites"]} */
  const out = [];

  /** @type {[("beforeFiles" | "afterFiles"), unknown][]} */
  const phases = Array.isArray(raw)
    ? [["afterFiles", raw]]
    : [
        ["beforeFiles", raw?.beforeFiles],
        ["afterFiles", raw?.afterFiles],
      ];

  for (const [phase, entries] of phases) {
    for (const entry of asArray(entries, `rewrites().${phase}`)) {
      const pattern = compilePattern(entry?.source);
      if (!pattern || typeof entry?.destination !== "string") continue;
      out.push({ phase, pattern, destination: entry.destination });
    }
  }

  return out;
}

/**
 * Isıtma sırası desenleri. İki biçim kabul edilir: config'in her yerinde
 * geçerli olan `/haber/:slug` sözdizimi ve doğrudan `RegExp` — ikincisi
 * "sonu `-yorumlar` ile bitenler" gibi desen sözdiziminin karşılamadığı
 * kuralları yazabilmek için.
 *
 * @param {unknown} raw
 * @returns {ResolvedConfig["prewarmPriority"]}
 */
function normalizePriority(raw) {
  /** @type {ResolvedConfig["prewarmPriority"]} */
  const out = [];

  for (const entry of asArray(raw, "cache().prewarm.priority")) {
    if (entry instanceof RegExp) {
      out.push({ source: String(entry), test: (pathname) => entry.test(pathname) });
      continue;
    }

    const pattern = compilePattern(entry);
    if (!pattern) continue;
    out.push({
      source: pattern.source,
      test: (pathname) => matchPattern(pattern, pathname) !== null,
    });
  }

  return out;
}

/**
 * Redis bölümü. Bozuk bir değer sunucuyu düşürmemeli: her alan tipine
 * zorlanır ve `enabled` yalnızca açıkça `true` verildiğinde açılır.
 *
 * @param {unknown} raw
 * @returns {RedisConfig}
 */
function normalizeRedis(raw) {
  const source = /** @type {Record<string, any>} */ (raw ?? {});
  const timeout = Number(source.commandTimeoutMs);

  return {
    enabled: source.enabled === true,
    url: typeof source.url === "string" && source.url ? source.url : null,
    namespace: String(source.namespace ?? DEFAULT_REDIS.namespace),
    keyPrefix: String(source.keyPrefix ?? DEFAULT_REDIS.keyPrefix),
    html: source.html !== false,
    data: source.data !== false,
    storeEncoded: source.storeEncoded === true,
    events: source.events !== false,
    commandTimeoutMs:
      Number.isFinite(timeout) && timeout > 0
        ? Math.floor(timeout)
        : DEFAULT_REDIS.commandTimeoutMs,
  };
}

/**
 * Upstream hız freni. Sayısal alanlar tipine zorlanır; bozuk bir değer freni
 * yanlış ayarlamak yerine varsayılana döner.
 *
 * @param {unknown} raw
 * @returns {typeof DEFAULT_UPSTREAM_LIMIT}
 */
function normalizeUpstream(raw) {
  const source = /** @type {Record<string, any>} */ (raw ?? {});
  const merged = { ...DEFAULT_UPSTREAM_LIMIT, ...source };

  /** @param {string} key */
  const positive = (key) => {
    const value = Number(merged[key]);
    return Number.isFinite(value) && value >= 0
      ? value
      : /** @type {any} */ (DEFAULT_UPSTREAM_LIMIT)[key];
  };

  /** @type {Record<string, Record<string, number>>} */
  const hosts = {};
  for (const [host, override] of Object.entries(merged.hosts ?? {})) {
    if (override && typeof override === "object") hosts[host] = override;
  }

  return {
    ...merged,
    rate: positive("rate"),
    burst: positive("burst"),
    concurrency: Math.max(1, Math.floor(positive("concurrency"))),
    minRate: positive("minRate"),
    increaseStep: positive("increaseStep"),
    increaseIntervalMs: positive("increaseIntervalMs"),
    decreaseIntervalMs: positive("decreaseIntervalMs"),
    breakerFailures: Math.floor(positive("breakerFailures")),
    breakerCooldownMs: positive("breakerCooldownMs"),
    hosts,
  };
}

/**
 * Yönetim paneli. `enabled` yalnızca açıkça `true` verildiğinde ya da
 * `JSKELET_ADMIN` ortam değişkeni ayarlandığında açılır: paneli yanlışlıkla
 * açmanın bedeli, önbelleği boşaltabilen bir ucu internete koymak.
 *
 * Ortam değişkeni config'in **üstünde** duruyor, çünkü paneli genelde bir
 * arıza sırasında tek seferlik açmak isteniyor ve o an config dosyasını
 * değiştirip yeniden dağıtmak istenmiyor. `JSKELET_ADMIN=0` aynı mantıkla
 * config'te açık olan paneli kapatır.
 *
 * @param {unknown} raw
 * @returns {typeof DEFAULT_ADMIN}
 */
function normalizeAdmin(raw) {
  const source = /** @type {Record<string, any>} */ (raw ?? {});
  const env = process.env.JSKELET_ADMIN;

  const basePath =
    typeof source.basePath === "string" && source.basePath.startsWith("/")
      ? source.basePath.replace(/\/+$/, "")
      : DEFAULT_ADMIN.basePath;

  /** @param {string} key @param {number} min */
  const positive = (key, min) => {
    const value = Number(source[key]);
    return Number.isFinite(value) && value >= min
      ? value
      : /** @type {any} */ (DEFAULT_ADMIN)[key];
  };

  const allowIps = Array.isArray(source.allowIps)
    ? source.allowIps
        .filter((entry) => typeof entry === "string" && entry.trim())
        .map((entry) => entry.trim())
    : [...DEFAULT_ADMIN.allowIps];

  const logSize = Number(source.logSize);

  return {
    enabled:
      env === undefined
        ? source.enabled === true
        : env !== "0" && env !== "false" && env !== "",
    basePath: basePath || DEFAULT_ADMIN.basePath,
    allowIps,
    blockBots: source.blockBots !== false,
    banAttempts: Math.floor(positive("banAttempts", 1)),
    banHours: positive("banHours", 0),
    sessionHours: positive("sessionHours", 0),
    logSize:
      Number.isFinite(logSize) && logSize >= 50
        ? Math.min(5000, Math.floor(logSize))
        : DEFAULT_ADMIN.logSize,
  };
}

/**
 * Cloudflare bölümü. Token burada da verilebiliyor ama önerilen yol env;
 * normalizasyon sadece tipleri sabitler, sırrı okumak `cloudflare.js`'in işi.
 *
 * @param {unknown} raw
 * @returns {typeof DEFAULT_CLOUDFLARE}
 */
function normalizeCloudflare(raw) {
  const source = /** @type {Record<string, any>} */ (raw ?? {});
  const hours = Number(source.analyticsHours);

  /** @param {unknown} value */
  const text = (value) => (typeof value === "string" && value ? value : null);

  return {
    enabled: source.enabled !== false,
    zoneId: text(source.zoneId),
    apiToken: text(source.apiToken),
    // Şema yazılırsa purge URL'i `https://https://…` olur; baştaki şema atılır.
    hostname: text(source.hostname)?.replace(/^https?:\/\//, "") ?? null,
    analyticsHours:
      Number.isFinite(hours) && hours > 0
        ? Math.min(72, Math.floor(hours))
        : DEFAULT_CLOUDFLARE.analyticsHours,
  };
}

const LOG_KINDS = new Set(["http", "event", "error"]);

/**
 * `bucket`, `JSKELET_LOG_BUCKET` veya `JSKELET_S3_BUCKET` değeri
 * `ayberkenis/jskelet/logs` gibi bir yol olabilir: ilk segment bucket adı,
 * kalanı nesne öneki. Böylece tek env ile hem kova hem klasör verilmiş olur.
 *
 * @param {string | null} value
 * @returns {{ bucket: string | null, prefix: string | null }}
 *   `prefix` null → yol öneki taşımıyor; config/varsayılan kalsın.
 */
export function splitS3BucketPath(value) {
  if (!value) return { bucket: null, prefix: null };

  const trimmed = value.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return { bucket: null, prefix: null };

  const slash = trimmed.indexOf("/");
  if (slash < 0) return { bucket: trimmed, prefix: null };

  const bucket = trimmed.slice(0, slash);
  const rest = trimmed.slice(slash + 1).replace(/^\/+|\/+$/g, "");
  if (!bucket) return { bucket: null, prefix: null };

  return {
    bucket,
    prefix: rest ? `${rest}/` : null,
  };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function envText(value) {
  return typeof value === "string" && value ? value : null;
}

/**
 * @returns {{ accessKeyId: string, secretAccessKey: string,
 *   sessionToken: string | null } | null}
 */
export function readS3CredentialsFromEnv() {
  const accessKeyId = envText(process.env.JSKELET_S3_ACCESS_KEY_ID);
  const secretAccessKey =
    envText(process.env.JSKELET_S3_SECRET_ACCESS_KEY) ??
    envText(process.env.JSKELET_S3_ACCESS_SECRET);
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: envText(process.env.JSKELET_S3_SESSION_TOKEN),
  };
}

/**
 * Log hedefi. Öncelik: `JSKELET_LOG_BUCKET` → `JSKELET_S3_BUCKET`
 * (+ isteğe bağlı `JSKELET_S3_KEY_PREFIX`).
 *
 * @returns {string | null}
 */
function resolveLogBucketEnv() {
  const logPath = envText(process.env.JSKELET_LOG_BUCKET);
  if (logPath) return logPath;

  const bucket = envText(process.env.JSKELET_S3_BUCKET);
  if (!bucket) return null;

  const prefix = envText(process.env.JSKELET_S3_KEY_PREFIX);
  return prefix ? `${bucket}/${prefix}` : bucket;
}

/**
 * Kalıcı log sink'leri. Bozuk bir `kinds` listesi siteyi düşürmemeli —
 * bilinmeyen girdiler atılır; hiç geçerli tür kalmazsa varsayılana dönülür.
 *
 * @param {unknown} raw
 * @returns {LogsConfig}
 */
export function normalizeLogs(raw) {
  const source = /** @type {Record<string, any>} */ (raw ?? {});
  const fileRaw = /** @type {Record<string, any>} */ (source.file ?? {});
  const s3Raw = /** @type {Record<string, any>} */ (source.s3 ?? {});

  /** @type {LogKind[]} */
  let kinds = DEFAULT_LOGS.kinds;
  if (Array.isArray(source.kinds)) {
    const filtered = source.kinds.filter(
      (entry) => typeof entry === "string" && LOG_KINDS.has(entry),
    );
    if (filtered.length) kinds = /** @type {LogKind[]} */ ([...new Set(filtered)]);
    else {
      console.warn(
        "[config] logs.kinds has no valid entries (http|event|error), using defaults",
      );
    }
  } else if (source.kinds != null) {
    console.warn("[config] logs.kinds must be an array, using defaults");
  }

  const flush = Number(s3Raw.flushIntervalMs);
  const batch = Number(s3Raw.maxBatch);

  const bucketPath = splitS3BucketPath(
    resolveLogBucketEnv() ?? envText(s3Raw.bucket),
  );

  const configPrefix =
    typeof s3Raw.prefix === "string" && s3Raw.prefix
      ? s3Raw.prefix.endsWith("/")
        ? s3Raw.prefix
        : `${s3Raw.prefix}/`
      : DEFAULT_LOGS.s3.prefix;

  const endpoint =
    envText(process.env.JSKELET_S3_API_URL) ?? envText(s3Raw.endpoint);

  // Uyumlu API'lerde (Cloudflare R2 vb.) imza bölgesi çoğu zaman `auto`.
  // Region hiçbir kurulumda zorunlu değil.
  const region =
    envText(s3Raw.region) ??
    envText(process.env.JSKELET_S3_REGION) ??
    "auto";

  const credentials = readS3CredentialsFromEnv();
  // `JSKELET_LOG_BUCKET` (veya S3 bucket) + credential varsa config'te
  // `enabled: true` unutulmuş olsa bile aç. Açık `enabled: false` ezer.
  const envWantsLogs = Boolean(
    envText(process.env.JSKELET_LOG_BUCKET) ||
      envText(process.env.JSKELET_S3_BUCKET),
  );
  const enabled =
    s3Raw.enabled === true ||
    (s3Raw.enabled !== false &&
      envWantsLogs &&
      Boolean(credentials) &&
      Boolean(bucketPath.bucket));

  return {
    console: source.console !== false,
    kinds,
    file: {
      enabled: fileRaw.enabled === true,
      dir:
        typeof fileRaw.dir === "string" && fileRaw.dir.trim()
          ? fileRaw.dir.trim()
          : DEFAULT_LOGS.file.dir,
      rotate: "daily",
    },
    s3: {
      enabled,
      bucket: bucketPath.bucket,
      // Yoldaki önek tek env ile klasör vermeyi mümkün kılar; yoksa config.
      prefix: bucketPath.prefix ?? configPrefix,
      region,
      endpoint,
      flushIntervalMs:
        Number.isFinite(flush) && flush >= 500
          ? Math.min(60_000, Math.floor(flush))
          : DEFAULT_LOGS.s3.flushIntervalMs,
      maxBatch:
        Number.isFinite(batch) && batch >= 1
          ? Math.min(5000, Math.floor(batch))
          : DEFAULT_LOGS.s3.maxBatch,
    },
  };
}

/**
 * `cache().query` → yol deseni başına, cache anahtarına girmesine izin verilen
 * query parametreleri.
 *
 * Varsayılan bilinçli olarak "query varsa sayfa dinamik": bir yolun bütün
 * query varyantlarını cache'lemek, `?utm_source=…` gibi sonsuz sayıda anahtar
 * üretip LRU'daki gerçek sayfaları dışarı atıyor. Hangi parametrenin çıktıyı
 * gerçekten değiştirdiğini yalnızca uygulama bilir, o yüzden izin listesi
 * config'ten gelir.
 *
 * Bir desen `true` ile eşlenirse bütün parametreler anahtara girer (eski
 * davranış), `[]` ile eşlenirse hiçbiri girmez — yani query yok sayılır ve
 * bütün varyantlar query'siz sürümün HTML'ini paylaşır.
 *
 * @param {unknown} raw
 * @returns {ResolvedConfig["cacheQuery"]}
 */
function normalizeQueryRules(raw) {
  /** @type {ResolvedConfig["cacheQuery"]} */
  const out = [];

  for (const [source, value] of Object.entries(raw ?? {})) {
    const pattern = compilePattern(source);
    if (!pattern) continue;

    if (value === true) {
      out.push({ pattern, allow: true });
      continue;
    }
    if (value === false) continue;

    const allow = asArray(
      typeof value === "string" ? [value] : value,
      `cache().query["${source}"]`,
    )
      .filter((name) => typeof name === "string" && name)
      .map(String);
    out.push({ pattern, allow });
  }

  return out;
}

/**
 * @param {unknown} raw
 * @returns {{ html: ResolvedConfig["html"],
 *   cacheQuery: ResolvedConfig["cacheQuery"], htmlMaxEntries: number,
 *   data: Record<string, unknown>, trackUpstream: boolean,
 *   trackDependencies: boolean,
 *   transientRetry: { attempts: number, delayMs: number },
 *   redis: RedisConfig,
 *   upstream: typeof DEFAULT_UPSTREAM_LIMIT,
 *   cloudflare: typeof DEFAULT_CLOUDFLARE,
 *   prewarm: Record<string, unknown>,
 *   prewarmPriority: ResolvedConfig["prewarmPriority"] }}
 */
function normalizeCache(raw) {
  /** @type {ResolvedConfig["html"]} */
  const html = [];

  for (const [source, seconds] of Object.entries(raw?.html ?? {})) {
    const pattern = compilePattern(source);
    const value = Number(seconds);
    if (!pattern || !Number.isFinite(value) || value < 0) continue;
    html.push({ pattern, seconds: value });
  }

  const prewarm = { ...DEFAULT_PREWARM, ...(raw?.prewarm ?? {}) };
  const queryRules = normalizeQueryRules(raw?.query);
  const maxEntries = Number(raw?.maxEntries);

  return {
    html,
    cacheQuery: queryRules,
    htmlMaxEntries:
      Number.isFinite(maxEntries) && maxEntries > 0
        ? Math.floor(maxEntries)
        : DEFAULT_HTML_CACHE_MAX_ENTRIES,
    data: { ...DEFAULT_DATA_CACHE, ...(raw?.data ?? {}) },
    // Otomatik upstream izleme kapatılabilir olmalı: `fetch`i kendisi saran
    // bir uygulama (ölçüm, retry, circuit breaker) çakışma yaşayabilir.
    trackUpstream: raw?.trackUpstream !== false,
    // Hangi sayfanın hangi veri anahtarını okuduğu kaydedilsin mi.
    // `withDataCache` kullanmayan bir uygulamada kaydedilecek bir şey yok;
    // kapatmak bağlam kurma maliyetini de kaldırır.
    trackDependencies: raw?.trackDependencies !== false,
    transientRetry:
      raw?.transientRetry === false
        ? { attempts: 0, delayMs: 0 }
        : { ...DEFAULT_TRANSIENT_RETRY, ...(raw?.transientRetry ?? {}) },
    redis: normalizeRedis(raw?.redis),
    upstream: normalizeUpstream(raw?.upstream),
    cloudflare: normalizeCloudflare(raw?.cloudflare),
    // Desenler derlenmiş hâlde ayrı alanda tutulur: `prewarm` sayısal
    // ayarların düz torbası olarak kalsın, her turda yeniden derlenmesin.
    prewarm,
    prewarmPriority: normalizePriority(prewarm.priority),
  };
}

/** Speculation Rules'un tanıdığı eagerness değerleri. */
const EAGERNESS = new Set(["conservative", "moderate", "eager"]);

/**
 * `true` → varsayılan eagerness, `false` → kapalı, string → doğrulanır.
 * Geçersiz bir değer siteyi düşürmemeli; uyarı basılıp varsayılana dönülür.
 *
 * @param {unknown} value
 * @param {false | Eagerness} fallback
 * @param {string} label
 * @returns {false | Eagerness}
 */
function normalizeEagerness(value, fallback, label) {
  if (value === undefined) return fallback;
  if (value === false) return false;
  if (value === true) return fallback === false ? "moderate" : fallback;
  if (typeof value === "string" && EAGERNESS.has(value)) {
    return /** @type {Eagerness} */ (value);
  }

  console.warn(
    `[config] navigation.${label} is invalid (${String(value)}), falling back to the default`,
  );
  return fallback;
}

/**
 * @param {unknown} raw
 * @param {Record<string, unknown>} brand
 * @returns {NavigationConfig}
 */
function normalizeNavigation(raw, brand) {
  const source = /** @type {Record<string, unknown>} */ (raw ?? {});

  // Dev araçlarının yolu spekülasyona kapalı: overlay ve rapor uçları gerçek
  // sayfa değil, önden getirilmelerinin hiçbir karşılığı yok.
  const devBase = typeof brand.devBasePath === "string" ? brand.devBasePath : null;

  return {
    prefetch: normalizeEagerness(
      source.prefetch,
      DEFAULT_NAVIGATION.prefetch,
      "prefetch",
    ),
    prerender: normalizeEagerness(
      source.prerender,
      DEFAULT_NAVIGATION.prerender,
      "prerender",
    ),
    viewTransition: source.viewTransition === true,
    exclude: [
      ...DEFAULT_NAVIGATION_EXCLUDE,
      ...(devBase ? [`${devBase}/*`] : []),
      ...asArray(source.exclude, "navigation.exclude").filter(
        (entry) => typeof entry === "string",
      ),
    ].map(String),
  };
}

/**
 * @typedef {object} SecurityConfig
 * @property {boolean} trustProxy
 * @property {string | null} cookieSecret
 * @property {{ enabled: boolean, token: boolean, allowedOrigins: string[],
 *   exclude: CompiledPattern[], cookieName: string, fieldName: string,
 *   headerName: string }} csrf
 */

/**
 * Güvenlik bölümü. `csrf.exclude` desenleri burada derlenir: her istekte
 * yeniden derlemek gereksiz, ve bozuk bir desen sunucuyu düşürmemeli.
 *
 * @param {unknown} raw
 * @returns {SecurityConfig}
 */
function normalizeSecurity(raw) {
  const source = /** @type {Record<string, any>} */ (raw ?? {});
  const csrf = { ...DEFAULT_SECURITY.csrf, ...(source.csrf ?? {}) };

  const exclude = asArray(csrf.exclude, "security.csrf.exclude")
    .map((entry) => compilePattern(entry))
    .filter((pattern) => pattern !== null);

  return {
    trustProxy: source.trustProxy !== false,
    cookieSecret:
      typeof source.cookieSecret === "string" && source.cookieSecret
        ? source.cookieSecret
        : null,
    csrf: {
      enabled: csrf.enabled !== false,
      token: csrf.token === true,
      allowedOrigins: asArray(csrf.allowedOrigins, "security.csrf.allowedOrigins")
        .filter((entry) => typeof entry === "string")
        .map(String),
      exclude: /** @type {CompiledPattern[]} */ (exclude),
      cookieName: String(csrf.cookieName ?? DEFAULT_SECURITY.csrf.cookieName),
      fieldName: String(csrf.fieldName ?? DEFAULT_SECURITY.csrf.fieldName),
      headerName: String(csrf.headerName ?? DEFAULT_SECURITY.csrf.headerName).toLowerCase(),
    },
  };
}

/**
 * Dizin adlarını mutlak yola çevirir. `styles` bir dosya yolu olduğu için
 * de aynı çözümlemeden geçer; ayrı bir alan tutmaya değmez.
 *
 * @param {string} root
 * @param {Record<string, string>} [overrides]
 * @returns {Record<string, string>}
 */
function resolveDirs(root, overrides) {
  /** @type {Record<string, string>} */
  const dirs = {};
  const merged = { ...DEFAULT_DIRS, ...(overrides ?? {}) };

  for (const [key, value] of Object.entries(merged)) {
    dirs[key] = path.resolve(root, value);
  }

  // Build çıktısı `public/assets` altına yazılır; ayrı ayar gerektirmeyecek
  // kadar sabit ama yol hesabı tek yerde kalsın.
  dirs.assets = path.join(dirs.public, "assets");
  dirs.fonts = path.join(dirs.public, "fonts");

  return dirs;
}

/**
 * Uygulamanın layout'u yoksa framework'ün minimal layout'u kullanılır. Bu
 * sayede yeni bir proje tek bir route ile çalışır hâle gelir.
 *
 * @param {Record<string, string>} dirs
 * @param {string} [override]
 * @returns {string}
 */
function resolveLayout(dirs, override) {
  if (override) return path.resolve(dirs.views, "..", override);

  const appLayout = path.join(dirs.views, "layout.ejs");
  if (fs.existsSync(appLayout)) return appLayout;

  return path.join(FRAMEWORK_ROOT, "src", "templates", "layout.ejs");
}

/**
 * Config'i okur, normalize eder ve modül durumuna yazar. Sunucu ve build
 * süreçleri açılışta bir kez çağırır.
 *
 * Aynı süreçte ikinci çağrı önbelleğe düşer: `jskelet start` hem
 * `ensure-build` hem `createApp` üzerinden çağırıyor ve config'i iki kez
 * okuyup iki kez loglamanın hiçbir faydası yok. Yeniden okumak gerekiyorsa
 * `force: true`.
 *
 * @param {{ root?: string, configFile?: string, force?: boolean }} [options]
 * @returns {Promise<ResolvedConfig>}
 */
export async function loadConfig(options = {}) {
  if (config && !options.force) return config;

  const root = path.resolve(options.root ?? process.cwd());
  const configFile = options.configFile ?? CONFIG_FILE;
  const configPath = path.join(root, configFile);

  /** @type {Record<string, any>} */
  let source = {};
  let loaded = false;

  if (!fs.existsSync(configPath)) {
    console.warn(
      `[config] ${configFile} not found — continuing with built-in defaults.`,
    );
  } else {
    try {
      // Windows'ta mutlak yol import'u için file:// şeması gerekir.
      const module = await import(pathToFileURL(configPath).href);
      source = module.default ?? module;
      loaded = true;
    } catch (error) {
      console.warn(`[config] ${configFile} failed to load, ignoring it`, error);
    }
  }

  /** @param {string} name */
  const section = async (name) => {
    const value = source?.[name];
    if (value == null) return null;
    try {
      return typeof value === "function" ? await value.call(source) : value;
    } catch (error) {
      console.warn(`[config] ${name}() threw, ignoring it`, error);
      return null;
    }
  };

  const [headers, redirects, rewrites, cache, admin, logs] = await Promise.all([
    section("headers"),
    section("redirects"),
    section("rewrites"),
    section("cache"),
    section("admin"),
    section("logs"),
  ]);

  const {
    html,
    cacheQuery,
    htmlMaxEntries,
    data,
    trackUpstream,
    trackDependencies,
    transientRetry,
    redis,
    upstream,
    cloudflare,
    prewarm,
    prewarmPriority,
  } = normalizeCache(cache);
  const dirs = resolveDirs(root, source.paths);
  const brand = { ...DEFAULT_BRAND, ...(source.brand ?? {}) };

  config = {
    root,
    loaded,
    dirs,
    headers: normalizeHeaders(headers),
    redirects: normalizeRedirects(redirects),
    rewrites: normalizeRewrites(rewrites),
    html,
    cacheQuery,
    htmlMaxEntries,
    data,
    trackUpstream,
    trackDependencies,
    transientRetry,
    redis,
    upstream,
    logs: normalizeLogs(logs),
    admin: normalizeAdmin(admin),
    cloudflare,
    prewarm,
    prewarmPriority,
    brand,
    hooks: source.hooks ?? {},
    layout: resolveLayout(dirs, source.layout),
    routes: Array.isArray(source.routes) ? source.routes : null,
    // Varsayılan kapalı: açıkken `/hakkinda` → 308 `/hakkinda/` ve kanonik
    // yanıt 200'dir. Kapalıyken slash dayatılmaz — Express'in non-strict
    // eşleşmesi her iki biçimi de 200 ile servis eder (Next'in varsayılan
    // "slash'ı kırp" davranışından bilinçli fark).
    trailingSlash: source.trailingSlash === true,
    static: {
      extensions: new Set(source.static?.extensions ?? DEFAULT_STATIC.extensions),
      prefixes: source.static?.prefixes ?? DEFAULT_STATIC.prefixes,
    },
    devGateBypass: source.devGateBypass ?? DEFAULT_DEV_GATE_BYPASS,
    preconnect: source.preconnect ?? [],
    navigation: normalizeNavigation(source.navigation, brand),
    security: normalizeSecurity(source.security),
    prewarmSkip: source.prewarmSkip ?? DEFAULT_PREWARM_SKIP,
    // `routes`, `views` ve `lib` zaten izlenir; buraya yalnızca ek dizinler.
    watch: source.watch ?? [],
    // Build tarafı ayarları. Sunucu bunları okumaz ama config tek dosya
    // olsun diye aynı yerden geçer.
    fonts: source.fonts ?? [],
    icons: source.icons ?? {},
    images: source.images ?? {},
    clientEnv: source.clientEnv ?? [],
  };

  // Dev'de build ve sunucu ayrı alt süreçler; üçü de aynı özeti basınca satır
  // banner'ın ve build bloğunun arasına üç kez giriyor. Özeti dış süreç basar.
  if (loaded && !process.env.JSKELET_CHILD) {
    /** @param {number} count @param {string} singular @param {string} plural */
    const label = (count, singular, plural) =>
      `${count} ${count === 1 ? singular : plural}`;

    const counts = [
      config.headers.length && label(config.headers.length, "header", "headers"),
      config.redirects.length &&
        label(config.redirects.length, "redirect", "redirects"),
      config.rewrites.length && label(config.rewrites.length, "rewrite", "rewrites"),
      config.html.length && label(config.html.length, "cache rule", "cache rules"),
    ].filter(Boolean);

    if (counts.length) {
      console.log(`[config] ${configFile} loaded — ${counts.join(", ")}`);
    }
  }

  return config;
}

/**
 * Çözümlenmiş config. `loadConfig()` çağrılmadan erişilirse boş bir proje
 * kökü varsayımıyla çalışmak yerine hata verir: sessiz yanlış yol,
 * "stylesheet neden yok" gibi teşhisi zor sorunlara dönüşüyor.
 *
 * @returns {ResolvedConfig}
 */
export function getConfig() {
  if (!config) {
    throw new Error(
      "[config] getConfig() was used before loadConfig(). " +
        "Start the server with the `jskelet` CLI or through createApp().",
    );
  }
  return config;
}

/**
 * Uygulamanın tanımladığı hook'u çalıştırır; yoksa `fallback` döner.
 * Hook'un hata vermesi sayfayı düşürmemeli — framework kendi varsayılanına
 * geri döner ve uyarır.
 *
 * @template T
 * @param {string} name
 * @param {T} fallback
 * @param {unknown[]} args
 * @returns {Promise<T>}
 */
export async function hook(name, fallback, ...args) {
  const fn = getConfig().hooks?.[name];
  if (typeof fn !== "function") return fallback;

  try {
    return await fn(...args);
  } catch (error) {
    console.warn(`[config] hooks.${name}() threw, using the default`, error);
    return fallback;
  }
}
