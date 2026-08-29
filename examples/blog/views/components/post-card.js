import { attrs, cn, esc } from "jskelet/html";
import { link } from "jskelet/tags";

/**
 * `views/components/**` altındaki her named export otomatik olarak şablon
 * local'i olur; `<%- postCard({ post }) %>` doğrudan çalışır.
 *
 * Bileşenler EJS şablonu değil, HTML string döndüren fonksiyonlardır. Bunun
 * pratik faydası: aynı bileşen bir sayfada, bir partial'da ve bir fragment
 * ucunda kullanılabilir; üçü de aynı çıktıyı üretir.
 *
 * @param {{ post: import('../../lib/posts.js').Post, class?: string }} props
 * @returns {string}
 */
export function postCard({ post, class: className }) {
  const attributes = attrs({
    class: cn(
      "flex flex-col gap-2 rounded-lg border border-slate-200 p-5",
      className,
    ),
  });

  return `<article${attributes}>
    <div class="flex items-center gap-2 text-xs text-slate-500">
      <time datetime="${esc(post.publishedAt)}">${esc(formatDate(post.publishedAt))}</time>
      <span aria-hidden="true">·</span>
      <span>${post.readingMinutes} dk okuma</span>
    </div>
    <h3 class="m-0 text-lg font-semibold">${link({
      href: `/blog/${post.slug}`,
      text: post.title,
      class: "hover:underline",
    })}</h3>
    <p class="clamp-2 m-0 text-sm text-slate-600">${esc(post.excerpt)}</p>
    ${tagList(post.tags)}
  </article>`;
}

/**
 * @param {string[]} tags
 * @returns {string}
 */
export function tagList(tags) {
  if (!tags?.length) return "";

  const items = tags
    .map((tag) =>
      link({
        href: `/etiket/${tag}`,
        text: `#${tag}`,
        class: "text-xs text-slate-500 hover:underline",
      }),
    )
    .join("");

  return `<div class="flex flex-wrap gap-3">${items}</div>`;
}

/**
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
