/**
 * ISR ikamesi: route + query anahtarlı, TTL'li LRU HTML cache.
 *
 * TTL dolduğunda girdi hemen atılmaz: `stale` pencerede eski HTML anında
 * döner ve tazeleme arkada çalışır. Böylece ilk ısıtmadan sonra hiçbir istek
 * render'ı beklemez; buna karşılık HTML'deki veri en fazla `revalidate + bir
 * tazeleme turu` kadar geride olabilir. Fiyat gibi canlı alanlar istemcide
 * WebSocket'ten güncellendiği için bu gecikme ekranda görünmez.
 *
 * TTL dolmadan önce de tazelenir (**erken tazeleme**): son başarılı üretimin
 * süresi (`produceMs`) kadar önden arka plan refresh başlar, böylece yavaş
 * bir sayfa TTL anında hâlâ soğuk render'a düşmez. Trafik yoksa sweeper
 * girdiyi soft-bayatlatır ve ısıtma kuyruğuna alır.
 *
 * TTL'in yanında ikinci bir tazelik kaynağı daha var: **hedefli
 * invalidation**. Bir içerik güncellendiğinde tüm önbelleği boşaltmak
 * (`clearHtmlCache()`) o an sıcak olan her sayfayı soğuk render'a çevirir;
 * TTL'i beklemek ise güncellemeyi dakikalarca geciktirir.
 * `invalidateHtmlCache()` ikisinin arasını açar ve varsayılan davranışı
 * **bayatlatmaktır**: girdi silinmez, süresi geçmiş sayılır. Ziyaretçi eski
 * HTML'i beklemeden alır, tazeleme arkada tek seferde koşar.
 *
 * ## Paylaşımlı kademe
 *
 * `cache.redis` açıkken store'un ikinci bir kademesi olur. Bellek içi store
 * (L1) **birincil kalır**: `read()` senkron, sıkıştırılmış gövdeler girdiyle
 * birlikte ve tutarlılık makinesi (`tokens`, `purgedDeps`) tek proseste. Redis
 * yalnızca L1'de bulunmayan bir yol için render'ı atlatır ve invalidation'ı
 * diğer node'lara duyurur. Redis yoksa aynı kayıt `.jskelet/cache/<buildId>/`
 * altına yazılır; bu tek makinenin yeniden açılışını karşılar, kümeyi değil.
 */

import { getConfig } from "../config/index.js";
import {
  DEFAULT_HTML_CACHE_MAX_ENTRIES,
  HTML_CACHE_BYTE_BUDGET,
} from "../config/defaults.js";
import { collectDependencies } from "./cache-deps.js";
import { compilePattern, matchPattern } from "../config/pattern.js";
import { pathOfCacheKey, publicHost } from "./cache-vary.js";
import { diskDrop, diskDropMatching, diskGetJson, diskSetJson, diskShares } from "./disk-cache.js";
import {
  cacheKey,
  onCacheEvent,
  publishCacheEvent,
  redisDrop,
  redisDropMatching,
  redisGetJson,
  redisSetJson,
  redisShares,
  redisSharesEncoded,
} from "./redis.js";

/**
 * `storedAt`: girdinin üretildiği an. Paylaşımlı kademeden gelen bir girdiyi
 * kabul etmeden önce "bu render yerel bir purge'den önce mi başladı" sorusu
 * yine sorulur; cevabı bu alan taşıyor.
 *
 * `sharedEncodings`: Redis'e en son kaç sıkıştırılmış gövde yazıldığı.
 * `encoded` haritası yanıt yolunda (`sendHtml`) doluyor, yani yazma anında
 * boş; `storeEncoded` açıkken harita büyüdüğünde girdi yeniden paylaşılır.
 *
 * `produceMs`: son başarılı üretimin süresi. Erken tazeleme penceresi bundan
 * türetilir; Redis'ten gelen kopyada yoksa varsayılan kullanılır.
 *
 * @typedef {{ html: string, status: number, expiresAt: number,
 *   staleUntil: number, encoded: Map<string, Buffer>, deps: Set<string>,
 *   storedAt: number, sharedEncodings: number, produceMs: number }} HtmlEntry
 */

/**
 * Girdi sınırı `cache().maxEntries` ile yükseltilebilir ama uzun kuyruklu bir
 * siteyi buradan çözmeye çalışmak yanlış katman: girdi başına yüz kilobayt
 * düşüyor. On binlerce yol için `withDataCache` kullanılır.
 *
 * Config yüklenmemiş olabilir (testler bu modülü doğrudan çağırıyor); o
 * durumda kod varsayılanı geçerli.
 *
 * @returns {number}
 */
function maxEntries() {
  try {
    return getConfig().htmlMaxEntries;
  } catch {
    return DEFAULT_HTML_CACHE_MAX_ENTRIES;
  }
}

/**
 * Bağımlılık izleme kapatılabilir olmalı: `withDataCache` kullanmayan bir
 * uygulamada hiçbir şey kaydedilmez ama bağlam kurma maliyeti kalır.
 *
 * @returns {boolean}
 */
function trackDependencies() {
  try {
    return getConfig().trackDependencies;
  } catch {
    return true;
  }
}

/**
 * TTL dolduktan sonra eski HTML'in kaç TTL boyunca daha servis edilebileceği.
 * Tazeleme genelde ilk stale istekte tamamlandığı için bu pencere yalnızca
 * yavaş upstream'lerde devreye girer.
 */
const STALE_FACTOR = 1;

/**
 * Redis'ten gelen veya süresi bilinmeyen girdiler için erken tazeleme lead'i.
 * Ölçülmüş `produceMs` yokken aşırı iyimser (0) kalmamak için.
 */
