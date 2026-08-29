/**
 * Metadata → `<head>` etiketleri. Next.js'in Metadata API'sinin karşılığı.
 *
 * Controller `metadata` döndürür, framework onu etiketlere çevirir. Şema
 * bilinçli olarak küçük: title/description/canonical/robots ve OpenGraph +
 * Twitter kartları. Daha fazlası gerekirse `extraTags` ile ham HTML eklenir,
 * böylece framework her yeni meta türü için sürüm çıkarmak zorunda kalmaz.
 *
 * @typedef {object} Metadata
 * @property {string} [title]
 * @property {string} [titleTemplate] `"%s | Site"` — `title` buna gömülür.
 * @property {string} [description]
 * @property {string} [canonical] Mutlak ya da göreli URL.
 * @property {string} [siteUrl] Göreli canonical'ı mutlaklaştırmak için.
 * @property {{ index?: boolean, follow?: boolean }} [robots]
 * @property {string} [locale]
 * @property {object} [openGraph] `{ title, description, url, type, siteName, image, imageWidth, imageHeight }`
 * @property {object} [twitter] `{ card, site, creator, title, description, image }`
 * @property {string[]} [extraTags] Olduğu gibi basılacak ham etiketler.
 */
import { attrs, esc } from "../views/helpers/html.js";

/**
 * @param {string} name
 * @param {unknown} content
 * @returns {string}
 */
function meta(name, content) {
  if (content == null || content === "") return "";
  return `<meta${attrs({ name, content })}>`;
}

/**
 * OpenGraph `property` kullanır, `name` değil — bazı kazıyıcılar `name` ile
 * yazılmış og etiketlerini görmezden geliyor.
 *
 * @param {string} property
 * @param {unknown} content
 * @returns {string}
 */
function og(property, content) {
  if (content == null || content === "") return "";
  return `<meta${attrs({ property, content })}>`;
}

/**
 * @param {string} [canonical]
 * @param {string} [siteUrl]
 * @returns {string | undefined}
 */
function absoluteUrl(canonical, siteUrl) {
  if (!canonical) return undefined;
  if (/^https?:\/\//.test(canonical)) return canonical;
  if (!siteUrl) return canonical;
  return new URL(canonical, siteUrl).href;
}

/**
 * @param {Metadata} [metadata]
 * @returns {string}
 */
export function renderHeadMeta(metadata = {}) {
  const title = metadata.titleTemplate && metadata.title
    ? metadata.titleTemplate.replace("%s", metadata.title)
    : metadata.title;

  const url = absoluteUrl(metadata.canonical, metadata.siteUrl);
  const robots = metadata.robots ?? {};
  // Varsayılan indekslenebilir: bir sayfayı gizlemek açık bir karar olmalı.
  const robotsValue = [
    robots.index === false ? "noindex" : "index",
    robots.follow === false ? "nofollow" : "follow",
  ].join(", ");

  const graph = metadata.openGraph ?? {};
  const card = metadata.twitter ?? {};

  return [
    title ? `<title>${esc(title)}</title>` : "",
    meta("description", metadata.description),
    url ? `<link${attrs({ rel: "canonical", href: url })}>` : "",
    meta("robots", robotsValue),
    og("og:type", graph.type ?? "website"),
    og("og:title", graph.title ?? title),
    og("og:description", graph.description ?? metadata.description),
    og("og:url", graph.url ?? url),
    og("og:site_name", graph.siteName),
    og("og:locale", metadata.locale),
    og("og:image", graph.image),
    og("og:image:width", graph.imageWidth),
    og("og:image:height", graph.imageHeight),
    meta("twitter:card", card.card ?? (graph.image ? "summary_large_image" : "summary")),
    meta("twitter:site", card.site),
    meta("twitter:creator", card.creator),
    meta("twitter:title", card.title ?? graph.title ?? title),
    meta("twitter:description", card.description ?? metadata.description),
    meta("twitter:image", card.image ?? graph.image),
    ...(metadata.extraTags ?? []),
  ]
    .filter(Boolean)
    .join("");
}
