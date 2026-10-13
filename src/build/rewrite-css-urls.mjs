/**
 * CDN prefix varken CSS `url(/fonts/…)` yollarını upload path'iyle hizalar.
 *
 * CDN'deki `app.css` kök-mutlak `/fonts/x.woff2` görünce tarayıcı bunu
 * `https://cdn.example.com/fonts/x` diye çözer — `keyPrefix` (`/js` vb.)
 * kaybolur ve 403 gelir. Prefix + aynı göreli yol (`…/js/fonts/x`) doğru
 * nesneye gider; font ile CSS aynı host'ta olduğu için `@font-face` CORS
 * istemez. HTML'den CDN font yüklemek ayrı: bucket/CloudFront CORS gerekir.
 */
import { applyAssetPrefix } from "../server/assets.js";

/**
 * @param {string} css
 * @param {{ prefix: string, prefixes?: string[] }} options
 * @returns {string}
 */
export function rewriteCssStaticUrls(css, { prefix, prefixes = [] }) {
  if (!prefix || !css) return css;

  const roots = [...prefixes]
    .filter((entry) => typeof entry === "string" && entry.startsWith("/"))
    .map((entry) => (entry.endsWith("/") ? entry : `${entry}/`))
    .sort((a, b) => b.length - a.length);

  if (!roots.length) return css;

  return css.replace(
    /url\(\s*(['"]?)(\/[^)"'\s]+)\1\s*\)/gi,
    (match, quote, urlPath) => {
      const pathOnly = urlPath.split(/[?#]/, 1)[0];
      if (!roots.some((root) => pathOnly === root.slice(0, -1) || pathOnly.startsWith(root))) {
        return match;
      }

      const rewritten = applyAssetPrefix(prefix, urlPath);
      const q = quote || '"';
      return `url(${q}${rewritten}${q})`;
    },
  );
}