const DEFAULT_PRODUCE_MS = 500;

/** Erken tazelemenin alt sınırı — çok hızlı sayfalar da TTL'den önce ısınsın. */
const EARLY_REFRESH_MIN_MS = 250;

/** Trafiksiz girdileri erken pencerede soft-bayatlatma aralığı. */
const EARLY_SWEEP_INTERVAL_MS = 1000;

/**
 * Bir sweep turunda soft-bayatlatılan girdi tavanı. Aynı TTL'i paylaşan
 * yüzlerce sayfa tek saniyede kuyruğa girip render dalgası yaratmasın;
 * kalanlar sonraki turlara kalır. Öncelik `expiresAt`'i en yakın olan.
 */
const EARLY_SWEEP_MARK_BUDGET = 4;

/** @type {Map<string, HtmlEntry>} */
const store = new Map();

/**
 * `store` içindeki HTML string + sıkıştırılmış gövdelerin toplamı.
 * Her `drop` / `install` bunu günceller; sıkıştırma sonradan eklendiğinde
 * `noteHtmlCacheGrowth` artışı yazar. Tam tarama yapmamak için tutulur.
 */
let storedBytes = 0;

/**
 * Testler tahliyeyi küçük bir bütçeyle doğrular. `null` → üretim tavanı.
 * @type {number | null}
 */
let byteBudgetOverride = null;

/** @type {Map<string, Promise<{ html: string, status: number }>>} */
const inflight = new Map();

/** @type {ReturnType<typeof setInterval> | null} */
let earlySweepTimer = null;

/**
 * Uçuştaki her tazelemenin kimliği. Bir girdi tazelenirken invalidate
 * edilirse o tazelemenin sonucu **artık geçersizdir**: render, purge'den önce
 * okunmuş veriyle üretildi. Token silinince `write()` atlanır ve bir sonraki
 * istek yeni bir tur başlatır.
 *
 * @type {Map<string, object>}
 */
const tokens = new Map();

/**
 * Ters indeks: veri anahtarı → onu okumuş HTML anahtarları. `clearDataCache()`
 * bunu okuyup etkilenen sayfaları bayatlatır.
 *
 * @type {Map<string, Set<string>>}
 */
const dependents = new Map();

/**
 * Invalidate edilmiş ama henüz kimsenin istemediği yollar. Isıtma turu bunları
 * kuyruğun başına alır: "içerik güncellendi" bilgisi geldiğinde sayfa,
 * ziyaretçi gelmesini beklemeden tazelenir.
 *
 * Sınırlı tutulur — kimse ısıtma yapmıyorsa bu küme sessizce büyümemeli.
 *
 * @type {Set<string>}
 */
const invalidated = new Set();

const MAX_INVALIDATED = 500;

/**
 * Son zamanlarda düşürülen veri anahtarları ve düşürülme zamanları.
 *
 * Bir webhook, sayfa **render edilirken** gelirse ters indeks henüz o sayfayı
 * tanımıyor (bağımlılıklar yazma anında kaydediliyor) ve render, purge'den
 * önce okunmuş veriyle önbelleğe girerdi. Yazma anında bu haritaya bakmak,
 * "doğduğu anda bayat" girdiyi engeller.
 *
 * Render'lar saniyeler sürdüğü için harita kısa tutulur; sınır aşılınca en
 * eski kayıt düşer.
 *
 * @type {Map<string, number>}
 */
const purgedDeps = new Map();

const MAX_PURGED_DEPS = 1000;

/**
 * Erken tazeleme lead'i: son render süresinin 2 katı (en az 250 ms), TTL'in
 * yarısından fazla olamaz — kısa TTL'lerde sürekli refresh döngüsü olmasın.
 *
 * @param {number} produceMs
 * @param {number} ttlMs
 * @returns {number}
 */
export function earlyRefreshLeadMs(produceMs, ttlMs) {
  const measured =
    Number.isFinite(produceMs) && produceMs > 0 ? produceMs : DEFAULT_PRODUCE_MS;
  const lead = Math.max(measured * 2, EARLY_REFRESH_MIN_MS);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return lead;
  return Math.min(lead, ttlMs / 2);
}

/**
 * @param {HtmlEntry} entry
 * @returns {number}
 */
function entryTtlMs(entry) {
  // Soft-bayatlatılmış girdide expiresAt 0; orijinal TTL storedAt farkından
  // okunamaz. O durumda produceMs üzerinden güvenli bir üst sınır yeter.
  if (entry.expiresAt > entry.storedAt) return entry.expiresAt - entry.storedAt;
  return Math.max(entry.produceMs * 4, EARLY_REFRESH_MIN_MS * 2);
}

/**
 * @param {HtmlEntry} entry
 * @param {number} [now]
 * @returns {boolean}
 */
