/**
 * CSRF koruması.
 *
 * Bu yüzey framework'e ait, çünkü gövdeyi ayrıştıran o: `create-app.js`
 * `express.urlencoded` ve `express.json` kuruyor, yani state değiştiren
 * istekleri kabul eden katman framework. Cookie ile kimlik doğrulayan bir
 * uygulama bu koruma olmadan açık.
 *
 * İki katman:
 *
 * 1. **Origin kontrolü** (varsayılan açık). `Origin` ya da
 *    `Sec-Fetch-Site` başlığı çapraz site olduğunu gösteriyorsa istek
 *    reddedilir. Başlıkların **hiçbiri yoksa geçer**: tarayıcılar çapraz
 *    origin bir POST'ta `Origin`'i her zaman gönderir, buna karşılık
 *    webhook'lar ve sunucudan sunucuya çağrılar hiç göndermez. Bu ayrım,
 *    korumayı açık bırakırken entegrasyonları bozmamayı sağlıyor.
 *
 * 2. **Çift gönderim token'ı** (`security.csrf.token` ile açılır). Cookie'deki
 *    imzalı token ile form alanı/başlıktaki değer karşılaştırılır. `Origin`
 *    göndermeyen eski tarayıcılar için ikinci katman; formlara `csrfField()`
 *    eklenmesini gerektirdiği için varsayılan kapalı.
 *
 * Token'ı bu middleware **üretmez**, yalnızca doğrular. Üretim `csrfField()`
 * içinde, yani gerçekten bir forma basıldığı anda olur. Sebebi somut: token
 * her yanıtta yazılsaydı public ve cache'lenebilir bir sayfa da `Set-Cookie`
 * taşırdı, bir CDN o yanıtı saklardı ve tüm ziyaretçiler aynı token'ı
 * paylaşırdı — çift gönderim kontrolü tam olarak o noktada anlamını yitirir.
 */
import { getConfig } from "../../config/index.js";
import { matchPattern } from "../../config/pattern.js";
import { getSignedCookie, safeEqual } from "../../http/cookies.js";

/** Gövdesi olmayan, yan etkisi beklenmeyen metotlar. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * İsteğin geldiği origin'in kendi origin'imiz olup olmadığını söyler.
 *
 * `trust proxy` kapalıysa `req.protocol` her zaman `http` döner ve HTTPS
 * arkasında her istek çapraz site sanılır; bu yüzden karşılaştırma yalnızca
 * host üzerinden yapılır, protokol değil.
 *
 * @param {import('express').Request} req
 * @param {string[]} allowedOrigins
 * @returns {boolean}
 */
function isSameOrigin(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin || origin === "null") return false;

  if (allowedOrigins.includes(origin)) return true;

  try {
    const host = req.headers.host;
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * @returns {import('express').RequestHandler}
 */
export function csrf() {
  const { security } = getConfig();
  const { csrf: options } = security;

  return (req, res, next) => {
    if (!options.enabled) {
      next();
      return;
    }

    const pathname = req.path ?? "";
    if (options.exclude.some((pattern) => matchPattern(pattern, pathname))) {
      next();
      return;
    }

    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const site = String(req.headers["sec-fetch-site"] ?? "");
    const hasOrigin = Boolean(req.headers.origin);

    // Yalnızca çapraz site olduğu **belli** olan istekler reddedilir.
    if (site === "cross-site" || (hasOrigin && !isSameOrigin(req, options.allowedOrigins))) {
      reject(req, res, "origin mismatch");
      return;
    }

    if (options.token) {
      // Cookie yoksa istek zaten token basan bir formdan gelmiyor.
      const expected = getSignedCookie(req, options.cookieName);
      const provided =
        firstString(/** @type {any} */ (req.body)?.[options.fieldName]) ??
        firstString(req.headers[options.headerName]);

      if (!expected || !provided || !safeEqual(provided, expected)) {
        reject(req, res, "token mismatch");
        return;
      }
    }

    next();
  };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function firstString(value) {
  if (typeof value === "string" && value) return value;
  if (Array.isArray(value)) return firstString(value[0]);
  return null;
}

/**
 * Reddedilen istek HTML sayfası değil düz metin döner: bu bir kullanıcı
 * hatası değil, ya bir saldırı ya da bir programlama hatası — ve fragment
 * takasında bir hata sayfasının içine düşmemeli.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} reason
 */
function reject(req, res, reason) {
  console.warn(`[csrf] ${req.method} ${req.originalUrl} rejected — ${reason}`);
  res.status(403).setHeader("Cache-Control", "no-store");
  res.type("text/plain").send("Forbidden");
}
