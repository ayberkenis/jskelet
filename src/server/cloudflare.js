/**
 * Cloudflare'in cache yüzeyi: purge, zone ayarları ve cache analitiği.
 *
 * Neden framework'te: JSkelet'in önbelleği **origin** önbelleği. Bir içerik
 * güncellendiğinde `invalidateHtmlCache()` origin'i tazeliyor ama CDN'de duran
 * kopya TTL'ini bekliyor; ziyaretçinin gördüğü HTML orada. İki katmanı ayrı
 * ayrı yönetmek, purge'ü unutulan bir katman bırakıyor.
 *
 * ## Ne yapılabilir, ne yapılamaz
 *
 * Cloudflare API'sinin **verdiği** şeyler burada var: `purge_everything`, URL /
 * prefix / host / cache-tag ile hedefli purge, cache ile ilgili zone ayarları
 * (cache level, browser TTL, development mode, tiered cache, cache reserve) ve
 * GraphQL analitiğinden cache durumu kırılımı.
 *
 * **Vermediği** iki şey var ve panelde de bu böyle yazıyor:
 *
 *   1. "Şu URL şu an kaç edge'de duruyor" sorusunun cevabı yok. Cloudflare
 *      yüzlerce şehirde bağımsız önbellekler tutuyor ve hiçbir uç bir objenin
 *      envanterini vermiyor. En yakın cevap **gözlem**: GraphQL'de son N saatte
 *      hangi kolodan kaç `hit`/`miss` geldiği. `fetchPathEdges()` bunu döner —
 *      "kaç edge'de var" değil, "kaç edge o yolu cache'ten servis etti".
 *   2. Bir edge'i uzaktan ısıtmanın yolu yok. Bir obje ancak o koloya düşen
 *      gerçek bir istekle cache'e giriyor; sunucudan seçtiğiniz bir şehri
 *      ısıtamazsınız. Pratik karşılığı origin'i ısıtmak (`prewarm`) ve
 *      Tiered Cache / Cache Reserve açmak: ilk istek yine o edge'e gidiyor ama
 *      arkadaki katman origin'e kadar inmiyor.
 *
 * Sözleşme: bu modüldeki hiçbir fonksiyon fırlatmaz. Token yoksa, ağ düşerse
 * ya da Cloudflare hata dönerse sonuç `{ ok: false, error }` olur ve panel
 * bunu gösterir. Token hiçbir dönüş değerinde yer almaz.
 */
import process from "node:process";
import { getConfig } from "../config/index.js";
import { DEFAULT_CLOUDFLARE } from "../config/defaults.js";

const API = "https://api.cloudflare.com/client/v4";
const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";

/**
 * Tek bir çağrının en fazla bekletebileceği süre. Panel bir teşhis aracı;
 * Cloudflare yavaşladığında sayfayı süresiz açık tutmasın.
 */
const TIMEOUT_MS = 8000;

/**
 * Purge isteğinde tek seferde gönderilebilecek anahtar sayısı. Cloudflare'in
 * sınırı istek başına 100 (Enterprise'da tek dosya purge'ünde 500); en düşük
 * ortak değeri kullanmak her planda çalışan tek davranış.
 */
const PURGE_BATCH = 100;

/** Genel bakış birkaç uca gidiyor; panel her açılışta hepsini yenilemesin. */
const OVERVIEW_TTL_MS = 30_000;

/** @type {{ at: number, value: object } | null} */
let overviewCache = null;

/**
 * Etkin ayarlar. Token **config'ten ya da env'den** okunur; env öncelikli,
 * çünkü sır config dosyasına yazılmamalı.
 *
 * @returns {{ configured: boolean, zoneId: string | null,
 *   token: string | null, source: "env" | "config" | null,
 *   hostname: string | null, analyticsHours: number, enabled: boolean }}
 */