function isEarly(entry, now = Date.now()) {
  if (now >= entry.expiresAt) return false;
  const lead = earlyRefreshLeadMs(entry.produceMs, entryTtlMs(entry));
  return now >= entry.expiresAt - lead;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function normalizeProduceMs(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  return DEFAULT_PRODUCE_MS;
}

/**
 * Girdiyi ters indeksten söker. Bu adım atlanırsa indeks, düşen girdilerin
 * anahtarlarını tutmaya devam eder ve sessizce sızar.
 *
 * @param {string} key
 * @param {HtmlEntry} entry
 */
function unlink(key, entry) {
  for (const dep of entry.deps) {
    const set = dependents.get(dep);
    if (!set) continue;
    set.delete(key);
    if (!set.size) dependents.delete(dep);
  }
}

/**
 * Ham HTML + sıkıştırılmış gövdeler. Bayt bütçesi girdi sayısından bağımsız
 * bu ağırlığa bakar.
 *
 * @param {HtmlEntry} entry
 * @returns {number}
 */
function entryBytes(entry) {
  let bytes = Buffer.byteLength(entry.html);
  for (const buffer of entry.encoded.values()) bytes += buffer.length;
  return bytes;
}

/**
 * @returns {number}
 */
function activeByteBudget() {
  return byteBudgetOverride ?? HTML_CACHE_BYTE_BUDGET;
}

/**
 * Sayı tavanı veya bayt bütçesi aşılınca en eski girdiden düşer. Tek başına
 * bütçeyi aşan girdi de gider: yanıt o istekte zaten üretilmiştir, L1'de
 * durması süreci şişirir.
 */
function evictOverflow() {
  const limit = maxEntries();
  const budget = activeByteBudget();

  while (store.size > 0 && (store.size > limit || storedBytes > budget)) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    if (!drop(oldest)) break;
  }
}

/**
 * Store'dan silmenin **tek** yolu. Ters indeks ve bayt sayacı buraya bağlı;
 * hiçbir yerde doğrudan `store.delete()` çağrılmaz. `read()` içindeki
 * sil-yaz yalnızca LRU sırası içindir, sayacı değiştirmez.
 *
 * @param {string} key
 * @returns {boolean} Girdi var mıydı.
 */
function drop(key) {
  const entry = store.get(key);
  if (!entry) return false;

  unlink(key, entry);
  storedBytes = Math.max(0, storedBytes - entryBytes(entry));
  store.delete(key);
  return true;
}

/**
 * @param {string} key
 * @returns {{ html: string, status: number, encoded: Map<string, Buffer>,
 *   stale: boolean, early: boolean } | null}
 */
function read(key) {
  const entry = store.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now >= entry.staleUntil) {
    // Uçuştaki tazeleme bitene kadar girdiyi tut: yavaş upstream'de
    // staleUntil dolup MISS'e düşmek erken tazelemenin amacını bozar.
    if (!inflight.has(key)) {
      drop(key);
      return null;
    }
  }

  // LRU: erişilen girdiyi sona taşı.
  store.delete(key);
  store.set(key, entry);

  // `encoded` yanıt yolunda dolduğu için yazma anında paylaşılamıyor. Kontrol
  // yalnızca `storeEncoded` açıkken yapılır; kapalıyken (varsayılan) bu satır
  // tek bir karşılaştırmaya bile girmez.
  if (redisSharesEncoded() && entry.encoded.size !== entry.sharedEncodings) {
    share(key, entry);
  }

  const stale = now >= entry.expiresAt;
  return {
    html: entry.html,
    status: entry.status,
    encoded: entry.encoded,
    stale,
    early: !stale && isEarly(entry, now),
  };
}

/**
 * Girdiyi paylaşımlı kademeye yazar. Ateşle-unut: yanıt yolunda beklenmez,
 * L1 kopyası bu isteği zaten karşılıyor.
 *
 * @param {string} key
 * @param {HtmlEntry} entry
 */
function share(key, entry) {
  const onRedis = redisShares("html");
  const onDisk = diskShares("html");
  if (!onRedis && !onDisk) return;

  const ttlMs = entry.staleUntil - Date.now();
  if (ttlMs <= 0) return;

  /** @type {Record<string, unknown>} */
  const payload = {
    html: entry.html,
    status: entry.status,
    storedAt: entry.storedAt,
    expiresAt: entry.expiresAt,
    staleUntil: entry.staleUntil,
    produceMs: entry.produceMs,
    deps: [...entry.deps],
  };

  if (onRedis && redisSharesEncoded() && entry.encoded.size) {
    /** @type {Record<string, string>} */
    const encoded = {};
    for (const [encoding, buffer] of entry.encoded) {
      encoded[encoding] = buffer.toString("base64");
    }
    payload.encoded = encoded;
    entry.sharedEncodings = entry.encoded.size;
  }

  if (onRedis) redisSetJson(cacheKey("html", key), payload, ttlMs);
  else diskSetJson("html", key, payload);
}

/**
 * Paylaşımlı kademeden okur ve L1 girdisine çevirir.
 *
 * Yalnızca **taze** girdi kabul edilir: bayat bir kopyayı L1'e almak
 * tazelemeyi sonsuza kadar ertelerdi — girdi bayat kalır, her tazeleme turu
 * yine Redis'i okur ve `producer` hiç çalışmaz.
 *
 * @param {string} key
 * @returns {Promise<HtmlEntry | null>}
 */
