/**
 * ISR ikamesi: route + query anahtarlı, TTL'li LRU HTML cache.
 *
 * TTL dolduğunda girdi hemen atılmaz: `stale` pencerede eski HTML anında
 * döner ve tazeleme arkada çalışır. Böylece ilk ısıtmadan sonra hiçbir istek
 * render'ı beklemez; buna karşılık HTML'deki veri en fazla `revalidate + bir
 * tazeleme turu` kadar geride olabilir. Fiyat gibi canlı alanlar istemcide
 * WebSocket'ten güncellendiği için bu gecikme ekranda görünmez.
 */

/**
 * @typedef {{ html: string, status: number, expiresAt: number,
 *   staleUntil: number, encoded: Map<string, Buffer> }} HtmlEntry
 */

const MAX_ENTRIES = 500;

/**
 * TTL dolduktan sonra eski HTML'in kaç TTL boyunca daha servis edilebileceği.
 * Tazeleme genelde ilk stale istekte tamamlandığı için bu pencere yalnızca
 * yavaş upstream'lerde devreye girer.
 */
const STALE_FACTOR = 1;

/** @type {Map<string, HtmlEntry>} */
const store = new Map();

/** @type {Map<string, Promise<{ html: string, status: number }>>} */
const inflight = new Map();

/**
 * @param {string} key
 * @returns {{ html: string, status: number, encoded: Map<string, Buffer>,
 *   stale: boolean } | null}
 */
function read(key) {
  const entry = store.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now >= entry.staleUntil) {
    store.delete(key);
    return null;
  }

  // LRU: erişilen girdiyi sona taşı.
  store.delete(key);
  store.set(key, entry);

  return {
    html: entry.html,
    status: entry.status,
    encoded: entry.encoded,
    stale: now >= entry.expiresAt,
  };
}

/**
 * @param {string} key
 * @param {{ html: string, status: number }} value
 * @param {number} ttlSeconds
 */
function write(key, value, ttlSeconds) {
  const now = Date.now();

  store.set(key, {
    html: value.html,
    status: value.status,
    // Sıkıştırılmış gövdeler HTML ile aynı ömrü paylaşır: aynı sayfa her
    // istekte yeniden brotli'lenmesin.
    encoded: new Map(),
    expiresAt: now + ttlSeconds * 1000,
    staleUntil: now + ttlSeconds * 1000 * (1 + STALE_FACTOR),
  });

  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<{ html: string, status: number, degraded?: boolean }>} producer
 * @returns {Promise<{ html: string, status: number, degraded?: boolean }>}
 */
function refresh(key, ttlSeconds, producer) {
  const pending = inflight.get(key);
  if (pending) return pending;

  const task = producer()
    .then((value) => {
      // `degraded`: upstream düştüğü için eksik veriyle üretilmiş HTML.
      // Saklanırsa eksik içerik tüm TTL boyunca servis edilir.
      if (value.status === 200 && !value.degraded) {
        write(key, value, ttlSeconds);
      }
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, task);
  return task;
}

/**
 * @param {string} key
 * @param {number} ttlSeconds 0 → cache yok
 * @param {() => Promise<{ html: string, status: number }>} producer
 * @returns {Promise<{ html: string, status: number, cached: boolean,
 *   stale?: boolean, encoded?: Map<string, Buffer> }>}
 */
export async function withHtmlCache(key, ttlSeconds, producer) {
  if (!ttlSeconds) {
    const fresh = await producer();
    return { ...fresh, cached: false };
  }

  const hit = read(key);

  if (hit) {
    // Süresi geçmiş girdi anında döner; tazeleme arkada yürür ve hatası
    // isteği etkilemez (eski HTML stale penceresi boyunca geçerli kalır).
    if (hit.stale) {
      void refresh(key, ttlSeconds, producer).catch((error) => {
        console.error(`[html-cache] arka plan tazelemesi başarısız: ${key}`, error);
      });
    }
    return { ...hit, cached: true };
  }

  const value = await refresh(key, ttlSeconds, producer);
  return { ...value, encoded: store.get(key)?.encoded, cached: false };
}

export function clearHtmlCache() {
  store.clear();
}

export function getHtmlCacheSize() {
  return store.size;
}

/**
 * Dev raporu için önbellek dökümü: hangi sayfa ne kadar HTML tutuyor, ne
 * zaman bayatlıyor. HTML gövdesi dönmez, yalnızca boyutu.
 *
 * @returns {{ key: string, bytes: number, status: number, stale: boolean,
 *   expiresIn: number, encodings: string[] }[]}
 */
export function getHtmlCacheEntries() {
  const now = Date.now();

  return [...store.entries()].map(([key, entry]) => ({
    key,
    bytes: Buffer.byteLength(entry.html),
    status: entry.status,
    stale: now >= entry.expiresAt,
    expiresIn: Math.round((entry.expiresAt - now) / 1000),
    encodings: [...entry.encoded.keys()],
  }));
}