function settings() {
  /** @type {Record<string, any>} */
  let configured = {};
  try {
    configured = getConfig().cloudflare ?? {};
  } catch {
    configured = { ...DEFAULT_CLOUDFLARE };
  }

  const envToken = process.env.JSKELET_CLOUDFLARE_KEY || null;
  const token = envToken ?? configured.apiToken ?? null;
  const zoneId =
    process.env.JSKELET_CLOUDFLARE_ZONE_ID || configured.zoneId || null;
  const hostname =
    process.env.JSKELET_CLOUDFLARE_HOSTNAME || configured.hostname || null;

  const enabled = configured.enabled !== false;

  return {
    enabled,
    zoneId,
    token,
    source: token ? (envToken ? "env" : "config") : null,
    hostname,
    analyticsHours: Number(configured.analyticsHours) || DEFAULT_CLOUDFLARE.analyticsHours,
    // Zone kimliği olmadan hiçbir uç çağrılamaz; ikisi birlikte "kurulu"
    // sayılmanın koşulu.
    configured: enabled && Boolean(token && zoneId),
  };
}

/** @returns {boolean} */
export function cloudflareConfigured() {
  return settings().configured;
}

/**
 * Panelin gösterdiği kurulum özeti. Token'ın kendisi değil, **nereden
 * geldiği** döner.
 *
 * @returns {{ configured: boolean, enabled: boolean, zoneId: string | null,
 *   tokenSource: "env" | "config" | null, hostname: string | null }}
 */
export function getCloudflareStatus() {
  const config = settings();

  return {
    configured: config.configured,
    enabled: config.enabled,
    // Zone kimliği sır değil (URL'lerde de geçiyor) ama tamamını basmanın da
    // faydası yok; son dört hane hangi zone'a bağlı olduğunu doğrulamaya yeter.
    zoneId: config.zoneId ? `…${config.zoneId.slice(-4)}` : null,
    tokenSource: config.source,
    hostname: config.hostname,
  };
}

/**
 * Cloudflare REST çağrısı. Hata **fırlatılmaz**: teşhis ucu bir arıza anında
 * çağrılıyor ve Cloudflare'in 403'ü paneli düşürmemeli.
 *
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<{ ok: boolean, result?: any, error?: string }>}
 */