async function readShared(key) {
  const onRedis = redisShares("html");
  const onDisk = diskShares("html");
  if (!onRedis && !onDisk) return null;

  const payload = onRedis
    ? await redisGetJson(cacheKey("html", key))
    : await diskGetJson("html", key);
  if (!payload || typeof payload.html !== "string") return null;
  if (typeof payload.expiresAt !== "number" || Date.now() >= payload.expiresAt) {
    // Dosyanın TTL'i yok; süresi dolmuş kopya okununca silinir.
    if (onDisk) diskDrop("html", [key]);
    return null;
  }

  const deps = new Set(Array.isArray(payload.deps) ? payload.deps.map(String) : []);
  const storedAt = Number(payload.storedAt) || 0;

  // Uzak girdi de yerel purge geçmişine takılır: bu proseste düşürülmüş bir
  // veriyi okumuş HTML'i geri almak, az önce yapılan invalidation'ı iptal
  // etmek olurdu.
  if (readsPurgedData(deps, storedAt)) return null;

  /** @type {Map<string, Buffer>} */
  const encoded = new Map();
  if (payload.encoded && typeof payload.encoded === "object") {
    for (const [encoding, base64] of Object.entries(payload.encoded)) {
      if (typeof base64 === "string") {
        encoded.set(encoding, Buffer.from(base64, "base64"));
      }
    }
    // Eski bir replica iki kodlama yazmış olabilir. L1 tek kopya tutar;
    // brotli varsa o kalır.
    if (encoded.size > 1) {
      const keep = encoded.has("br") ? "br" : encoded.keys().next().value;
      const buffer = keep ? encoded.get(keep) : undefined;
      encoded.clear();
      if (keep && buffer) encoded.set(keep, buffer);
    }
  }

  return {
    html: payload.html,
    status: Number(payload.status) || 200,
    encoded,
    // Mutlak zamanlar korunur: TTL'i yeniden başlatmak, girdinin node'dan
    // node'a atlayarak süresiz tazelik kazanması demek.
    expiresAt: payload.expiresAt,
    staleUntil: Number(payload.staleUntil) || payload.expiresAt,
    deps,
    storedAt,
    sharedEncodings: encoded.size,
    produceMs: normalizeProduceMs(payload.produceMs),
  };
}

/**
 * @param {string} key
 * @param {{ html: string, status: number }} value
 * @param {number} ttlSeconds
 * @param {Set<string> | null} deps Render sırasında okunan veri anahtarları.
 * @param {number} [produceMs] Son üretimin süresi (ms).
 */
function write(key, value, ttlSeconds, deps = null, produceMs = DEFAULT_PRODUCE_MS) {
  const now = Date.now();

  /** @type {HtmlEntry} */
  const entry = {
    html: value.html,
    status: value.status,
    // Sıkıştırılmış gövdeler HTML ile aynı ömrü paylaşır: aynı sayfa her
    // istekte yeniden brotli'lenmesin.
    encoded: new Map(),
    expiresAt: now + ttlSeconds * 1000,
    staleUntil: now + ttlSeconds * 1000 * (1 + STALE_FACTOR),
    deps: deps ?? new Set(),
    storedAt: now,
    sharedEncodings: 0,
    produceMs: normalizeProduceMs(produceMs),
  };

  // Bütçeye sığmayan sayfa Redis'e de yazılmaz: bir sonraki istek onu
  // geri alıp yine reddeder, stringify ise o anki RSS'i şişirir.
  if (install(key, entry)) share(key, entry);
}

/**
 * Girdiyi L1'e yerleştirir, ters indekse bağlar ve sınırı uygular. Store'a
 * yazmanın tek yolu bu.
 *
 * @param {string} key
 * @param {HtmlEntry} entry
 * @returns {boolean} Girdi L1'e girdi mi.
 */
function install(key, entry) {
  // Aynı anahtarın eski girdisi ters indekste kalmasın: bağımlılıklar
  // tazelemeden tazelemeye değişebilir.
  drop(key);

  const weight = entryBytes(entry);
  // Tek sayfa bütçeden büyükse saklama. Eski kopya da düştü; bu yanıt
  // üreticinin döndürdüğü HTML ile gider, L1'e girmez.
  if (weight > activeByteBudget()) return false;

  store.set(key, entry);
  storedBytes += weight;

  for (const dep of entry.deps) {
    let set = dependents.get(dep);
    if (!set) dependents.set(dep, (set = new Set()));
    set.add(key);
  }

  evictOverflow();
  return store.has(key);
}

/**
 * Sıkıştırılmış gövde `install()`'dan sonra, ilk brotli/gzip yanıtında
 * girdinin `encoded` haritasına eklenir. Sayacı delta ile büyütmek, o sıra
 * LRU'dan düşmüş bir haritaya yazınca bir daha inmeyen bir artık bırakır;
 * store'dan yeniden okumak o artığı taşımaz.
 *
 * @returns {void}
 */
export function noteHtmlCacheGrowth() {
  let bytes = 0;
  for (const entry of store.values()) bytes += entryBytes(entry);
  storedBytes = bytes;
  evictOverflow();
}

/**
 * Bellek freninin bayt tavanını geçici olarak değiştirir. Testler LRU
 * tahliyesini küçük bir değerle doğrular; `null` üretim tavanına döner.
 *
 * @param {number | null} bytes
 * @returns {void}
 */
export function setHtmlCacheByteBudget(bytes) {
  byteBudgetOverride = bytes == null ? null : bytes;
  evictOverflow();
}

/**
 * Bu render, başladıktan sonra düşürülmüş bir veriyi mi okudu.
 *
 * @param {Set<string> | null} deps
 * @param {number} startedAt
 * @returns {boolean}
 */
function readsPurgedData(deps, startedAt) {
  if (!deps) return false;

  for (const dep of deps) {
    const purgedAt = purgedDeps.get(dep);
    if (purgedAt !== undefined && purgedAt >= startedAt) return true;
  }
  return false;
}

/**
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<{ html: string, status: number, degraded?: boolean,
 *   storable?: boolean }>} producer
 * @returns {Promise<{ html: string, status: number, degraded?: boolean,
 *   storable?: boolean }>}
 */
function refresh(key, ttlSeconds, producer) {
  const pending = inflight.get(key);
  if (pending) return pending;

  // Tazeleme sürerken staleUntil dolmasın: drop → MISS yolu kapanır.
  extendStaleWhileRefreshing(key);

  const token = {};
  tokens.set(key, token);

  const task = produce(key, ttlSeconds, producer, token).finally(() => {
    inflight.delete(key);
    if (tokens.get(key) === token) tokens.delete(key);
  });

  inflight.set(key, task);
  return task;
}

