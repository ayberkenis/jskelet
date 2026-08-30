/**
 * Upstream veri için TTL + stale-while-revalidate LRU önbelleği.
 *
 * HTML önbelleği (`html-cache.js`) yalnızca **trafiği olan** sayfaları tutar:
 * girdi başına yüz kilobayt düştüğü için sınırı 500 civarındadır ve on binlerce
 * yolluk bir site onu ısıtmaya çalıştığında kendi ısıttığını siler. Uzun kuyruk
 * için doğru katman bu modül: aynı sayfanın JSON'u HTML'inden onlarca kat
 * küçük olduğu için on binlerce girdi bellekte durur.
 *
 * Kazanç iki taraflı:
 *   - Hiç ısıtılmamış bir uzun kuyruk sayfası ilk ziyaretçide render edilir ama
 *     upstream'e gitmez; gecikme yüzlerce ms değil, şablon render'ı kadardır.
 *   - Periyodik ısıtma turları API kotası harcamaz, veri katmanından okur.
 *
 * `null`/`undefined` **saklanmaz**: uygulamaların HTTP istemcisi hatada
 * genellikle `null` döner ve bunu saklamak, geçici bir 429'u TTL boyunca "veri
 * yok" hâline dondurmak olurdu. Boş cevabı bilinçli olarak saklamak isteyen
 * `storeEmpty: true` verir.
 */
import { getConfig } from "../config/index.js";
import { DEFAULT_DATA_CACHE } from "../config/defaults.js";

/**
 * @typedef {{ value: unknown, expiresAt: number, staleUntil: number }} DataEntry
 */

/** @type {Map<string, DataEntry>} */
const store = new Map();

/** @type {Map<string, Promise<unknown>>} */
const inflight = new Map();

/**
 * Ayarlar config'ten okunur ama config yüklenmemiş olabilir: bu modül
 * script'lerden ve testlerden de çağrılabiliyor. `getConfig()` fırlatırsa
 * kod varsayılanına düşülür.
 *
 * @returns {{ maxEntries: number, staleFactor: number }}
 */
function settings() {
  try {
    const { data } = getConfig();
    return {
      maxEntries: Number(data?.maxEntries) || DEFAULT_DATA_CACHE.maxEntries,
      staleFactor: Number.isFinite(Number(data?.staleFactor))
        ? Number(data.staleFactor)
        : DEFAULT_DATA_CACHE.staleFactor,
    };
  } catch {
    return { ...DEFAULT_DATA_CACHE };
  }
}

/**
 * @param {string} key
 * @returns {{ value: unknown, stale: boolean } | null}
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

  return { value: entry.value, stale: now >= entry.expiresAt };
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlSeconds
 * @param {number} staleFactor
 */
function write(key, value, ttlSeconds, staleFactor) {
  const now = Date.now();
  const ttl = ttlSeconds * 1000;

  store.set(key, {
    value,
    expiresAt: now + ttl,
    staleUntil: now + ttl + ttl * staleFactor,
  });

  const { maxEntries } = settings();
  while (store.size > maxEntries) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<unknown>} producer
 * @param {{ storeEmpty?: boolean, staleFactor?: number }} options
 * @returns {Promise<unknown>}
 */
