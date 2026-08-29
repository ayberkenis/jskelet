/**
 * `<head>` kaynak ipuçları — `react-dom`'un preconnect/preload çağrılarının
 * karşılığı.
 *
 * Layout bu bloğu `<head>`in en başına basar: preconnect ve LCP preload'ını
 * geciktirmek doğrudan LCP'ye yazılır. Preconnect listesi her sayfada aynı
 * olduğu için bir kez hesaplanır; sayfaya özel görsel preload'ını
 * controller `head` alanıyla `headHints()` üzerinden ekler.
 */
import { getConfig } from "../config/index.js";
import { preloadImage } from "../views/helpers/tags.js";
import { esc } from "../views/helpers/html.js";

/** @type {string | null} */
let cached = null;

/**
 * `jskelet.config.mjs` → `preconnect: ["https://cdn.example.com"]`.
 * Üçüncü taraf kaynaklar (görsel CDN'i, API origin'i, font host'u) buraya
 * yazılır. Boş liste geçerli bir yapılandırmadır.
 *
 * @returns {string}
 */
export function preconnectHints() {
  if (cached != null) return cached;

  cached = getConfig()
    .preconnect.map((origin) => {
      try {
        return `<link rel="preconnect" href="${esc(new URL(origin).origin)}">`;
      } catch {
        console.warn(`[head] preconnect geçersiz URL, atlandı: ${origin}`);
        return "";
      }
    })
    .join("");

  return cached;
}

/**
 * İlk ekrandaki görselin preload'ı. Preconnect'leri layout zaten her sayfaya
 * bastığı için burada tekrarlanmaz.
 *
 * @param {{ href?: string | null, imageSrcSet?: string,
 *   imageSizes?: string }} [lcpImage]
 * @returns {string}
 */
export function headHints(lcpImage) {
  if (!lcpImage?.href) return "";

  return preloadImage({
    href: lcpImage.href,
    imagesrcset: lcpImage.imageSrcSet,
    imagesizes: lcpImage.imageSizes,
  });
}
