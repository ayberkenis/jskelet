/**
 * `jskelet.config.mjs` → `headers()` uygulayıcısı.
 *
 * İki katman var. Framework yalnızca statik dosyalara uzun ömürlü cache
 * yazar — bu, hash'li çıktı için her projede doğru olan tek varsayılan.
 * Bunun dışındaki her başlık (CSP, COOP, HSTS, X-Frame-Options…) config'ten
 * gelir ve varsayılanların üstüne biner: aynı başlığı yeniden tanımlarsan
 * config kazanır.
 */
import { getConfig } from "../../config/index.js";
import { matchPattern } from "../../config/pattern.js";
import { IMMUTABLE_CACHE } from "../../config/defaults.js";

/** @returns {import('express').RequestHandler} */
export function headersMiddleware() {
  const { static: staticRules, headers: rules } = getConfig();

  return (req, res, next) => {
    const pathname = req.path ?? "";
    const dot = pathname.lastIndexOf(".");
    const ext = dot === -1 ? "" : pathname.slice(dot).toLowerCase();

    if (
      staticRules.extensions.has(ext) ||
      staticRules.prefixes.some((prefix) => pathname.startsWith(prefix))
    ) {
      res.setHeader("Cache-Control", IMMUTABLE_CACHE);
    }

    for (const rule of rules) {
      if (!matchPattern(rule.pattern, pathname)) continue;
      for (const { key, value } of rule.headers) res.setHeader(key, value);
    }

    next();
  };
}