function refresh(key, ttlSeconds, producer, options) {
  // Aynı anahtarı eşzamanlı isteyen yüz sayfa tek upstream isteğine düşer.
  // Isıtma turlarında bu tek başına kotanın büyük kısmını kurtarıyor.
  const pending = inflight.get(key);
  if (pending) return pending;

  const staleFactor = options.staleFactor ?? settings().staleFactor;

  const task = Promise.resolve()
    .then(producer)
    .then((value) => {
      const empty = value === undefined || value === null;
      if (!empty || options.storeEmpty === true) {
        write(key, value, ttlSeconds, staleFactor);
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
 * Veriyi önbellekten döner, gerekiyorsa `producer` ile üretir.
 *
 * @param {string} key Anahtar tamamen uygulamanın; sürüm/dil gibi ayrımlar
 *   anahtara yazılır (`quote:v2:${symbol}`).
 * @param {number} ttlSeconds 0 → önbellek yok, `producer` her çağrıda çalışır.
 * @param {() => Promise<T>} producer
 * @param {{ storeEmpty?: boolean, staleFactor?: number }} [options]
 *   `storeEmpty` boş cevabı da saklar, `staleFactor` bu anahtar için bayat
 *   penceresini ayarlar (0 → bayat servis yok).
 * @returns {Promise<T>}
 * @template T
 */
export async function withDataCache(key, ttlSeconds, producer, options = {}) {
  if (!ttlSeconds) return producer();

  const hit = read(key);

  if (hit) {
    // Bayat girdi anında döner; tazeleme arkada yürür ve hatası bu isteği
    // etkilemez — çağıran taraf bir şey beklemediği için upstream'in yavaş
    // olması sayfaya yansımaz.
    if (hit.stale) {
      void refresh(key, ttlSeconds, producer, options).catch((error) => {
        console.error(`[data-cache] background refresh failed: ${key}`, error);
      });
    }
    return /** @type {T} */ (hit.value);
  }

  try {
    return /** @type {T} */ (await refresh(key, ttlSeconds, producer, options));
  } catch (error) {
    // Girdi yoksa hata çağırana gider; asıl kazanç bayat girdinin olduğu
    // durumda: upstream düşmüşken sayfayı eski veriyle ayakta tutmak,
    // ziyaretçiye hata sayfası göstermekten iyidir.
    const stale = read(key);
    if (!stale) throw error;

    console.warn(
      `[data-cache] producer failed, serving stale value: ${key}`,
      error instanceof Error ? error.message : error,
    );
    return /** @type {T} */ (stale.value);
  }
}

/**
 * `withDataCache`'in fonksiyon sarmalayıcısı: argümanlardan anahtar üretir.
 * `cache()` (istek içi memoizasyon) ile aynı kullanım biçimi, ama istekler
 * arasında ve TTL'li.
 *
 * @param {F} fn
 * @param {{ key: string, revalidate: number, storeEmpty?: boolean,
 *   staleFactor?: number }} options `key` önektir; argümanlar sonuna eklenir.
 * @returns {F}
 * @template {(...args: any[]) => Promise<any>} F
 */
export function dataCache(fn, options) {
  const wrapped = (...args) =>
    withDataCache(
      args.length ? `${options.key}:${JSON.stringify(args)}` : options.key,
      options.revalidate,
      () => fn(...args),
      options,
    );

  return /** @type {F} */ (wrapped);
}

/**
 * Bir anahtarı ya da önek eşleşen tüm anahtarları düşürür. Webhook ile
 * "bu haber güncellendi" bilgisi geldiğinde kullanılır.
 *
 * @param {string} [prefix] Verilmezse tüm önbellek boşaltılır.
 * @returns {number} Silinen girdi sayısı.
 */
export function clearDataCache(prefix) {
  if (prefix === undefined) {
    const size = store.size;
    store.clear();
    return size;
  }

  let removed = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed += 1;
    }
  }
  return removed;
}

/** @returns {number} */
export function getDataCacheSize() {
  return store.size;
}

/**
 * Dev raporu ve yönetim uçları için döküm. Değerin kendisi dönmez: JSON'un
 * tamamını bir teşhis ucundan dışa vermek istenmez.
 *
 * @returns {{ key: string, stale: boolean, expiresIn: number }[]}
 */
export function getDataCacheEntries() {
  const now = Date.now();

  return [...store.entries()].map(([key, entry]) => ({
    key,
    stale: now >= entry.expiresAt,
    expiresIn: Math.round((entry.expiresAt - now) / 1000),
  }));
}
