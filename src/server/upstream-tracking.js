/**
 * Render başına upstream API hatalarını toplar.
 *
 * `render.js` her sayfayı bu bağlam içinde üretir. Böylece HTML önbelleği "bu
 * çıktı eksik veriyle üretildi" bilgisine sahip olur ve bozuk sayfayı saklamaz;
 * `notFound()` de geçici bir hataya denk geldiğinde 404 olmaktan çıkar.
 *
 * Bilgi iki yoldan gelir:
 *
 *   1. **Otomatik** — `trackUpstreamFetch()` `globalThis.fetch`i sarar ve
 *      geçici hataları (429, 5xx, ağ) kendiliğinden bildirir. `createApp()`
 *      bunu açılışta kurar, yani hiçbir uygulama kodu gerekmez.
 *   2. **Elle** — `fetch` kullanmayan bir istemci (veritabanı sürücüsü, gRPC,
 *      SDK) için:
 *
 *        import { reportUpstreamFailure } from "jskelet";
 *
 *        if (!response.ok) {
 *          reportUpstreamFailure({ status: response.status, path: url });
 *        }
 *
 * İki yol aynı hatayı bildirirse tekilleştirilir.
 *
 * Sarmalayıcı aynı zamanda hız freninin durduğu yerdir
 * (`upstream-limiter.js`): kotayı harcayan şey sayfa isteği değil, buradan
 * geçen çağrı. Fren varsayılan olarak kapalı.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { limitUpstream, noteUpstreamResponse } from "./upstream-limiter.js";

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
  const store = storage.getStore();
  if (!store) return;

  // Aynı hatayı hem otomatik sarmalayıcı hem uygulamanın istemcisi
  // bildirebilir; aynı satırı iki kez loglamanın faydası yok.
  const duplicate = store.failures.some(
    (existing) => existing.status === failure.status && existing.path === failure.path,
  );
  if (!duplicate) store.failures.push(failure);
}

/**
 * Geçici sayılan durumlar: tekrar denemekle düzelebilenler. Bu liste
 * `render.js` ile paylaşılır — hangi hatanın önbelleği engellediği ve hangi
 * hatanın `notFound()`u 404 olmaktan çıkardığı tek yerde tanımlı olsun.
 */
const TRANSIENT_STATUSES = new Set([0, 408, 425, 429]);

/**
 * @param {number} status
 * @returns {boolean}
 */
export function isTransientStatus(status) {
  return TRANSIENT_STATUSES.has(status) || status >= 500;
}

/**
 * `globalThis.fetch`i sarıp **geçici** upstream hatalarını kendiliğinden
 * bildirir.
 *
 * Gerekçesi pratik: `reportUpstreamFailure()` sözleşmesi uygulamanın HTTP
 * istemcisine bir satır eklemeyi gerektiriyor ve o satır yazılmadığında
 * framework rate limit'i hiç göremiyor — veri gelmediği için `notFound()`
 * çağıran sayfa 404 olarak servis ediliyordu. Otomatik izleme bu bilgiyi
 * varsayılan hâle getirir; elle çağrı hâlâ geçerli ve tekilleştirilir.
 *
 * Yalnızca geçici durumlar bildirilir. `404`/`403` gibi deterministik
 * cevaplar birçok API'de "böyle bir kayıt yok" anlamına geliyor ve onları
 * otomatik olarak "eksik veri" saymak her sayfada yanlış uyarı üretirdi.
 *
 * Kendi sunucumuza yapılan istekler atlanır: ısıtma turu ve sağlık kontrolü
 * upstream değil.
 *
 * @returns {void}
 */
export function trackUpstreamFetch() {
  const original = globalThis.fetch;
  if (/** @type {any} */ (original).__jskeletUpstreamTracked) return;

  /** @type {typeof fetch} */
  const wrapped = async (input, init) => {
    // İstek bir render bağlamı içinde değilse (script, zamanlayıcı) hiçbir
    // şey yapılmaz: sarmalayıcının maliyeti bir `getStore()` çağrısı.
    if (!storage.getStore()) return original(input, init);

    const url = requestUrl(input);
    if (isSelfRequest(url)) return original(input, init);

    // Hız freni burada, çünkü kotayı harcayan şey sayfa değil bu çağrı.
    // Kapalıysa (varsayılan) `null` döner ve tek maliyeti bir dal.
    const permit = await limitUpstream(url);

    if (permit?.blocked) {
      // Devre kesici açık: 429 yiyeceğini bildiğimiz bir çağrıyı yapmıyoruz.
      // Render tarafı bunu geçici hata olarak görür, yani sayfa önbelleğe
      // yazılmaz ve bir sonraki istek yeniden dener.
      reportUpstreamFailure({ status: 429, path: url });
      return new Response(null, { status: 429, statusText: "Too Many Requests" });
    }

    try {
      const response = await original(input, init);

      if (permit) {
        noteUpstreamResponse(permit.host, response.status, response.headers.get("retry-after"));
      }

      if (!response.ok && isTransientStatus(response.status)) {
        reportUpstreamFailure({ status: response.status, path: url });
      }
      return response;
    } catch (error) {
      // Yanıt hiç gelmedi: ağ hatası her zaman geçicidir.
      if (permit) noteUpstreamResponse(permit.host, 0, null);
      reportUpstreamFailure({ status: 0, path: url });
      throw error;
    } finally {
      permit?.release();
    }
  };

  /** @type {any} */ (wrapped).__jskeletUpstreamTracked = true;
  globalThis.fetch = wrapped;
}

/**
 * @param {RequestInfo | URL} input
 * @returns {string}
 */
function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return /** @type {Request} */ (input)?.url ?? String(input);
}

/** @param {string} url */
function isSelfRequest(url) {
  return /^https?:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:|\/|$)/i.test(url);
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
