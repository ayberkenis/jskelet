import { attrs, cn, esc } from "jskelet/html";
import { link } from "jskelet/tags";

/**
 * `views/components/**` altındaki her named export otomatik olarak şablon
 * local'i olur; `.jsk` içinde `<PostCard :post="post" />` olarak çağrılır.
 *
 * Bileşenler EJS/JSK şablonu değil, HTML string döndüren fonksiyonlardır.
 * Aynı bileşen sayfada, partial'da ve fragment ucunda kullanılabilir.
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
    ${tagList({ tags: post.tags })}
  </article>`;
}

/**
 * @param {{ tags: string[] }} props
 * @returns {string}
 */
export function tagList({ tags }) {
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
 * Fragment ve ana sayfa sekmeleri için yazı satırları. `.jsk` ifadesinde
 * şablon literal / filter olmadığı için href burada kurulur.
 *
 * @param {{ posts: import('../../lib/posts.js').Post[] }} props
 * @returns {string}
 */
export function postRows({ posts }) {
  const list = posts ?? [];
  if (!list.length) {
    return `<ul class="m-0 divide-y divide-slate-200 p-0">
  <li class="list-none py-3 text-sm text-slate-500">Bu etikette yazı yok.</li>
</ul>`;
  }

  const items = list
    .map(
      (post) => `<li class="list-none py-3">
    ${link({
      href: `/blog/${post.slug}`,
      text: post.title,
      class: "font-medium hover:underline",
    })}
    <p class="clamp-2 m-0 mt-1 text-sm text-slate-500">${esc(post.excerpt)}</p>
  </li>`,
    )
    .join("");

  return `<ul class="m-0 divide-y divide-slate-200 p-0">${items}</ul>`;
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
