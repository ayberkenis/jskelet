/**
 * Tarayıcıda paylaşımlı cookie yazma + read-back.
 *
 * `document.cookie` ile Domain=.example.com yazmak bazı tarayıcılarda
 * (Public Suffix, ITP) sessizce başarısız olur. Yazımdan sonra okunamazsa
 * `{ handoff: true }` döner — çağıran `createHandoffUrl` veya
 * `handoffViaWindowName` kullanır.
 *
 * `roots` verilmezse `document.documentElement.dataset.jskeletCookieRoots`
 * (virgülle ayrılmış) okunur; layout'ta
 * `data-jskelet-cookie-roots=".investvio.com,.localhost"` basılabilir.
 */
import {
  SHARED_COOKIE_WARN_BYTES,
  resolveSharedCookieDomain,
} from "../shared/cookie-domain.js";

export {
  SHARED_COOKIE_WARN_BYTES,
  resolveSharedCookieDomain,
  stripHostPort,
} from "../shared/cookie-domain.js";

/**
 * @returns {string[]}
 */
function rootsFromDom() {
  if (typeof document === "undefined") return [];
  const raw = document.documentElement?.dataset?.jskeletCookieRoots ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * @param {string} name
 * @returns {string | null}
 */
export function readCookie(name) {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(trimmed.slice(prefix.length));
    } catch {
      return trimmed.slice(prefix.length);
    }
  }
  return null;
}

/**
 * @typedef {object} ClientSharedCookieResult
 * @property {boolean} ok
 * @property {string | null} domain
 * @property {boolean} handoff
 * @property {string} [reason]
 */

/**
 * @param {string} name
 * @param {string} value
 * @param {{ roots?: string[], maxAge?: number, path?: string, sameSite?: string,
 *   secure?: boolean }} [options]
 * @returns {ClientSharedCookieResult}
 */
export function writeSharedCookie(name, value, options = {}) {
  if (typeof document === "undefined") {
    return { ok: false, domain: null, handoff: true, reason: "no-document" };
  }

  const roots = options.roots ?? rootsFromDom();
  const domain = resolveSharedCookieDomain(location.hostname, roots);
  if (!domain) {
    return { ok: false, domain: null, handoff: true, reason: "no-matching-root" };
  }

  const text = String(value ?? "");
  if (new TextEncoder().encode(text).length > SHARED_COOKIE_WARN_BYTES) {
    return { ok: false, domain, handoff: true, reason: "value-too-large" };
  }

  const secure = options.secure ?? location.protocol === "https:";
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(text)}`,
    `Path=${options.path ?? "/"}`,
    `Domain=${domain}`,
    `SameSite=${options.sameSite ?? "Lax"}`,
  ];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(Number(options.maxAge))}`);
  }
  if (secure) parts.push("Secure");

  document.cookie = parts.join("; ");

  // Read-back: tarayıcı Domain'i reddettiyse cookie görünmez.
  if (readCookie(name) !== text) {
    return { ok: false, domain, handoff: true, reason: "readback-failed" };
  }

  return { ok: true, domain, handoff: false };
}

/**
 * @param {string} name
 * @param {{ roots?: string[], path?: string, secure?: boolean, sameSite?: string }} [options]
 * @returns {ClientSharedCookieResult}
 */
export function clearSharedCookie(name, options = {}) {
  if (typeof document === "undefined") {
    return { ok: false, domain: null, handoff: false, reason: "no-document" };
  }

  const roots = options.roots ?? rootsFromDom();
  const domain = resolveSharedCookieDomain(location.hostname, roots);
  if (!domain) {
    return { ok: false, domain: null, handoff: false, reason: "no-matching-root" };
  }

  const secure = options.secure ?? location.protocol === "https:";
  const parts = [
    `${encodeURIComponent(name)}=`,
    `Path=${options.path ?? "/"}`,
    `Domain=${domain}`,
    "Max-Age=0",
    `SameSite=${options.sameSite ?? "Lax"}`,
  ];
  if (secure) parts.push("Secure");
  document.cookie = parts.join("; ");

  return { ok: true, domain, handoff: false };
}

/**
 * Handoff bileti ister; dönen URL'ye gidilir (`?handoff=` taşır).
 *
 * @param {{ name: string, value: string, next: string }} body
 * @param {{ path?: string }} [options]
 * @returns {Promise<string | null>}
 */
export async function createHandoffUrl(body, options = {}) {
  const path = options.path ?? "/_jskelet/auth/handoff";
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });

  if (!response.ok) return null;
  /** @type {{ ok?: boolean, url?: string }} */
  const data = await response.json().catch(() => ({}));
  return typeof data.url === "string" ? data.url : null;
}

/**
 * first-party `window.name` köprüsü — cookie Domain reddedilince yedek.
 * Kaynak sayfada hedefe gitmeden önce çağırın; hedefte
 * `consumeWindowNameHandoff` okur.
 *
 * @param {string} targetUrl
 * @param {{ name: string, value: string, maxAge?: number }} cookie
 * @returns {void}
 */
export function handoffViaWindowName(targetUrl, cookie) {
  if (typeof window === "undefined") return;
  window.name = JSON.stringify({
    jskeletHandoff: 1,
    cookie: {
      name: cookie.name,
      value: cookie.value,
      maxAge: cookie.maxAge,
    },
  });
  location.assign(targetUrl);
}

/**
 * Hedef host'ta `window.name` içindeki handoff'u host-only cookie olarak yazar.
 *
 * @param {{ write?: typeof writeSharedCookie }} [options]
 *   Varsayılan: Domain denemeden host-only `document.cookie`.
 * @returns {boolean} Bir şey yazıldı mı.
 */
export function consumeWindowNameHandoff(options = {}) {
  if (typeof window === "undefined") return false;

  let payload;
  try {
    payload = JSON.parse(window.name || "");
  } catch {
    return false;
  }

  if (!payload || payload.jskeletHandoff !== 1 || !payload.cookie?.name) {
    return false;
  }

  window.name = "";

  const { name, value, maxAge } = payload.cookie;
  const text = String(value ?? "");
  const secure = location.protocol === "https:";
  const parts = [
    `${encodeURIComponent(name)}=${encodeURIComponent(text)}`,
    "Path=/",
    "SameSite=Lax",
  ];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(Number(maxAge))}`);
  if (secure) parts.push("Secure");
  document.cookie = parts.join("; ");

  if (typeof options.write === "function") {
    options.write(name, text, { maxAge });
  }

  return readCookie(name) === text;
}
