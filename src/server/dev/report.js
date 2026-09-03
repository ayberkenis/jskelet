/**
 * "Detaylı İncele" raporunun veri katmanı.
 *
 * Overlay baloncuğu anlık durumu gösterir; bu modül ise sitenin tamamına
 * bakan bir görünüm üretir: gezilen her sayfanın Web Vitals ölçümleri, SSR
 * çıktısının boyutu, island (CSR) durumu, tarayıcı ve sunucu tarafındaki API
 * çağrıları, build çıktısındaki chunk/varlık kırılımı ve HTML önbelleği.
 *
 * Yalnızca development'ta yüklenir (devtools ile birlikte mount edilir),
 * üretim çıktısına girmez.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { getHtmlCacheEntries, getHtmlCacheSize } from "../html-cache.js";
import { getDataCacheSize, getDataCacheStats } from "../data-cache.js";
import { getRedisStatus } from "../redis.js";
import { getUpstreamLimiterStatus } from "../upstream-limiter.js";
import { prewarmProgress } from "../prewarm.js";
import { getConfig } from "../../config/index.js";
import { getRequestContext } from "../../http/request-context.js";

/** Yollar config'ten: framework paket içine taşındığında `../..` sayan her hesap bozulur. */
const ROOT = getConfig().root;
const PUBLIC_DIR = getConfig().dirs.public;
const GENERATED_DIR = getConfig().dirs.generated;

/* ------------------------------------------------------------- sayfa ölçümleri */

/**
 * @typedef {{
 *   url: string,
 *   title: string | null,
 *   at: number,
 *   visits: number,
 *   metrics: Record<string, number | null>,
 *   resources: { count: number, bytes: number, byType: Record<string, { count: number, bytes: number }> },
 *   islands: { total: number, ready: number, names: string[] },
 *   api: { url: string, ms: number, status: number, bytes: number, initiator: string }[],
 *   html: { bytes: number | null, cache: string | null, ms: number | null },
 * }} PageReport
 */

/** @type {Map<string, PageReport>} */
const pages = new Map();

/** Tarayıcıdan gelen ölçüm paketini saklar. En yeni paket öncekini ezer. */
export function recordPageReport(payload) {
  if (!payload?.url) return;

  let url;
  try {
    url = new URL(payload.url).pathname + new URL(payload.url).search;
  } catch {
    url = String(payload.url);
  }

  const previous = pages.get(url);

  pages.set(url, {
    url,
    title: payload.title ?? previous?.title ?? null,
    at: Date.now(),
    visits: (previous?.visits ?? 0) + 1,
    metrics: payload.metrics ?? {},
    resources: payload.resources ?? { count: 0, bytes: 0, byType: {} },
    islands: payload.islands ?? { total: 0, ready: 0, names: [] },
    api: Array.isArray(payload.api) ? payload.api.slice(0, 100) : [],
    html: previous?.html ?? { bytes: null, cache: null, ms: null },
  });
}

/** Ölçümler tarayıcı sekmesinde değil sunucuda durur; sıfırlama da buradan. */
export function clearPageReports() {
  pages.clear();
  serverApiCalls.length = 0;
}

/* --------------------------------------------------- sunucu tarafı API çağrıları */

/**
 * @typedef {{
 *   url: string,
 *   host: string,
 *   method: string,
 *   status: number,
 *   ms: number,
 *   bytes: number,
 *   at: number,
 *   error: string | null,
 *   page: string | null,
 *   details: unknown,
 * }} ServerApiCall
 */

/** @type {ServerApiCall[]} */
const serverApiCalls = [];
const MAX_API_CALLS = 300;

/** Başarısız çağrı gövdesinin overlay'e taşınacak üst sınırı. */
const DETAILS_MAX = 4_000;

/**
 * @typedef {{
 *   url: string,
 *   method: string,
 *   status: number,
 *   ms: number,
 *   bytes: number,
 *   error: string | null,
 *   page: string | null,
 *   details: unknown,
 * }} ApiFailure
 */

/**
 * SSR sırasında yapılan dış çağrıları ölçer. `globalThis.fetch` sarılır;
 * yalnızca dev'de çağrıldığı için üretim yolu dokunulmaz kalır.
 *
 * Başarısız cevaplar (4xx/5xx ya da ağ) isteğe bağlı `onFailure` ile
 * overlay hata günlüğüne de düşer — uygulama kendi logger'ıyla stderr'e
 * yazsa bile panel "hangi sayfa hangi API" bilgisini görsün.
 *
 * @param {{ onFailure?: (call: ApiFailure) => void }} [options]
 */
