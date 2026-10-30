/**
 * HTML cache anahtarına host / header / stylesheet hash / özel fn ile sabit
 * vary parçası ekler.
 *
 * CDN zaten tam URL ile ayırır; asıl risk origin L1 ve Redis HTML anahtarı —
 * host'tan locale üreten sitelerde `vary.host: true` olmadan ilk locale'in
 * HTML'i diğer host'a servis edilir. `vary.assets` (varsayılan açık) CSS
 * içerik hash'ini anahtara yazar: hash değişince eski kayıt bulunmaz, Redis
 * zaman aşımında stale HTML geri gelmez.
 */
import { getConfig } from "../config/index.js";
import { getStylesheetHash } from "./assets.js";

/**
 * Public Host: `x-forwarded-host` (ilk değer) yoksa `Host`. Lowercase, portsuz.
 * IPv6 (`[::1]:3000`) köşeli parantezleri korur.
 *
 * @param {{ headers?: Record<string, unknown>, get?: (name: string) => string | undefined }} req
 * @returns {string}
 */
export function publicHost(req) {
  const forwarded = headerValue(req, "x-forwarded-host");
  const raw = forwarded || headerValue(req, "host") || "";
  const first = raw.split(",")[0].trim().toLowerCase();
  return stripPort(first);
}

/**
 * @param {string} host
 * @returns {string}
 */
function stripPort(host) {
  if (!host) return "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  // Birden fazla `:` → portsuz IPv6 (Host'ta nadir); tek `:` → host:port.
  const colon = host.lastIndexOf(":");
  if (colon === -1) return host;
  if (host.indexOf(":") !== colon) return host;
  return host.slice(0, colon);
}

/**
 * @param {{ headers?: Record<string, unknown>, get?: (name: string) => string | undefined }} req
 * @param {string} name
 * @returns {string}
 */
function headerValue(req, name) {
  const viaGet = req.get?.(name);
  if (typeof viaGet === "string" && viaGet) return viaGet;

  const raw = req.headers?.[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ? String(raw[0]) : "";
  if (raw == null) return "";
  return String(raw);
}

/**
 * Anahtarın başına eklenen önek: `h=tr.example.com|`,
 * `h=…&x-locale=tr|` veya `h=…&a=<cssHash>|`. Vary yoksa boş string.
 *
 * Stylesheet hash'i istekten bağımsızdır; `req` olmasa da `vary.assets`
 * açıksa yazılır. Host / header / fn `req` ister.
 *
 * @param {{ headers?: Record<string, unknown>, get?: (name: string) => string | undefined }} [req]
 * @returns {string}
 */
export function buildVaryPrefix(req) {
  let vary;
  try {
    vary = getConfig().cacheVary;
  } catch {
    return "";
  }

  const assetsOn = vary?.assets !== false;
  if (
    !vary ||
    (!vary.host && !vary.headers.length && !vary.fn && !assetsOn)
  ) {
    return "";
  }

  /** @type {string[]} */
  const parts = [];

  if (req && vary.host) {
    const host = publicHost(req);
    if (host) parts.push(`h=${host}`);
  }

  if (req) {
    for (const name of vary.headers) {
      const value = headerValue(req, name).trim();
      if (value) parts.push(`${name}=${value}`);
    }

    if (typeof vary.fn === "function") {
      try {
        const custom = vary.fn(/** @type {import('express').Request} */ (req));
        if (custom != null && custom !== "") parts.push(String(custom));
      } catch (error) {
        console.warn("[cache] cache().vary.fn threw, ignoring it", error);
      }
    }
  }

  // İstekten bağımsız sürüm damgası. Redis DEL zaman aşımında eski HTML
  // aynı anahtarda kalırdı; `a=` değişince bakılan kayıt başkadır.
  if (assetsOn) {
    const hash = getStylesheetHash();
    if (hash) parts.push(`a=${hash}`);
  }

  return parts.length ? `${parts.join("&")}|` : "";
}

/**
 * Anahtardan yol kısmını çıkarır (`[vary|]yol?query` → `yol`).
 * Invalidation hedefleri `/…` ile başlar; vary öneki eşleşmeye karışmamalı.
 *
 * @param {string} key
 * @returns {string}
 */
export function pathOfCacheKey(key) {
  const mark = key.indexOf("?");
  const beforeQuery = mark === -1 ? key : key.slice(0, mark);
  const sep = beforeQuery.indexOf("|/");
  if (sep !== -1) return beforeQuery.slice(sep + 1);
  return beforeQuery;
}
