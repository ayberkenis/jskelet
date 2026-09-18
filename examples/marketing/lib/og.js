/**
 * Sayfa kartları için mutlak OG görsel URL'si.
 * Blog örneğindeki `/og/blog/:slug.png` sözleşmesinin marketing karşılığı.
 */
const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

/**
 * @param {import("./i18n.js").Locale} locale
 * @param {string} page `PAGES` anahtarı veya `docs-<slug>`
 * @returns {string}
 */
export function ogImageUrl(locale, page) {
  return `${SITE_URL}/og/${locale}/${page}.png`;
}