export function trackServerFetch(options = {}) {
  const original = globalThis.fetch;
  if (/** @type {any} */ (original).__jskeletWrapped) return;

  const { onFailure } = options;

  /** @type {typeof fetch} */
  const wrapped = async (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    const method = String(init?.method ?? "GET").toUpperCase();
    const started = Date.now();
    const page = currentPage();

    // Kendi sunucumuza yapılan istekler (ısıtma, sağlık kontrolü) API sayılmaz.
    const isSelf = /^https?:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:|\/|$)/i.test(url);

    try {
      const response = await original(input, init);
      if (!isSelf) {
        const details = response.ok
          ? null
          : await readFailureDetails(response);
        const error = response.ok ? null : summarizeFailure(response.status, details);
        const call = {
          url,
          method,
          status: response.status,
          ms: Date.now() - started,
          bytes: Number(response.headers.get("content-length") ?? 0),
          error,
          page,
          details,
        };
        push(call);
        if (error) onFailure?.(call);
      }
      return response;
    } catch (error) {
      if (!isSelf) {
        const message = error instanceof Error ? error.message : String(error);
        const call = {
          url,
          method,
          status: 0,
          ms: Date.now() - started,
          bytes: 0,
          error: message,
          page,
          details: null,
        };
        push(call);
        onFailure?.(call);
      }
      throw error;
    }
  };

  /** @type {any} */ (wrapped).__jskeletWrapped = true;
  globalThis.fetch = wrapped;
}

/** @returns {string | null} */
function currentPage() {
  return getRequestContext()?.pathname ?? null;
}

/**
 * @param {Response} response
 * @returns {Promise<unknown>}
 */
async function readFailureDetails(response) {
  try {
    const text = (await response.clone().text()).slice(0, DETAILS_MAX);
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return null;
  }
}

/**
 * Overlay başlığı: durum + varsa API'nin kendi doğrulama mesajı.
 *
 * @param {number} status
 * @param {unknown} details
 * @returns {string}
 */
function summarizeFailure(status, details) {
  const label = `HTTP ${status}`;
  const detail = failureMessage(details);
  return detail ? `${label}: ${detail}` : label;
}

/**
 * Upstream gövdesinden kısa, okunabilir bir cümle çıkarır. `[object Object]`
 * basmamak için nesneleri bilinçli dolaşır.
 *
 * @param {unknown} details
 * @returns {string | null}
 */
function failureMessage(details) {
  if (details == null) return null;
  if (typeof details === "string") return details.slice(0, 280);
  if (typeof details !== "object") return String(details);

  const record = /** @type {Record<string, unknown>} */ (details);
  for (const key of ["details", "detail", "message", "error", "title"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 280);
    if (value && typeof value === "object") {
      const nested = failureMessage(value);
      if (nested) return nested;
    }
  }
  try {
    return JSON.stringify(details).slice(0, 280);
  } catch {
    return null;
  }
}

/** @param {Omit<ServerApiCall, "host" | "at">} call */
function push(call) {
  let host = "—";
  try {
    host = new URL(call.url).host;
  } catch {
    // Göreli adres: host bilinmiyor.
  }

  serverApiCalls.push({ ...call, host, at: Date.now() });
  while (serverApiCalls.length > MAX_API_CALLS) serverApiCalls.shift();
}

/* ------------------------------------------------------------ build çıktısı */

/** Boyut hesapları dosya değişmedikçe tekrarlanmaz. */
const sizeCache = new Map();

/**
 * @param {string} file mutlak yol
 * @returns {{ bytes: number, gzip: number, brotli: number | null } | null}
 */
function measure(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }

  const key = `${file}:${stat.size}:${stat.mtimeMs}`;
  const hit = sizeCache.get(key);
  if (hit) return hit;

  let gzip = 0;
  let brotli = null;

  try {
    const buffer = fs.readFileSync(file);
    // Build önceden sıkıştırılmış eşlerini üretiyorsa onları kullan; yoksa
    // gzip'i burada hesapla (rapor tek seferlik, maliyeti kabul edilebilir).
    brotli = statSize(`${file}.br`);
    gzip = statSize(`${file}.gz`) ?? zlib.gzipSync(buffer, { level: 6 }).length;
  } catch {
    return null;
  }

  const value = { bytes: stat.size, gzip, brotli };
  sizeCache.set(key, value);
  return value;
}

/** @param {string} file @returns {number | null} */
function statSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

/** @returns {Record<string, string>} */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Manifest girdileri + boyutları. Yol public/ altına göre çözülür.
 */
