/**
 * `jskelet.config.mjs` → `trailingSlash` uygulayıcısı.
 *
 * Açıkken kanonik URL `/` ile biter: `/hakkinda/` 200 döner, slash'sız
 * istek 308 ile slash'lıya gider. 301 değil 308 — framework'ün diğer kalıcı
 * yönlendirmeleri gibi metodu korur ve eski istemcilerin POST'u GET'e
 * çevirmesini engeller.
 *
 * Kapalıyken (varsayılan) hiçbir şey yapmaz: mevcut sitelerin `/x` ve `/x/`
 * biçimlerini kırmaz.
 *
 * İstisnalar Next ile aynı: uzantılı dosya yolları ve `/.well-known/`.
 * Kök `/` zaten slash ile biter.
 */
import { getConfig } from "../../config/index.js";

/**
 * Bu yola trailing slash dayatılmamalı mı.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function skipTrailingSlash(pathname) {
  if (!pathname || pathname === "/") return true;
  if (pathname.startsWith("/.well-known")) return true;

  // Son segmentte nokta varsa statik dosya sayılır (`/a.b/c` değil,
  // `/foto.png` ve `/assets/app.js` gibi).
  const lastSlash = pathname.lastIndexOf("/");
  const lastSegment = pathname.slice(lastSlash + 1);
  return lastSegment.includes(".");
}

/**
 * @returns {import('express').RequestHandler}
 */
export function trailingSlash() {
  if (!getConfig().trailingSlash) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const pathname = req.path ?? "";
    if (pathname.endsWith("/") || skipTrailingSlash(pathname)) {
      next();
      return;
    }

    // Query string `originalUrl`'den: `req.path` onu düşürür.
    const query = req.originalUrl.slice(pathname.length);
    res.redirect(308, `${pathname}/${query}`);
  };
}
