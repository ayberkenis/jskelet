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
 *
 * `cache.redis` açıkken bu önbellek ikinci bir kademeye (L2) yaslanır. Redis'e
 * en uygun katman burası: JSON küçük, sıkıştırılmış varyant sorunu yok ve
 * kazanç doğrudan API kotasına yazılıyor — bir node'un çektiği veri hepsine
 * yeter. Redis kapalı ya da erişilemez olduğunda bu modül birebir eskisi gibi
 * çalışır.
 */
import { getConfig } from "../config/index.js";
import { DEFAULT_DATA_CACHE } from "../config/defaults.js";
import { recordDependency } from "./cache-deps.js";
import { invalidateHtmlByDependency } from "./html-cache.js";
import {
  cacheKey,
  onCacheEvent,
  publishCacheEvent,
  redisDropMatching,
  redisGetJson,
  redisSetJson,
  redisShares,
} from "./redis.js";

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

/** Girdi sınırını aşan en eski kayıtları düşürür. */
function evict() {
  const { maxEntries } = settings();
  while (store.size > maxEntries) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
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

  /** @type {DataEntry} */
  const entry = {
    value,
    expiresAt: now + ttl,
    staleUntil: now + ttl + ttl * staleFactor,
  };

  store.set(key, entry);

  // Redis kopyası ateşle-unut: çağıran taraf beklemez. Anahtarın Redis ömrü
  // bayat penceresinin sonuna kadar, çünkü bayat veri de işe yarıyor.
  if (redisShares("data")) {
    redisSetJson(cacheKey("data", key), entry, entry.staleUntil - now);
  }

  evict();
}

/**
 * Başka bir node'un yazdığı girdiyi L1'e alır. TTL yeniden başlatılmaz:
 * mutlak zamanlar olduğu gibi korunur, yoksa girdi node'dan node'a atlayarak
 * süresiz tazelik kazanır.
 *
 * @param {string} key
 * @param {DataEntry} entry
 */
function promote(key, entry) {
  store.set(key, entry);
  evict();
}

/**
 * Paylaşımlı kademeden okur.
 *
 * Yalnızca **taze** girdi kabul edilir. Bayat bir kopyayı L1'e almak
 * tazelemeyi sonsuza kadar ertelerdi: girdi bayat kalır, her tazeleme turu
 * yine Redis'i okur ve `producer` hiç çalışmaz.
 *
 * @param {string} key
 * @returns {Promise<DataEntry | null>}
 */
async function readShared(key) {
  if (!redisShares("data")) return null;

  const entry = await redisGetJson(cacheKey("data", key));
  if (!entry || typeof entry.expiresAt !== "number") return null;
  if (Date.now() >= entry.expiresAt) return null;

  return /** @type {DataEntry} */ (entry);
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

  const task = produce(key, ttlSeconds, producer, options, staleFactor).finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, task);
  return task;
}

/**
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<unknown>} producer
 * @param {{ storeEmpty?: boolean, staleFactor?: number }} options
 * @param {number} staleFactor
 * @returns {Promise<unknown>}
 */
async function produce(key, ttlSeconds, producer, options, staleFactor) {
  // Başka bir node bu anahtarı çoktan tazelediyse upstream'e hiç gitmeyiz.
  // Kotayı koruyan `inflight` birleştirmesinin küme çapındaki karşılığı bu.
  const shared = await readShared(key);
  if (shared) {
    promote(key, shared);
    return shared.value;
  }

  const value = await producer();

  const empty = value === undefined || value === null;
  if (!empty || options.storeEmpty === true) {
    write(key, value, ttlSeconds, staleFactor);
  }

  return value;
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

  // Bu anahtarı okuyan render, `clearDataCache(key)` çağrıldığında etkilenen
  // sayfalar arasında sayılsın. Render bağlamı yoksa çağrı no-op.
  recordDependency(key);

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
 * Düşen anahtarları **render sırasında okumuş** HTML girdileri de bayatlar:
 * uygulamanın ayrıca `invalidateHtmlCache()` çağırması gerekmez ve aynı veriyi
 * gösteren liste sayfalarını unutmak mümkün değildir (bkz. `cache-deps.js`).
 *
 * `cache.redis` açıkken çağrı ayrıca paylaşımlı kademeden siler ve diğer
 * node'lara duyurulur — bugün bir webhook yalnızca isteği alan node'un
 * önbelleğini tazeliyor, diğerleri TTL'i bekliyordu.
 *
 * @param {string} [prefix] Verilmezse tüm önbellek boşaltılır.
 * @returns {number} Silinen girdi sayısı.
 */
export function clearDataCache(prefix) {
  const removed = clearLocal(prefix);

  if (redisShares("data")) {
    void redisDropMatching(
      "data",
      prefix === undefined ? undefined : (key) => key.startsWith(prefix),
    );
  }

  // Yayın yerel silmeden **sonra** yapılır; diğer node'lar kendi anahtarlarını
  // kendileri tarar, çünkü hangi anahtarın nerede sıcak olduğu node'a bağlı.
  publishCacheEvent({ type: "data:clear", prefix: prefix ?? null });

  return removed;
}

/**
 * Silmenin yerel kısmı. Uzaktan gelen olay bunu çağırır: yeniden yayın yapan
 * bir dinleyici iki node arasında sonsuz mesaj döngüsü üretir.
 *
 * @param {string} [prefix]
 * @returns {number}
 */
function clearLocal(prefix) {
  /** @type {string[]} */
  const removed = [];

  if (prefix === undefined) {
    removed.push(...store.keys());
    store.clear();
  } else {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key);
        removed.push(key);
      }
    }
  }

  if (removed.length) invalidateHtmlByDependency(removed);
  return removed.length;
}

// Uzak bir node veri düşürdüğünde bu proses de kendi L1'ini temizler; zincir
// `invalidateHtmlByDependency` üzerinden etkilenen sayfalara kadar gider.
onCacheEvent((event) => {
  if (event.type !== "data:clear") return;
  clearLocal(typeof event.prefix === "string" ? event.prefix : undefined);
});

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
