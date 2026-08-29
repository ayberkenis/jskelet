/**
 * `jskelet.config.mjs` → `redirects()` uygulayıcısı.
 *
 * İlk eşleşen kural kazanır, sonrası denenmez — sıralama config'teki yazım
 * sırasıdır. Query string korunur: `/eski?utm=x` → `/yeni?utm=x`, çünkü
 * yönlendirme kampanya parametrelerini düşürürse trafik kaynağı kaybolur.
 */
import { getConfig } from "../../config/index.js";
import { fillDestination, matchPattern } from "../../config/pattern.js";

/** @returns {import('express').RequestHandler} */
export function redirects() {
  const rules = getConfig().redirects;
  if (!rules.length) return (req, res, next) => next();

  return (req, res, next) => {
    const query = req.originalUrl.slice(req.path.length);

    for (const rule of rules) {
      const params = matchPattern(rule.pattern, req.path);
      if (!params) continue;

      res.redirect(
        rule.statusCode,
        `${fillDestination(rule.destination, params)}${query}`,
      );
      return;
    }

    next();
  };
}
