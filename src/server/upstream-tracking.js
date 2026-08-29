/**
 * Render başına upstream API hatalarını toplar.
 *
 * `render.js` her sayfayı bu bağlam içinde üretir; uygulamanın HTTP istemcisi
 * başarısız bir upstream yanıtında `reportUpstreamFailure()` çağırır. Böylece
 * HTML önbelleği "bu çıktı eksik veriyle üretildi" bilgisine sahip olur ve
 * bozuk sayfayı saklamaz.
 *
 * Bağımlılık yönü bilinçli olarak tersine çevrilmiş: framework veri katmanını
 * tanımaz, veri katmanı framework'e haber verir. Hiç çağıran olmazsa maliyet
 * boş bir dizidir.
 *
 * Kullanım (uygulamanın `lib/api/client.js` içinde):
 *
 *   import { reportUpstreamFailure } from "jskelet/server";
 *
 *   if (!response.ok) {
 *     reportUpstreamFailure({ status: response.status, path: url });
 *   }
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * @typedef {{ status: number, path: string }} UpstreamFailure
 *   `status: 0` ağ hatası anlamına gelir (yanıt hiç gelmedi).
 */

/** @type {AsyncLocalStorage<{ failures: UpstreamFailure[] }>} */
const storage = new AsyncLocalStorage();

/**
 * @param {UpstreamFailure} failure
 * @returns {void}
 */
export function reportUpstreamFailure(failure) {
  storage.getStore()?.failures.push(failure);
}

/**
 * @param {() => T} run
 * @returns {T}
 * @template T
 */
export function withUpstreamTracking(run) {
  return storage.run({ failures: [] }, run);
}

/** @returns {UpstreamFailure[]} */
export function getUpstreamFailures() {
  return storage.getStore()?.failures ?? [];
}