function assets() {
  const manifest = readJson(path.join(GENERATED_DIR, "manifest.json"), {});

  return Object.entries(manifest).map(([name, url]) => {
    const size = measure(path.join(PUBLIC_DIR, url.replace(/^\//, "")));
    return {
      name,
      url,
      kind: path.extname(url).slice(1) || "other",
      bytes: size?.bytes ?? null,
      gzip: size?.gzip ?? null,
      brotli: size?.brotli ?? null,
    };
  });
}

/**
 * esbuild metafile'ından chunk analizi: her çıktı için boyut, hangi
 * kaynaklardan oluştuğu ve hangi chunk'ları import ettiği.
 */
function chunks() {
  const metafile = readJson(path.join(GENERATED_DIR, "metafile.json"), null);
  if (!metafile?.outputs) return { outputs: [], groups: [], available: false };

  /** @type {Record<string, number>} */
  const groups = {};

  const outputs = Object.entries(metafile.outputs)
    .filter(([file]) => file.endsWith(".js") || file.endsWith(".css"))
    .map(([file, output]) => {
      const size = measure(path.join(ROOT, file));

      const inputs = Object.entries(output.inputs ?? {})
        .map(([source, info]) => ({ source, bytes: info.bytesInOutput ?? 0 }))
        .filter((input) => input.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes);

      for (const input of inputs) {
        const group = groupOf(input.source);
        groups[group] = (groups[group] ?? 0) + input.bytes;
      }

      return {
        file: `/${file.split(path.sep).join("/").replace(/^public\//, "")}`,
        entry: output.entryPoint ?? null,
        isChunk: file.includes("chunks"),
        bytes: output.bytes,
        gzip: size?.gzip ?? null,
        brotli: size?.brotli ?? null,
        imports: (output.imports ?? [])
          .filter((item) => item.kind !== "file-loader")
          .map((item) => ({
            path: `/${item.path.split(path.sep).join("/").replace(/^public\//, "")}`,
            kind: item.kind,
          })),
        inputs: inputs.slice(0, 40),
        inputCount: inputs.length,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);

  return {
    available: true,
    outputs,
    groups: Object.entries(groups)
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}

/**
 * Kaynak dosyayı okunur bir gruba indirger: paket adı ya da üst klasör.
 * @param {string} source
 */
function groupOf(source) {
  const normalized = source.split(path.sep).join("/");
  const modules = normalized.lastIndexOf("node_modules/");

  if (modules >= 0) {
    const rest = normalized.slice(modules + "node_modules/".length).split("/");
    return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  }

  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(0, 2).join("/") || normalized;
}

/* ------------------------------------------------------------------- rapor */

/**
 * Rapor sayfasının tek veri kaynağı.
 * @param {{ requests: object[], errors: object[] }} devtools
 */
export function buildReport(devtools) {
  const usage = process.memoryUsage();

  // SSR ölçümleri: ısıtma turu her sayfanın HTML boyutunu ve render süresini
  // biliyor; gezilen sayfalarla eşleştirilir.
  const warmByPath = new Map(
    (prewarmProgress.entries ?? []).map((entry) => [entry.path, entry]),
  );

  const pageList = [...pages.values()].map((page) => {
    const warm = warmByPath.get(page.url.split("?")[0]);
    return {
      ...page,
      html: warm
        ? { bytes: warm.bytes, cache: warm.cache, ms: warm.ms }
        : page.html,
    };
  });

  // Hiç gezilmemiş ama ısıtılmış sayfalar da listelenir: SSR tarafı bilinir,
  // istemci ölçümleri boş kalır.
  for (const entry of prewarmProgress.entries ?? []) {
    if (pages.has(entry.path)) continue;
    pageList.push({
      url: entry.path,
      title: null,
      at: prewarmProgress.finishedAt ?? prewarmProgress.startedAt,
      visits: 0,
      metrics: {},
      resources: { count: 0, bytes: 0, byType: {} },
      islands: { total: 0, ready: 0, names: [] },
      api: [],
      html: { bytes: entry.bytes, cache: entry.cache, ms: entry.ms },
    });
  }

  return {
    generatedAt: Date.now(),
    process: {
      pid: process.pid,
      node: process.version,
      uptime: process.uptime(),
      memory: { rss: usage.rss, heapUsed: usage.heapUsed },
      env: process.env.NODE_ENV ?? "development",
    },
    pages: pageList.sort((a, b) => (b.visits - a.visits) || b.at - a.at),
    serverApi: serverApiCalls.slice().reverse(),
    build: { assets: assets(), ...chunks() },
    cache: {
      size: getHtmlCacheSize(),
      entries: getHtmlCacheEntries(),
      // Veri önbelleğinden yalnızca sayaç: uzun kuyruklu bir sitede on
      // binlerce anahtar oluyor ve dökümü rapora koymak faydasız bir yük.
      data: getDataCacheSize(),
      // Sayaçlar dökümün yerine geçmiyor, onu tamamlıyor: "kaç girdi var"
      // sorusundan çok "kaç okuma upstream'e gitti" sorusu karar veriyor.
      dataStats: getDataCacheStats(),
      // Paylaşımlı kademe kapalıyken de basılır: "Redis'i açtım ama neden
      // çalışmıyor" sorusunun cevabı en çok burada aranıyor.
      redis: getRedisStatus(),
    },
    // Hız freninin o anki durumu. 429 fırtınasında "şu an saniyede kaça
    // indi" bilgisi olmadan ayar yapmak körlemesine oluyor.
    upstream: getUpstreamLimiterStatus(),
    prewarm: { ...prewarmProgress },
    requests: devtools.requests,
    errors: devtools.errors,
  };
}
