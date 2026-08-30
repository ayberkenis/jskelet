/**
 * Bir render'ın hangi veri anahtarlarını okuduğunu kaydeder.
 *
 * `request-cache.js` ile aynı desen: `AsyncLocalStorage`, bağlam yoksa her şey
 * sessizce devre dışı. Script'ten, cron'dan ya da istek dışı bir yerden yapılan
 * `withDataCache` çağrıları hiçbir şeye yazılmaz.
 *
 * Neden gerekli: HTML önbelleğinin elinde "bu sayfa şu içerikten etkilenir"
 * bilgisi yoktu, dolayısıyla bir içerik güncellendiğinde tek seçenek TTL'i
 * beklemek ya da tüm önbelleği boşaltmaktı. Bağımlılığı uygulamanın elle
 * bildirmesi (tag'lemek) ise en sık yapılan hatayı davet ediyor: detay
 * sayfasını işaretleyip aynı içeriği listeleyen ana sayfayı unutmak.
 *
 * Burada bildirim yok, **gözlem** var: render sırasında fiilen okunan anahtarlar
 * kaydedilir. Ana sayfa o veriyi okuduysa listede olur, okumadıysa olmaz.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** @type {AsyncLocalStorage<Set<string>>} */
const storage = new AsyncLocalStorage();

/**
 * `run`'ı, içindeki `recordDependency()` çağrılarının `deps`'e yazacağı bir
 * bağlamda çalıştırır.
 *
 * @template T
 * @param {Set<string>} deps
 * @param {() => T} run
 * @returns {T}
 */
export function collectDependencies(deps, run) {
  return storage.run(deps, run);
}

/**
 * Bu render'ın bir veri anahtarını okuduğunu bildirir. Bağlam yoksa no-op.
 *
 * @param {string} key
 */
export function recordDependency(key) {
  storage.getStore()?.add(key);
}