/**
 * @param {string} key
 */
function extendStaleWhileRefreshing(key) {
  const entry = store.get(key);
  if (!entry) return;
  const lead = earlyRefreshLeadMs(entry.produceMs, entryTtlMs(entry));
  const floor = Date.now() + lead;
  if (entry.staleUntil < floor) entry.staleUntil = floor;
}

/**
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<{ html: string, status: number, degraded?: boolean,
 *   storable?: boolean }>} producer
 * @param {object} token
 * @returns {Promise<{ html: string, status: number, degraded?: boolean,
 *   storable?: boolean }>}
 */
async function produce(key, ttlSeconds, producer, token) {
  const startedAt = Date.now();

  // Başka bir node bu sayfayı zaten render ettiyse render hiç çalışmaz. Soğuk
  // ayağa kalkan bir instance'ın sıcak önbellek bulmasının tek yolu bu.
  const shared = await readShared(key);
  if (shared && tokens.get(key) === token) {
    install(key, shared);
    return { html: shared.html, status: shared.status };
  }

  // Bağımlılıklar tazelemede de toplanır, ilk üretimde değil sadece: sayfanın
  // okuduğu anahtarlar zamanla değişir (yeni bir widget, kaldırılan bir blok).
  const deps = trackDependencies() ? new Set() : null;

  const value = await (deps ? collectDependencies(deps, producer) : producer());

  // `degraded`: upstream düştüğü için eksik veriyle üretilmiş HTML.
  // Saklanırsa eksik içerik tüm TTL boyunca servis edilir.
  //
  // `storable: false`: çıktı kullanıcıya bağlı (cookie/Authorization
  // okundu). Anahtar yalnızca yol + query olduğu için saklamak, bir
  // kullanıcının HTML'ini bir başkasına servis etmek olur. Paylaşımlı
  // kademede bunun bedeli daha da ağır — bir kullanıcının HTML'i tüm kümeye
  // dağılırdı — bu yüzden kontrol Redis yazımından önce, `write()` içinde.
  //
  // Token uyuşmuyorsa bu tur, sonucu geçersiz kılan bir invalidation'ın
  // öncesinde başlamış demektir; yazmak az önce düşürüleni geri koyardı.
  const valid = tokens.get(key) === token && !readsPurgedData(deps, startedAt);
  if (valid && value.status === 200 && !value.degraded && value.storable !== false) {
    write(key, value, ttlSeconds, deps, Date.now() - startedAt);
  }

  return value;
}

/**
 * @param {string} key
 * @param {number} ttlSeconds 0 → cache yok
 * @param {() => Promise<{ html: string, status: number }>} producer
 * @returns {Promise<{ html: string, status: number, cached: boolean,
 *   stale?: boolean, early?: boolean, encoded?: Map<string, Buffer> }>}
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
    // Erken pencerede de aynı: hâlâ HIT, ama TTL dolmadan taze HTML yazılsın.
    if (hit.stale || hit.early) {
      invalidated.delete(key);
      void refresh(key, ttlSeconds, producer).catch((error) => {
        console.error(`[html-cache] background refresh failed: ${key}`, error);
      });
    }
    return { ...hit, cached: true };
  }

  invalidated.delete(key);
  const value = await refresh(key, ttlSeconds, producer);
  return { ...value, encoded: store.get(key)?.encoded, cached: false };
}

/**
 * Store'u tamamen boşaltır. Dev sunucusu manifest her değiştiğinde bunu
 * çağırır: saklanan HTML artık var olmayan hash'li varlıkları işaret ediyor,
 * yani gerçekten **geçersiz** — bayatlatmak yetmez.
 */
export function clearHtmlCache() {
  clearLocal();

  if (redisShares("html")) void redisDropMatching("html");
  else if (diskShares("html")) void diskDropMatching("html");
  publishCacheEvent({ type: "html:clear" });
}

/**
 * Boşaltmanın yerel kısmı. Uzaktan gelen olay bunu çağırır: yeniden yayın
 * yapan bir dinleyici iki node arasında sonsuz mesaj döngüsü üretir.
 */
function clearLocal() {
  store.clear();
  storedBytes = 0;
  dependents.clear();
  tokens.clear();
  invalidated.clear();
  purgedDeps.clear();
}

export function getHtmlCacheSize() {
  return store.size;
}

/**
 * Verilen hedefi HTML anahtarının yol kısmıyla eşleştiren bir eşleyici üretir.
 *
 * Üç biçim kabul edilir:
 *   `"/haber/abc"`     → o yol ve altındaki her şey (`/haber/abc/yorumlar`)
 *   `"/haber/:slug"`   → config'in her yerinde geçerli desen sözdizimi
 *   `/-yorumlar$/`     → desen sözdiziminin karşılamadığı kurallar için
 *
 * Düz string'te "önek" bilinçli olarak **segment sınırında** kesilir: `/haber`
 * kuralı `/haberler`i düşürmemeli.
 *
 * @param {string | RegExp} target
 * @returns {((pathname: string) => boolean) | null}
 */
function toMatcher(target) {
  if (target instanceof RegExp) return (pathname) => target.test(pathname);

  if (typeof target !== "string" || !target.startsWith("/")) {
    console.warn(`[html-cache] invalid invalidation target (must start with \`/\`): ${target}`);
    return null;
  }

  if (target.includes(":")) {
    const compiled = compilePattern(target);
    if (!compiled) return null;
    return (pathname) => matchPattern(compiled, pathname) !== null;
  }

  const prefix = target.endsWith("/") ? target : `${target}/`;
  return (pathname) => pathname === target || pathname.startsWith(prefix);
}

