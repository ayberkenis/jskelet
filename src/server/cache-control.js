/**
 * Tarayıcıya `max-age=0`, edge'e `CDN-Cache-Control`.
 *
 * `s-maxage` yazılmaz: Cloudflare `max-age=0` ile birlikte görünce nesneyi
 * EXPIRED sayar. `must-revalidate`, `proxy-revalidate` ve `no-cache` aynı
 * yanıtta stale penceresini keser; burada üretilmez. `s-maxage`'e dönen bir
 * anahtar da yok — o mod aynı EXPIRED sonucunu geri getirir.
 *
 * Süreç içi HTML cache (`X-JSkelet-Cache: STALE`) ayrı katmandır; bu modül
 * ona dokunmaz. Görsel optimizer kendi `max-age` + `stale-while-revalidate`
 * yolunu kullanır.
 */

/** Tarayıcı kopyası tutulmaz; taze pencere edge başlığındadır. */
const BROWSER_CACHE = "public, max-age=0";

/**
 * @param {number} maxAge Edge'in taze penceresi (saniye). HTML'de route TTL.
 * @param {number} staleWhileRevalidate Taze pencere bitince eski kopyanın
 *   sunulacağı süre. 0 ise direktif basılmaz.
 * @returns {{ cacheControl: string, cdnCacheControl: string }}
 */
export function edgeCacheControl(maxAge, staleWhileRevalidate) {
  /** @type {string[]} */
  const directives = [`max-age=${maxAge}`];
  if (staleWhileRevalidate > 0) {
    directives.push(`stale-while-revalidate=${staleWhileRevalidate}`);
  }

  return {
    cacheControl: BROWSER_CACHE,
    cdnCacheControl: directives.join(", "),
  };
}

/**
 * @param {import('express').Response} res
 * @param {number} maxAge
 * @param {number} staleWhileRevalidate
 */
export function setEdgeCacheHeaders(res, maxAge, staleWhileRevalidate) {
  const headers = edgeCacheControl(maxAge, staleWhileRevalidate);
  res.setHeader("Cache-Control", headers.cacheControl);
  res.setHeader("CDN-Cache-Control", headers.cdnCacheControl);
}
