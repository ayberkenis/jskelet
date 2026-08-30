/**
 * Cookie okuma/yazma ve HMAC ile imzalama.
 *
 * Neden framework'te: kişiye özel her sayfa bir oturum cookie'sine dayanıyor
 * ve bunu elle yazan her proje aynı üç hatayı tekrar ediyor — `HttpOnly`
 * unutmak, imzasız değere güvenmek, karşılaştırmayı `===` ile yapmak.
 * Burada varsayılanlar güvenli tarafta ve imza doğrulaması sabit zamanlı.
 *
 * Framework **kimlik sağlamaz**: oturumun içinde ne olduğu, ne kadar
 * yaşadığı ve kimin verdiği uygulamanın kararı. Buradaki yüzey yalnızca
 * "bu değeri ben yazdım, kurcalanmamış" garantisini veriyor.
 *
 * Bağımlılık eklenmez; `node:crypto` yeterli.
 */
import crypto from "node:crypto";
import process from "node:process";
import { getConfig } from "../config/index.js";
import { markTainted } from "./request-context.js";

/** Ayrıştırılmış cookie'ler istek başına bir kez hesaplanır. */
const PARSED = Symbol("jskelet.cookies");

/**
 * @param {string} value
 * @returns {string}
 */
function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function fromBase64url(value) {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/**
 * İmza sırrı. `security.cookieSecret` ya da `JSKELET_SECRET`.
 *
 * Yokluğunda imzasız cookie yazmak en kötü sonuç olurdu: uygulama kendini
 * güvende sanar, değer kurcalanabilir. Bu yüzden imzalı API sır olmadan
 * hata verir — config hatasının siteyi düşürmemesi kuralı burada geçmez,
 * çünkü sessiz alternatif bir güvenlik açığı.
 *
 * @returns {string}
 */
function getSecret() {
  /** @type {string | null} */
  let configured = null;

  try {
    configured = getConfig().security.cookieSecret;
  } catch {
    // Config yüklenmemiş olabilir (script, test); env yine de geçerli.
    configured = null;
  }

  const secret = configured ?? process.env.JSKELET_SECRET ?? null;

  if (!secret) {
    throw new Error(
      "[cookies] a secret is required for signed cookies. Set " +
        "`security.cookieSecret` in `jskelet.config.mjs` or the JSKELET_SECRET environment variable.",
    );
  }

  return secret;
}

/**
 * @param {string} value
 * @returns {string}
 */
function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

/**
 * Sabit zamanlı karşılaştırma: imza doğrulamasında erken çıkış, saldırganın
 * baytları tek tek tahmin etmesine kapı aralar.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * `Cookie` başlığını ayrıştırır.
 *
 * Okuma çıktının kullanıcıya bağlı olduğunu bildirir: bu sayfa artık public
 * HTML cache'ine yazılamaz.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Record<string, string>}
 */
export function parseCookies(req) {
  markTainted("parseCookies(req)");

  const cached = /** @type {any} */ (req)[PARSED];
  if (cached) return cached;

  /** @type {Record<string, string>} */
  const out = {};
  const header = req.headers?.cookie;

  if (header) {
    for (const part of header.split(";")) {
      const index = part.indexOf("=");
      if (index === -1) continue;

      const name = part.slice(0, index).trim();
      if (!name) continue;

      try {
        out[name] = decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        // Bozuk yüzde kodlaması tüm başlığı çöpe atmamalı.
        out[name] = part.slice(index + 1).trim();
      }
    }
  }

  /** @type {any} */ (req)[PARSED] = out;
  return out;
}

/**
 * @typedef {object} CookieOptions
 * @property {string} [path] Varsayılan `/`.
 * @property {string} [domain]
 * @property {number} [maxAge] Saniye.
 * @property {Date} [expires]
 * @property {boolean} [httpOnly] Varsayılan `true`.
 * @property {boolean} [secure] Varsayılan: development dışında `true`.
 * @property {"Strict" | "Lax" | "None"} [sameSite] Varsayılan `Lax`.
 */

/**
 * Varsayılanlar bilinçli olarak kısıtlayıcı: `HttpOnly` ile JS okuyamaz,
 * `SameSite=Lax` ile çapraz site POST'larında gönderilmez (CSRF'nin büyük
 * kısmını kapatan tek satır), `Secure` üretimde açık.
 *
 * @param {string} name
 * @param {string} value
 * @param {CookieOptions} [options]
 * @returns {string}
 */
export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  parts.push(`Path=${options.path ?? "/"}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure ?? process.env.NODE_ENV !== "development") parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);

  return parts.join("; ");
}

/**
 * @param {import('http').ServerResponse} res
 * @param {string} name
 * @param {string} value
 * @param {CookieOptions} [options]
 */
export function setCookie(res, name, value, options = {}) {
  const existing = res.getHeader("Set-Cookie");
  const serialized = serializeCookie(name, value, options);

  /** @type {string[]} */
  const all = existing
    ? Array.isArray(existing)
      ? [...existing.map(String)]
      : [String(existing)]
    : [];

  all.push(serialized);
  res.setHeader("Set-Cookie", all);
}

/**
 * @param {import('http').ServerResponse} res
 * @param {string} name
 * @param {CookieOptions} [options]
 */
export function clearCookie(res, name, options = {}) {
  setCookie(res, name, "", { ...options, maxAge: 0, expires: new Date(0) });
}

/**
 * İmzalı cookie yazar. Değer okunabilir kalır (şifreleme değil, imza);
 * gizli kalması gereken veriyi cookie'ye koymayın, kimliğini koyun.
 *
 * @param {import('http').ServerResponse} res
 * @param {string} name
 * @param {string} value
 * @param {CookieOptions} [options]
 */
export function setSignedCookie(res, name, value, options = {}) {
  const encoded = base64url(value);
  setCookie(res, name, `${encoded}.${sign(encoded)}`, options);
}

/**
 * İmzalı cookie okur. İmza uymuyorsa `null` — bozuk imza, yok sayılmalı,
 * "belki geçerlidir" diye kullanılmamalı.
 *
 * @param {import('http').IncomingMessage} req
 * @param {string} name
 * @returns {string | null}
 */
export function getSignedCookie(req, name) {
  const raw = parseCookies(req)[name];
  if (!raw) return null;

  const index = raw.lastIndexOf(".");
  if (index <= 0) return null;

  const encoded = raw.slice(0, index);
  const signature = raw.slice(index + 1);

  let expected;
  try {
    expected = sign(encoded);
  } catch {
    // Sır yoksa imzalı okuma sessizce başarısız olur: sunucu ayakta kalır
    // ama hiçbir oturum geçerli sayılmaz.
    return null;
  }

  if (!safeEqual(signature, expected)) return null;
  return fromBase64url(encoded);
}

/**
 * Kriptografik rastgele token. CSRF token'ı ve oturum kimliği için.
 *
 * @param {number} [bytes]
 * @returns {string}
 */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}