async function call(path, options = {}) {
  const config = settings();
  if (!config.configured) return { ok: false, error: "Cloudflare is not configured" };

  try {
    const response = await fetch(`${API}/zones/${config.zoneId}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || payload?.success === false) {
      return { ok: false, error: describe(payload, response.status) };
    }

    return { ok: true, result: payload?.result };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

/**
 * @param {any} payload
 * @param {number} status
 * @returns {string}
 */
function describe(payload, status) {
  const first = Array.isArray(payload?.errors) ? payload.errors[0] : null;
  if (first?.message) {
    // Kod da yazılır: 10000 (yetki) ile 1012 (geçersiz zone) çok farklı iki
    // düzeltme demek ve mesajlar birbirine benziyor.
    return first.code ? `${first.message} (${first.code})` : String(first.message);
  }
  return `HTTP ${status}`;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function reason(error) {
  if (error instanceof Error) {
    return error.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS}ms` : error.message;
  }
  return String(error);
}

/* --------------------------------------------------------------- genel bakış */

/**
 * Zone künyesi + cache ile ilgili ayarlar.
 *
 * Ayarlar tek tek değil, tek `GET /settings` turuyla okunur ve ilgili olanlar
 * ayıklanır. Tiered Cache ve Cache Reserve ayrı uçlarda yaşıyor; ikisi de
 * planla sınırlı olduğu için hataları **yok sayılır**, yalnızca `null` olurlar
 * — Free bir zone'da panel yine açılmalı.
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<object>}
 */
export async function fetchCloudflareOverview(options = {}) {
  const config = settings();
  if (!config.configured) {
    return { ok: false, status: getCloudflareStatus(), error: "not configured" };
  }

  if (!options.force && overviewCache && Date.now() - overviewCache.at < OVERVIEW_TTL_MS) {
    return overviewCache.value;
  }

  const [zone, zoneSettings, tiered, reserve, regional] = await Promise.all([
    call(""),
    call("/settings"),
    call("/argo/tiered_caching"),
    call("/cache/cache_reserve"),
    call("/cache/regional_tiered_cache"),
  ]);

  if (!zone.ok && !zoneSettings.ok) {
    // İkisi de başarısızsa sorun tek bir uçta değil: token ya da zone yanlış.
    const value = {
      ok: false,
      status: getCloudflareStatus(),
      error: zone.error ?? zoneSettings.error,
    };
    overviewCache = { at: Date.now(), value };
    return value;
  }

  const map = new Map(
    (Array.isArray(zoneSettings.result) ? zoneSettings.result : []).map(
      (/** @type {any} */ entry) => [entry.id, entry],
    ),
  );

  /** @param {string} id */
  const setting = (id) => map.get(id) ?? null;

  const development = setting("development_mode");

  const value = {
    ok: true,
    fetchedAt: Date.now(),
    status: getCloudflareStatus(),
    zone: zone.ok
      ? {
          name: zone.result?.name ?? null,
          plan: zone.result?.plan?.name ?? null,
          status: zone.result?.status ?? null,
          paused: zone.result?.paused === true,
        }
      : null,
    settings: {
      cacheLevel: setting("cache_level")?.value ?? null,
      browserCacheTtl: setting("browser_cache_ttl")?.value ?? null,
      edgeCacheTtl: setting("edge_cache_ttl")?.value ?? null,
      sortQueryString: setting("sort_query_string_for_cache")?.value ?? null,
      alwaysOnline: setting("always_online")?.value ?? null,
      developmentMode: development?.value ?? null,
      // Development mode üç saat sonra kendiliğinden kapanıyor; kalan süre
      // "neden hiçbir şey cache'lenmiyor" sorusunun en sık cevabı.
      developmentModeRemaining: Number(development?.time_remaining) || 0,
      tieredCaching: tiered.ok ? tiered.result?.value ?? null : null,
      cacheReserve: reserve.ok ? reserve.result?.value ?? null : null,
      regionalTieredCache: regional.ok ? regional.result?.value ?? null : null,
    },
  };

  overviewCache = { at: Date.now(), value };
  return value;
}

/* ------------------------------------------------------------------ analitik */

/**
 * GraphQL sorgusu. Analitik ayrı bir uçta (`/graphql`) yaşadığı için `call()`
 * kullanılmıyor.
 *
 * @param {string} query
 * @param {Record<string, unknown>} variables
 * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
 */
async function graphql(query, variables) {
  const config = settings();
  if (!config.configured) return { ok: false, error: "Cloudflare is not configured" };

  try {
    const response = await fetch(GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const payload = await response.json().catch(() => null);
    const error = Array.isArray(payload?.errors) ? payload.errors[0]?.message : null;

    if (!response.ok || error) {
      return { ok: false, error: error ?? `HTTP ${response.status}` };
    }

    return { ok: true, data: payload?.data };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

/**
 * @param {number} hours
 * @returns {string} ISO zaman damgası
 */
function since(hours) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

/**
 * Zone'un cache durumu kırılımı: `hit`, `miss`, `dynamic`, `expired`… her biri
 * için istek sayısı ve edge'den giden bayt.
 *
 * `httpRequestsAdaptiveGroups` bilinçli seçildi: `cacheStatus` boyutu eski
 * `httpRequests1hGroups` veri kümesinde yok ve pek çok hesapta hata veriyor.
 * Adaptive küme örnekleme kullanıyor, yani sayılar **tahmindir** — oranlar
 * doğru, mutlak değerler yaklaşık.
 *
 * @param {{ hours?: number }} [options]
 * @returns {Promise<{ ok: boolean, hours: number, sampled: boolean,
 *   rows: { status: string, requests: number, bytes: number }[],
 *   error?: string }>}
 */
export async function fetchCacheAnalytics(options = {}) {
  const config = settings();
  const hours = Math.max(1, Math.min(72, options.hours ?? config.analyticsHours));

  const query = `
    query CacheStatus($zone: String!, $since: Time!) {
      viewer {
        zones(filter: { zoneTag: $zone }) {
          httpRequestsAdaptiveGroups(
            filter: { datetime_geq: $since }
            limit: 50
            orderBy: [count_DESC]
          ) {
            count
            sum { edgeResponseBytes }
            dimensions { cacheStatus }
          }
        }
      }
    }`;

  const response = await graphql(query, { zone: config.zoneId, since: since(hours) });
  if (!response.ok) return { ok: false, hours, sampled: true, rows: [], error: response.error };

  const groups = response.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];

  return {
    ok: true,
    hours,
    sampled: true,
    rows: groups.map((/** @type {any} */ group) => ({
      status: group.dimensions?.cacheStatus ?? "unknown",
      requests: Number(group.count) || 0,
      bytes: Number(group.sum?.edgeResponseBytes) || 0,
    })),
  };
}

/**
 * Bir yolun **kolo bazında** cache kırılımı.
 *
 * Bu, "kaç edge'de bu sayfanın kopyası var" sorusunun API'nin verdiği en yakın
 * cevabı: son `hours` saatte hangi Cloudflare şehri o yolu kaç kez cache'ten
 * (`hit`) ya da origin'den (`miss`, `expired`, `dynamic`) servis etti. Envanter
 * değil, gözlem — hiç istek almamış bir edge listede görünmez, kopyası olsa da.
 *
 * @param {{ path: string, hours?: number }} options
 * @returns {Promise<{ ok: boolean, path: string, hours: number,
 *   colos: { colo: string, hits: number, misses: number }[],
 *   hits: number, misses: number, error?: string }>}
 */
export async function fetchPathEdges({ path, hours }) {
  const config = settings();
  const window = Math.max(1, Math.min(72, hours ?? config.analyticsHours));

  const query = `
    query PathEdges($zone: String!, $since: Time!, $path: String!) {
      viewer {
        zones(filter: { zoneTag: $zone }) {
          httpRequestsAdaptiveGroups(
            filter: { datetime_geq: $since, clientRequestPath: $path }
            limit: 500
            orderBy: [count_DESC]
          ) {
            count
            dimensions { coloCode cacheStatus }
          }
        }
      }
    }`;

  const response = await graphql(query, {
    zone: config.zoneId,
    since: since(window),
    path,
  });

  if (!response.ok) {
    return { ok: false, path, hours: window, colos: [], hits: 0, misses: 0, error: response.error };
  }

  const groups = response.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? [];

  /** @type {Map<string, { colo: string, hits: number, misses: number }>} */
  const colos = new Map();
  let hits = 0;
  let misses = 0;

  for (const group of groups) {
    const colo = group.dimensions?.coloCode ?? "??";
    const status = String(group.dimensions?.cacheStatus ?? "");
    const count = Number(group.count) || 0;

    const entry = colos.get(colo) ?? { colo, hits: 0, misses: 0 };
    // `hit` dışındaki her şey (miss, expired, dynamic, bypass) origin'e giden
    // ya da hiç cache'lenmeyen istek; panelde tek kolonda toplanıyor.
    if (status === "hit") {
      entry.hits += count;
      hits += count;
    } else {
      entry.misses += count;
      misses += count;
    }
    colos.set(colo, entry);
  }

  return {
    ok: true,
    path,
    hours: window,
    hits,
    misses,
    colos: [...colos.values()].sort((a, b) => b.hits + b.misses - (a.hits + a.misses)),
  };
}

/* --------------------------------------------------------------------- purge */

/**
 * Cloudflare önbelleğini düşürür.
 *
 * Dört hedefleme biçimi de API'nin verdiği hâliyle: `files` (tam URL),
 * `prefixes`, `hosts`, `tags`. Hepsi artık her planda çalışıyor ama istek
 * başına en fazla 100 anahtar kabul ediliyor; uzun listeler burada parçalanır
 * ve **sırayla** gönderilir — paralel göndermek Free planda dakikada beş
 * istekle sınırlı olan hız freni yüzünden yarısı reddedilen bir tur demek.
 *
 * @param {{ everything?: boolean, files?: string[], prefixes?: string[],
 *   hosts?: string[], tags?: string[] }} target
 * @returns {Promise<{ ok: boolean, purged: number, batches: number,
 *   error?: string }>}
 */
export async function purgeCloudflare(target) {
  if (target.everything) {
    const response = await call("/purge_cache", {
      method: "POST",
      body: { purge_everything: true },
    });
    return { ok: response.ok, purged: 0, batches: 1, error: response.error };
  }

  /** @type {[string, string[]][]} */
  const kinds = [
    ["files", target.files ?? []],
    ["prefixes", target.prefixes ?? []],
    ["hosts", target.hosts ?? []],
    ["tags", target.tags ?? []],
  ];

  let purged = 0;
  let batches = 0;

  for (const [kind, values] of kinds) {
    const unique = [...new Set(values.filter((value) => typeof value === "string" && value))];

    for (let index = 0; index < unique.length; index += PURGE_BATCH) {
      const slice = unique.slice(index, index + PURGE_BATCH);
      const response = await call("/purge_cache", {
        method: "POST",
        body: { [kind]: slice },
      });

      batches += 1;
      if (!response.ok) return { ok: false, purged, batches, error: response.error };
      purged += slice.length;
    }
  }

  if (!batches) return { ok: false, purged: 0, batches: 0, error: "nothing to purge" };
  return { ok: true, purged, batches };
}

/**
 * Yolları tam URL'e çevirir. Cloudflare `files` purge'ü şemayı da içeren tam
 * URL istiyor; panel elinde yol (`/haber/abc`) tutuyor.
 *
 * @param {string[]} paths
 * @param {string} [fallbackOrigin] `cloudflare.hostname` verilmediğinde
 *   kullanılacak kök (panelin açıldığı origin).
 * @returns {string[]}
 */
export function toCloudflareUrls(paths, fallbackOrigin) {
  // Yapılandırılmış site adı önce gelir: panel bir iç adresten (ör.
  // `http://10.0.0.4:3000`) açılmış olabilir ve o adresin Cloudflare'de
  // karşılığı yok.
  const hostname = settings().hostname;
  const base = hostname ? `https://${hostname}` : (fallbackOrigin ?? null);
  if (!base) return [];

  return paths
    .map((path) => {
      try {
        return new URL(path, base).href;
      } catch {
        return null;
      }
    })
    .filter((url) => url !== null);
}

/* ------------------------------------------------------------------- ayarlar */

/**
 * Cache ile ilgili bir zone ayarını değiştirir.
 *
 * Yalnızca beyaz listedeki ayarlar: panelin işi cache, ve bir teşhis
 * arayüzünden zone'un tamamını yeniden yapılandırılabilir yapmak gereksiz bir
 * yüzey.
 *
 * @param {"development_mode" | "cache_level" | "browser_cache_ttl" |
 *   "always_online" | "sort_query_string_for_cache"} id
 * @param {string | number} value
 * @returns {Promise<{ ok: boolean, value?: unknown, error?: string }>}
 */
export async function setCloudflareSetting(id, value) {
  const allowed = new Set([
    "development_mode",
    "cache_level",
    "browser_cache_ttl",
    "always_online",
    "sort_query_string_for_cache",
  ]);

  if (!allowed.has(id)) return { ok: false, error: `setting not allowed: ${id}` };

  const response = await call(`/settings/${id}`, { method: "PATCH", body: { value } });
  // Ayar değiştiyse önbelleğe alınmış genel bakış eskidi.
  overviewCache = null;

  return { ok: response.ok, value: response.result?.value, error: response.error };
}

/**
 * Tiered Cache ya da Cache Reserve'ü açar/kapatır. İkisi de ayrı uçlarda ve
 * planla sınırlı; kapalı bir planda Cloudflare açıklayıcı bir hata döner ve
 * panel onu gösterir.
 *
 * @param {"tiered_caching" | "cache_reserve" | "regional_tiered_cache"} feature
 * @param {"on" | "off"} value
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function setCloudflareFeature(feature, value) {
  const path =
    feature === "tiered_caching"
      ? "/argo/tiered_caching"
      : feature === "cache_reserve"
        ? "/cache/cache_reserve"
        : "/cache/regional_tiered_cache";

  const response = await call(path, { method: "PATCH", body: { value } });
  overviewCache = null;

  return { ok: response.ok, error: response.error };
}

/**
 * Cache Reserve'ü (R2'deki kalıcı kopya) boşaltır. Purge'den ayrı bir işlem:
 * `purge_everything` edge önbelleklerini düşürüyor, Cache Reserve'deki kopya
 * kalıyor.
 *
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function clearCloudflareCacheReserve() {
  const response = await call("/cache/cache_reserve_clear", { method: "POST" });
  return { ok: response.ok, error: response.error };
}