/**
 * Etkilenen girdiyi bayatlatır ya da düşürür.
 *
 * @param {string} key
 * @param {boolean} hard
 */
function invalidateKey(key, hard) {
  // Uçuştaki tazeleme bu invalidation'dan önce başladıysa sonucu eski veriyle
  // üretilmiş demektir; token'ı düşürmek onu yazılamaz hâle getirir. Girdi
  // henüz hiç yazılmamış olsa bile (ilk render sürüyor) bu geçerli.
  tokens.delete(key);

  const entry = store.get(key);
  if (entry) {
    // Bayat penceresi de dolmuşsa girdi zaten ölü: bayatlatmanın etkisi olmaz.
    if (hard || Date.now() >= entry.staleUntil) drop(key);
    else entry.expiresAt = 0;
  }

  if (invalidated.size < MAX_INVALIDATED) invalidated.add(key);
}

/**
 * Hedefli invalidation: TTL'i beklemeden, ama tüm önbelleği boşaltmadan.
 *
 * Varsayılan **yumuşaktır** (`hard: false`): girdi silinmez, süresi geçmiş
 * sayılır. Bir webhook beş yüz sayfayı birden düşürdüğünde sert silme, tam da
 * içeriğin güncellendiği anda beş yüz soğuk render başlatır ve upstream'i
 * döver. Bayatlatmada ise ziyaretçi eski HTML'i beklemeden alır, tazeleme
 * arkada ve anahtar başına tek seferde koşar. `hard: true` yalnızca eski
 * HTML'in gerçekten geçersiz olduğu durumlar için.
 *
 * Anahtar `yol?query` (isteğe bağlı `vary|` önekiyle) olduğundan eşleştirme
 * **yol kısmına** yapılır: bir yolun bütün query / host varyantları tek
 * çağrıyla düşer.
 *
 * @param {string | RegExp | (string | RegExp)[]} target
 * @param {{ hard?: boolean }} [options]
 * @returns {number} Etkilenen girdi sayısı (uçuştaki render'lar dahil).
 */
export function invalidateHtmlCache(target, options = {}) {
  const targets = Array.isArray(target) ? target : [target];
  const hard = options.hard === true;
  const count = invalidateLocal(targets, hard);

  // Paylaşımlı kopya yumuşak invalidation'da da **silinir**. Bayatlatmanın
  // Redis karşılığı her anahtar için oku-değiştir-yaz turu demek ve bir
  // webhook binlerce anahtarı birden düşürüyor. Silmenin bedeli, o yolu hiç
  // görmemiş bir node'un bir kez render etmesi; L1'i sıcak olan node'lar eski
  // HTML'i bayat pencerede servis etmeye devam ediyor.
  if (redisShares("html") || diskShares("html")) {
    const matchers = compileMatchers(targets);
    if (matchers.length) {
      const match = (key) => matchers.some((matcher) => matcher(pathOf(key)));
      if (redisShares("html")) void redisDropMatching("html", match);
      else void diskDropMatching("html", match);
    }
  }

  // Hedefler yayınlanır, eşleşen anahtarlar değil: hangi yolun nerede sıcak
  // olduğu node'a bağlı, her node deseni kendi store'una uygular.
  publishCacheEvent({
    type: "html:invalidate",
    hard,
    targets: targets.map(serializeTarget).filter((entry) => entry !== null),
  });

  return count;
}

/**
 * @param {(string | RegExp)[]} targets
 * @param {boolean} hard
 * @returns {number}
 */
function invalidateLocal(targets, hard) {
  const matchers = compileMatchers(targets);
  if (!matchers.length) return 0;

  let count = 0;

  // Uçuştaki render'lar da hedeflenir: henüz yazılmamış bir tur, purge'den
  // önce okunmuş veriyle önbelleğe girmemeli. Anahtarlar kopyalanır, çünkü
  // `invalidateKey` sert modda store'dan siliyor.
  for (const key of new Set([...store.keys(), ...tokens.keys()])) {
    if (!matchers.some((matcher) => matcher(pathOf(key)))) continue;
    invalidateKey(key, hard);
    count += 1;
  }

  return count;
}

/**
 * @param {(string | RegExp)[]} targets
 * @returns {((pathname: string) => boolean)[]}
 */
function compileMatchers(targets) {
  return /** @type {((pathname: string) => boolean)[]} */ (
    targets.map(toMatcher).filter((matcher) => matcher !== null)
  );
}

/**
 * Anahtar `[vary|]yol?query`; eşleştirme **yol** kısmına yapılır.
 * Vary öneki (`h=…|`) invalidation hedefiyle karışmasın.
 *
 * @param {string} key
 * @returns {string}
 */
function pathOf(key) {
  return pathOfCacheKey(key);
}

/**
 * `RegExp` JSON'a girmez (`JSON.stringify(/x/)` → `{}`), bu yüzden kaynak ve
 * bayrakları taşınır.
 *
 * @param {string | RegExp} target
 * @returns {string | { re: string, flags: string } | null}
 */
function serializeTarget(target) {
  if (typeof target === "string") return target;
  if (target instanceof RegExp) return { re: target.source, flags: target.flags };
  return null;
}

/**
 * @param {unknown} value
 * @returns {string | RegExp | null}
 */
