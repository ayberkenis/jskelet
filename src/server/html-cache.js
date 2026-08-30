/**
 * ISR ikamesi: route + query anahtarlı, TTL'li LRU HTML cache.
 *
 * TTL dolduğunda girdi hemen atılmaz: `stale` pencerede eski HTML anında
 * döner ve tazeleme arkada çalışır. Böylece ilk ısıtmadan sonra hiçbir istek
 * render'ı beklemez; buna karşılık HTML'deki veri en fazla `revalidate + bir
 * tazeleme turu` kadar geride olabilir. Fiyat gibi canlı alanlar istemcide
 * WebSocket'ten güncellendiği için bu gecikme ekranda görünmez.
 *
 * TTL'in yanında ikinci bir tazelik kaynağı daha var: **hedefli
 * invalidation**. Bir içerik güncellendiğinde tüm önbelleği boşaltmak
 * (`clearHtmlCache()`) o an sıcak olan her sayfayı soğuk render'a çevirir;
 * TTL'i beklemek ise güncellemeyi dakikalarca geciktirir.
 * `invalidateHtmlCache()` ikisinin arasını açar ve varsayılan davranışı
 * **bayatlatmaktır**: girdi silinmez, süresi geçmiş sayılır. Ziyaretçi eski
 * HTML'i beklemeden alır, tazeleme arkada tek seferde koşar.
 */

import { getConfig } from "../config/index.js";
import { DEFAULT_HTML_CACHE_MAX_ENTRIES } from "../config/defaults.js";
import { collectDependencies } from "./cache-deps.js";
import { compilePattern, matchPattern } from "../config/pattern.js";

/**
 * @typedef {{ html: string, status: number, expiresAt: number,
 *   staleUntil: number, encoded: Map<string, Buffer>, deps: Set<string> }} HtmlEntry
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

/** @type {Map<string, HtmlEntry>} */
const store = new Map();

/** @type {Map<string, Promise<{ html: string, status: number }>>} */
const inflight = new Map();

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
 * Store'dan silmenin **tek** yolu. Ters indeks bakımı buraya bağlı olduğu için
 * hiçbir yerde doğrudan `store.delete()` çağrılmaz.
 *
 * @param {string} key
 * @returns {boolean} Girdi var mıydı.
 */
function drop(key) {
  const entry = store.get(key);
  if (!entry) return false;

  unlink(key, entry);
  store.delete(key);
  return true;
}

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
    drop(key);
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
 * @param {Set<string> | null} deps Render sırasında okunan veri anahtarları.
 */
function write(key, value, ttlSeconds, deps = null) {
  const now = Date.now();

  // Aynı anahtarın eski girdisi ters indekste kalmasın: bağımlılıklar
  // tazelemeden tazelemeye değişebilir.
  drop(key);

  store.set(key, {
    html: value.html,
    status: value.status,
    // Sıkıştırılmış gövdeler HTML ile aynı ömrü paylaşır: aynı sayfa her
    // istekte yeniden brotli'lenmesin.
    encoded: new Map(),
    expiresAt: now + ttlSeconds * 1000,
    staleUntil: now + ttlSeconds * 1000 * (1 + STALE_FACTOR),
    deps: deps ?? new Set(),
  });

  if (deps) {
    for (const dep of deps) {
      let set = dependents.get(dep);
      if (!set) dependents.set(dep, (set = new Set()));
      set.add(key);
    }
  }

  const limit = maxEntries();
  while (store.size > limit) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    drop(oldest);
  }
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

  const token = {};
  tokens.set(key, token);
  const startedAt = Date.now();

  // Bağımlılıklar tazelemede de toplanır, ilk üretimde değil sadece: sayfanın
  // okuduğu anahtarlar zamanla değişir (yeni bir widget, kaldırılan bir blok).
  const deps = trackDependencies() ? new Set() : null;

  const task = (deps ? collectDependencies(deps, producer) : producer())
    .then((value) => {
      // `degraded`: upstream düştüğü için eksik veriyle üretilmiş HTML.
      // Saklanırsa eksik içerik tüm TTL boyunca servis edilir.
      //
      // `storable: false`: çıktı kullanıcıya bağlı (cookie/Authorization
      // okundu). Anahtar yalnızca yol + query olduğu için saklamak, bir
      // kullanıcının HTML'ini bir başkasına servis etmek olur.
      //
      // Token uyuşmuyorsa bu tur, sonucu geçersiz kılan bir invalidation'ın
      // öncesinde başlamış demektir; yazmak az önce düşürüleni geri koyardı.
      const valid = tokens.get(key) === token && !readsPurgedData(deps, startedAt);
      if (valid && value.status === 200 && !value.degraded && value.storable !== false) {
        write(key, value, ttlSeconds, deps);
      }
      return value;
    })
    .finally(() => {
      inflight.delete(key);
      if (tokens.get(key) === token) tokens.delete(key);
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
  store.clear();
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
 * Anahtar `yol?query` olduğundan eşleştirme **yol kısmına** yapılır: bir
 * yolun bütün query varyantları (`?utm_source=…` dahil) tek çağrıyla düşer.
 *
 * @param {string | RegExp | (string | RegExp)[]} target
 * @param {{ hard?: boolean }} [options]
 * @returns {number} Etkilenen girdi sayısı (uçuştaki render'lar dahil).
 */
export function invalidateHtmlCache(target, options = {}) {
  const matchers = (Array.isArray(target) ? target : [target])
    .map(toMatcher)
    .filter((matcher) => matcher !== null);

  if (!matchers.length) return 0;

  const hard = options.hard === true;
  let count = 0;

  // Uçuştaki render'lar da hedeflenir: henüz yazılmamış bir tur, purge'den
  // önce okunmuş veriyle önbelleğe girmemeli. Anahtarlar kopyalanır, çünkü
  // `invalidateKey` sert modda store'dan siliyor.
  for (const key of new Set([...store.keys(), ...tokens.keys()])) {
    const mark = key.indexOf("?");
    const pathname = mark === -1 ? key : key.slice(0, mark);
    if (!matchers.some((matcher) => matcher(pathname))) continue;
    invalidateKey(key, hard);
    count += 1;
  }

  return count;
}

/**
 * Verilen veri anahtarlarını render sırasında okumuş sayfaları bayatlatır.
 * `clearDataCache()` bunu çağırır; uygulamanın hiçbir şey bildirmesi gerekmez.
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
  return keys.size;
}

/**
 * Invalidate edilmiş ve henüz kimsenin istemediği yolları döner ve kuyruğu
 * boşaltır. Isıtma turu bunları başa alır; iki tur aynı yolu tekrar
 * ısıtmasın diye okuma yıkıcıdır.
 *
 * @returns {string[]}
 */
export function takeInvalidatedPaths() {
  if (!invalidated.size) return [];

  const paths = [...invalidated];
  invalidated.clear();
  // Anahtar `yol?query`; query boşsa sondaki `?` atılır.
  return paths.map((key) => (key.endsWith("?") ? key.slice(0, -1) : key));
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
