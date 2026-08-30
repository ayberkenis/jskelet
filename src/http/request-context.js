/**
 * İstek başına yaşayan bağlam.
 *
 * `request-cache.js` ile aynı desen: `AsyncLocalStorage`, bağlam yoksa her şey
 * sessizce devre dışı. Ayrı bir modül olmasının sebebi, taşıdığı bilginin
 * memoizasyondan farklı olması — burada tutulanlar bir isteğin **cache'lenip
 * cache'lenemeyeceğine** dair kararlar:
 *
 *   private  → route açıkça "bu sayfa kişiye özel" dedi
 *   tainted  → controller cookie/Authorization okudu, yani çıktı kullanıcıya
 *              bağlı olabilir; HTML cache'e yazmak sızıntı olur
 *   csrfToken → bu istek için üretilmiş token; `csrfField()` şablonda basar
 *   res      → token cookie'sini yazabilmek için; başka hiçbir şey için
 *              kullanılmaz, şablonlara yanıt nesnesi sızmaz
 *
 * `tainted` bir tahmin değil, gözlem: `markTainted()` yalnızca gerçekten
 * kimliğe dokunan bir erişimden sonra çağrılır (bkz. `guardRequest`).
 */
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * @typedef {object} RequestContext
 * @property {boolean} private Route `private: true` ile mi kaydedildi.
 * @property {boolean} tainted Kimliğe bağlı bir veri okundu mu.
 * @property {string[]} taintReasons Hangi erişimler işaretledi (teşhis için).
 * @property {string | null} csrfToken
 * @property {import('express').Response | null} res
 */

/** @type {AsyncLocalStorage<RequestContext>} */
const storage = new AsyncLocalStorage();

/**
 * @param {{ private?: boolean, res?: import('express').Response }} [initial]
 * @returns {RequestContext}
 */
export function createRequestContext(initial = {}) {
  return {
    private: initial.private === true,
    tainted: false,
    taintReasons: [],
    csrfToken: null,
    res: initial.res ?? null,
  };
}

/**
 * İsteği verilen bağlam içinde çalıştırır.
 *
 * @template T
 * @param {RequestContext} context
 * @param {() => T} run
 * @returns {T}
 */
export function withRequestContext(context, run) {
  return storage.run(context, run);
}

/**
 * @returns {RequestContext | undefined}
 */
export function getRequestContext() {
  return storage.getStore();
}

/**
 * Çıktının kullanıcıya bağlı olduğunu bildirir. Bağlam yoksa (script, build,
 * fragment dışı kullanım) sessizce yok sayılır.
 *
 * @param {string} reason Teşhis mesajında görünecek erişim adı.
 */
export function markTainted(reason) {
  const context = storage.getStore();
  if (!context) return;

  context.tainted = true;
  if (!context.taintReasons.includes(reason)) {
    context.taintReasons.push(reason);
  }
}


/** Okunması çıktıyı kullanıcıya bağlayan başlıklar. */
const SENSITIVE_HEADERS = new Set([
  "cookie",
  "authorization",
  "proxy-authorization",
]);

/** Okunması çıktıyı kullanıcıya bağlayan `req` alanları. */
const SENSITIVE_PROPS = new Set(["cookies", "signedCookies", "session", "user"]);

/**
 * @param {Record<string, unknown>} headers
 * @returns {Record<string, unknown>}
 */
function guardHeaders(headers) {
  return new Proxy(headers, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && SENSITIVE_HEADERS.has(prop.toLowerCase())) {
        markTainted(`req.headers.${prop}`);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Controller'a giden `req`'i kimliğe dokunan erişimleri işaretleyen bir Proxy
 * ile sarar.
 *
 * Neden gerekli: HTML cache anahtarı yalnızca yol + query. Cookie okuyan bir
 * controller cache'lenebilir bir route'a bağlanmışsa bir kullanıcının HTML'i
 * bir başkasına servis edilir ve bu hiçbir yerde hata olarak görünmez.
 * İşaretleme, sessiz sızıntıyı gürültülü bir uyarıya çeviriyor.
 *
 * Kapsam bilinçli olarak dar: yalnızca *okuma* yakalanır, yazma ve metot
 * çağrıları hedefe dokunulmadan geçer. Proxy'nin prototipi korunduğu için
 * `req instanceof IncomingMessage` gibi kontroller etkilenmez.
 *
 * @param {import('express').Request} req
 * @returns {import('express').Request}
 */
export function guardRequest(req) {
  /** @type {Record<string, unknown> | null} */
  let headersProxy = null;

  return new Proxy(req, {
    get(target, prop, receiver) {
      if (prop === "headers" || prop === "headersDistinct") {
        const raw = Reflect.get(target, prop, receiver);
        if (!raw || typeof raw !== "object") return raw;
        if (prop === "headers") {
          headersProxy ??= guardHeaders(/** @type {Record<string, unknown>} */ (raw));
          return headersProxy;
        }
        return guardHeaders(/** @type {Record<string, unknown>} */ (raw));
      }

      if (prop === "get" || prop === "header") {
        const original = Reflect.get(target, prop, receiver);
        if (typeof original !== "function") return original;
        return function guardedHeaderLookup(/** @type {string} */ name) {
          if (typeof name === "string" && SENSITIVE_HEADERS.has(name.toLowerCase())) {
            markTainted(`req.get("${name}")`);
          }
          return original.call(target, name);
        };
      }

      if (typeof prop === "string" && SENSITIVE_PROPS.has(prop)) {
        markTainted(`req.${prop}`);
      }

      const value = Reflect.get(target, prop, receiver);
      // Express metotları kendi iç alanlarına `this` üzerinden erişiyor;
      // proxy'yi receiver olarak bırakmak bu erişimleri de yakalayıp
      // gereksiz işaretlemeye yol açar.
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