function deserializeTarget(value) {
  if (typeof value === "string") return value;

  const entry = /** @type {{ re?: unknown, flags?: unknown }} */ (value);
  if (!entry || typeof entry.re !== "string") return null;

  try {
    return new RegExp(entry.re, typeof entry.flags === "string" ? entry.flags : "");
  } catch {
    // Bozuk bir desen bu node'u düşürmemeli; olay yok sayılır.
    return null;
  }
}

// Uzak bir node invalidation yaptığında bu proses de kendi L1'ini işaretler.
// Dinleyiciler yalnızca yerel yolları çağırır, yoksa mesaj döngüsü oluşur.
onCacheEvent((event) => {
  if (event.type === "html:clear") {
    clearLocal();
    return;
  }

  if (event.type === "html:drop") {
    if (typeof event.key === "string") dropLocalKey(event.key);
    return;
  }

  if (event.type !== "html:invalidate") return;

  const targets = /** @type {(string | RegExp)[]} */ (
    (Array.isArray(event.targets) ? event.targets : [])
      .map(deserializeTarget)
      .filter((entry) => entry !== null)
  );

  if (targets.length) invalidateLocal(targets, event.hard === true);
});

/**
 * Verilen veri anahtarlarını render sırasında okumuş sayfaları bayatlatır.
 * `clearDataCache()` bunu çağırır; uygulamanın hiçbir şey bildirmesi gerekmez.
 *
 * Burada **yayın yapılmaz**: çağıran `clearDataCache()` zaten bir
 * `data:clear` olayı yayınlıyor ve uzak node'lar aynı zinciri kendi ters
 * indeksleri üzerinden çalıştırıyor. Ters indeks node'a özel olduğu için
 * doğru olan da bu — bir sayfa yalnızca onu render etmiş node'da kayıtlı.
 *
 * @param {Iterable<string>} dataKeys
 * @returns {number} Etkilenen HTML girdisi sayısı.
 */
export function invalidateHtmlByDependency(dataKeys) {
  /** @type {Set<string>} */
  const keys = new Set();
  const now = Date.now();

  for (const dep of dataKeys) {
    // Şu anda render edilen bir sayfa bu veriyi okuduysa ters indekste henüz
    // görünmüyor; yazma anındaki kontrol için zaman damgası bırakılır.
    purgedDeps.set(dep, now);

    const set = dependents.get(dep);
    if (set) for (const key of set) keys.add(key);
  }

  while (purgedDeps.size > MAX_PURGED_DEPS) {
    const oldest = purgedDeps.keys().next().value;
    if (oldest === undefined) break;
    purgedDeps.delete(oldest);
  }

  for (const key of keys) invalidateKey(key, false);

  // Paylaşımlı kopyalar da düşer, yoksa soğuk bir node az önce geçersiz
  // kılınan HTML'i Redis'ten geri alırdı. Yalnızca bu node'un tanıdığı
  // anahtarlar silinebiliyor; hiçbir L1'de sıcak olmayan bir sayfanın Redis
  // kopyası TTL'ini bekler.
  if (keys.size && redisShares("html")) {
    redisDrop([...keys].map((key) => cacheKey("html", key)));
  } else if (keys.size && diskShares("html")) {
    diskDrop("html", [...keys]);
  }

  return keys.size;
}

/**
 * Tek bir önbellek **anahtarını** düşürür.
 *
 * `invalidateHtmlCache()` yol deseniyle çalışıyor ve bir yolun bütün query
 * varyantlarını birlikte düşürüyor. Yönetim paneli listedeki tek satırı
 * silebilmek istiyor: `/liste?sayfa=2` düşerken `/liste?sayfa=3` sıcak
 * kalmalı. Desen sözdiziminde `?` kaçırılamadığı için ayrı bir yüzey.
 *
 * @param {string} key `yol?query` biçiminde tam anahtar.
 * @returns {boolean} Girdi var mıydı.
 */
