/**
 * Alt alan adları arasında paylaşılan cookie yazma.
 *
 * `Secure` protokole bakılır (`https` / `x-forwarded-proto`), `NODE_ENV`'e değil —
 * yerel https veya prod http yanlış bayrak üretmesin.
 *
 * Domain `brand.sharedCookieRoots` ile seçilir. Eşleşme yoksa ya da değer çok
 * büyükse `{ ok: false, handoff: true }` döner; çağıran handoff yoluna düşer.
 *
 * JWT'yi paylaşımlı cookie'ye koymayın: kısa session id koyun.
 */
import { getConfig } from "../config/index.js";
import {
  SHARED_COOKIE_WARN_BYTES,
  resolveSharedCookieDomain,
  stripHostPort,
} from "../shared/cookie-domain.js";
import { clearCookie, setCookie } from "./cookies.js";

export {
  SHARED_COOKIE_WARN_BYTES,
  resolveSharedCookieDomain,
  stripHostPort,
} from "../shared/cookie-domain.js";

/**
 * @param {{ secure?: boolean, protocol?: string,
 *   headers?: Record<string, unknown>, get?: (name: string) => string | undefined }} [req]
 * @returns {boolean}
 */
export function requestIsHttps(req) {
  if (!req) return false;
  if (req.secure === true) return true;
  if (typeof req.protocol === "string" && req.protocol === "https") return true;

  const forwarded =
    req.get?.("x-forwarded-proto") ??
    (typeof req.headers?.["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"]
      : Array.isArray(req.headers?.["x-forwarded-proto"])
        ? req.headers["x-forwarded-proto"][0]
        : "");
  const first = String(forwarded ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return first === "https";
}

/**
 * @param {{ headers?: Record<string, unknown>, get?: (name: string) => string | undefined,
 *   hostname?: string }} [req]
 * @returns {string}
 */
function hostFromReq(req) {
  if (!req) return "";
  const forwarded =
    req.get?.("x-forwarded-host") ??
    (typeof req.headers?.["x-forwarded-host"] === "string"
      ? req.headers["x-forwarded-host"]
      : "");
  const raw =
    forwarded ||
    req.get?.("host") ||
    (typeof req.headers?.host === "string" ? req.headers.host : "") ||
    (typeof req.hostname === "string" ? req.hostname : "");
  return stripHostPort(String(raw).split(",")[0]);
}

/**
 * @returns {string[]}
 */
function configuredRoots() {
  try {
    const roots = getConfig().brand?.sharedCookieRoots;
    return Array.isArray(roots) ? roots.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * @typedef {import('./cookies.js').CookieOptions} CookieOptions
 *
 * @typedef {object} SharedCookieResult
 * @property {boolean} ok Domain seçildi ve Set-Cookie yazıldı.
 * @property {string | null} domain Yazılan Domain ya da null.
 * @property {boolean} handoff ok değilse çağıran handoff denemeli.
 * @property {string} [reason] Teşhis.
 */

/**
 * Paylaşımlı Domain ile cookie yazar.
 *
 * @param {import('http').ServerResponse & { req?: import('http').IncomingMessage }} res
 * @param {string} name
 * @param {string} value Kısa session id — JWT değil.
 * @param {CookieOptions & { req?: import('http').IncomingMessage, roots?: string[],
 *   host?: string }} [options]
 * @returns {SharedCookieResult}
 */
export function writeSharedCookie(res, name, value, options = {}) {
  const { req: optReq, roots: optRoots, host: optHost, ...cookieOpts } = options;
  const req = optReq ?? /** @type {{ req?: import('http').IncomingMessage }} */ (res).req;
  const roots = optRoots ?? configuredRoots();
  const host = optHost ? stripHostPort(optHost) : hostFromReq(req);
  const domain = resolveSharedCookieDomain(host, roots);

  if (!domain) {
    return {
      ok: false,
      domain: null,
      handoff: true,
      reason: "no-matching-root",
    };
  }

  const text = String(value ?? "");
  if (Buffer.byteLength(text, "utf8") > SHARED_COOKIE_WARN_BYTES) {
    console.warn(
      `[cookies] shared cookie "${name}" is ${Buffer.byteLength(text, "utf8")} bytes; ` +
        `prefer a short session id (≤${SHARED_COOKIE_WARN_BYTES}). Large tokens do not belong in shared cookies.`,
    );
    return {
      ok: false,
      domain,
      handoff: true,
      reason: "value-too-large",
    };
  }

  const secure = cookieOpts.secure ?? requestIsHttps(req);

  setCookie(res, name, text, {
    ...cookieOpts,
    domain,
    secure,
    // Paylaşımlı oturum kimliği JS'ye gerekmez; HttpOnly kalsın.
    httpOnly: cookieOpts.httpOnly !== false,
    sameSite: cookieOpts.sameSite ?? "Lax",
    path: cookieOpts.path ?? "/",
  });

  // Sunucuda document.cookie read-back yok; Domain seçildiyse yazım başarılı sayılır.
  // İstemci `writeSharedCookie` read-back yapar; başarısızsa handoff'a düşer.
  return { ok: true, domain, handoff: false };
}

/**
 * Aynı Domain ile cookie siler.
 *
 * @param {import('http').ServerResponse & { req?: import('http').IncomingMessage }} res
 * @param {string} name
 * @param {CookieOptions & { req?: import('http').IncomingMessage, roots?: string[],
 *   host?: string }} [options]
 * @returns {SharedCookieResult}
 */
export function clearSharedCookie(res, name, options = {}) {
  const { req: optReq, roots: optRoots, host: optHost, ...cookieOpts } = options;
  const req = optReq ?? /** @type {{ req?: import('http').IncomingMessage }} */ (res).req;
  const roots = optRoots ?? configuredRoots();
  const host = optHost ? stripHostPort(optHost) : hostFromReq(req);
  const domain = resolveSharedCookieDomain(host, roots);

  if (!domain) {
    return { ok: false, domain: null, handoff: false, reason: "no-matching-root" };
  }

  const secure = cookieOpts.secure ?? requestIsHttps(req);
  clearCookie(res, name, {
    ...cookieOpts,
    domain,
    secure,
    path: cookieOpts.path ?? "/",
  });

  return { ok: true, domain, handoff: false };
}
