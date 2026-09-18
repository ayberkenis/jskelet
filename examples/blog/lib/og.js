const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

/**
 * Yazı slug'ı için mutlak OG görsel URL'si.
 * @param {string} slug
 * @returns {string}
 */
export function ogImageUrl(slug) {
  return `${SITE_URL}/og/blog/${slug}.png`;
}