export function dropHtmlCacheKey(key) {
  const existed = dropLocalKey(key);

  if (redisShares("html")) redisDrop([cacheKey("html", key)]);
  else if (diskShares("html")) diskDrop("html", [key]);
  publishCacheEvent({ type: "html:drop", key });

  return existed;
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function dropLocalKey(key) {
  // Uçuştaki tazeleme de geçersiz: silinen girdiyi geri yazmamalı.
  tokens.delete(key);
  invalidated.delete(key);
  return drop(key);
}

/**
 * Vary önekinden `h=` parçasını okur. Önek yoksa boş string.
 *
 * @param {string} key
 * @returns {string}
 */
function hostOfCacheKey(key) {
  const sep = key.indexOf("|/");
  if (sep === -1) return "";
  const prefix = key.slice(0, sep);
  for (const part of prefix.split("&")) {
    if (part.startsWith("h=")) return part.slice(2);
  }
  return "";
}

/**
 * @param {string} key
 * @returns {string}
 */
function pathWithQuery(key) {
  const pathname = pathOfCacheKey(key);
  const q = key.indexOf("?");
  if (q === -1) return pathname;
  const query = key.slice(q + 1);
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Invalidate edilmiş yollar. Okuma yıkıcıdır; iki tur aynı yolu tekrar
 * ısıtmasın. `onlyHost` verilirse başka host'ların anahtarları kuyrukta
 * kalır — süre dolumu onları kendi host'uyla ısıtır, `127.0.0.1` anahtarı
 * açılmaz.
 *
 * @param {string} [onlyHost]
 * @returns {{ key: string, path: string, host: string }[]}
 */
export function takeInvalidatedTargets(onlyHost) {
  if (!invalidated.size) return [];

  /** @type {{ key: string, path: string, host: string }[]} */
  const taken = [];

  for (const key of [...invalidated]) {
    const host = hostOfCacheKey(key);
    if (onlyHost && host && host !== onlyHost) continue;
    invalidated.delete(key);
    taken.push({ key, path: pathWithQuery(key), host });
  }

  return taken;
}

/**
 * Yol listesi. Vary öneki düşülür; host ayrımı `takeInvalidatedTargets`.
 *
 * @returns {string[]}
 */
export function takeInvalidatedPaths() {
  return takeInvalidatedTargets().map((target) => target.path);
}

/**
 * Dev raporu için önbellek dökümü: hangi sayfa ne kadar HTML tutuyor, ne
 * zaman bayatlıyor, kaç veri anahtarına bağlı. HTML gövdesi dönmez, yalnızca
 * boyutu.
 *
 * @returns {{ key: string, bytes: number, status: number, stale: boolean,
 *   expiresIn: number, encodings: string[], deps: number }[]}
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
    deps: entry.deps.size,
  }));
}

/**
 * Yol (query'siz) için taze bir HTML girdisi var mı? Ziyaret ısıtması yalnızca
 * soğuk / bayat hedefleri kuyruğa alır; HIT'leri yeniden çekmez.
 *
 * Gerçek anahtar `h=host|/yol?` biçimindedir: düz `store.get(pathname)` hem
 * vary önekini hem sondaki `?` işaretini kaçırır ve sıcak sayfayı yeniden
 * ısıtır. `vary.host` açıkken yalnızca bu isteğin host'u sayılır; diğer
 * locale'in kopyası bu yolu sıcak yapmaz.
 *
 * @param {string} pathname
 * @param {{ headers?: Record<string, unknown>, get?: (name: string) => string | undefined }} [req]
 * @returns {boolean}
 */
export function isHtmlCacheFresh(pathname, req) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return false;

  let host = "";
  try {
    if (getConfig().cacheVary?.host && req) host = publicHost(req);
  } catch {
    // Config yokken (testler) önek aranmaz; yol eşleşmesi yeter.
  }

  const now = Date.now();
  for (const [key, entry] of store) {
    if (now >= entry.expiresAt) continue;
    if (pathOfCacheKey(key) !== pathname) continue;
    const q = key.indexOf("?");
    if (q !== -1 && key.slice(q + 1)) continue;
    if (host && hostOfCacheKey(key) !== host) continue;
    return true;
  }

  return false;
}

/**
 * Bu anahtarın girdisi hâlâ taze mi? Süre dolumu ısıtması anahtarı bildiği
 * için yol taraması yapmaz. Soft-bayat (`expiresAt === 0`) taze sayılmaz:
 * ziyaretçi arada yenilediyse yeni `expiresAt` taze döner ve HTTP atlanır.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function isHtmlCacheKeyFresh(key) {
  const entry = store.get(key);
  if (!entry) return false;
  return Date.now() < entry.expiresAt;
}

/**
 * Girdide en fazla bir sıkıştırılmış gövde durur. Yeni kodlama eskisinin
 * yerini alır; ham HTML kalır. Bayt sayacı `noteHtmlCacheGrowth` ile işlenir.
 *
 * @param {Map<string, Buffer>} encoded
 * @param {string} encoding
 * @param {Buffer} buffer
 * @returns {void}
 */
export function rememberHtmlEncoding(encoded, encoding, buffer) {
  for (const key of [...encoded.keys()]) {
    if (key !== encoding) encoded.delete(key);
  }
  encoded.set(encoding, buffer);
  noteHtmlCacheGrowth();
}

/**
 * Erken tazeleme penceresine girmiş (veya TTL'i dolmuş) trafiksiz girdileri
 * soft-bayatlatır ve ısıtma kuyruğuna alır. HTTP ısıtması producer'sız
 * çalıştığı için soft-bayat şart: taze HIT yenileme tetiklemez.
 *
 * Tur başına en fazla `EARLY_SWEEP_MARK_BUDGET` girdi. Önce süresi en yakın
 * dolacak olan; kota dolunca kalanlar bir sonraki tura kalır.
 *
 * @returns {number} İşaretlenen girdi sayısı.
 */
export function sweepEarlyExpiry() {
  const now = Date.now();
  /** @type {{ key: string, expiresAt: number }[]} */
  const due = [];

  for (const [key, entry] of store) {
    if (inflight.has(key)) continue;
    // Zaten soft-bayat / kuyrukta — her saniye yeniden ekleme.
    if (entry.expiresAt === 0) continue;
    if (now < entry.expiresAt && !isEarly(entry, now)) continue;
    due.push({ key, expiresAt: entry.expiresAt });
  }

  due.sort((a, b) => a.expiresAt - b.expiresAt);

  let marked = 0;
  for (const item of due) {
    if (marked >= EARLY_SWEEP_MARK_BUDGET) break;
    const entry = store.get(item.key);
    if (!entry || inflight.has(item.key) || entry.expiresAt === 0) continue;

    entry.expiresAt = 0;
    if (invalidated.size < MAX_INVALIDATED) invalidated.add(item.key);
    marked += 1;
  }

  return marked;
}

/**
 * Trafiksiz sayfaların TTL öncesi soft-bayatlatılması. `startPrewarm` açar;
 * `PREWARM=0` iken hiç kurulmaz. `unref` — süreç kapanışını geciktirmez.
 *
 * @returns {void}
 */
export function startEarlyExpirySweep() {
  if (earlySweepTimer) return;
  earlySweepTimer = setInterval(() => {
    sweepEarlyExpiry();
  }, EARLY_SWEEP_INTERVAL_MS);
  earlySweepTimer.unref();
}
