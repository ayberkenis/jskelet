import { cn, esc } from "jskelet/html";
import { icon, link } from "jskelet/tags";

/**
 * Belge bölümünün kabuğu: sol gezinme, sağdaki "bu sayfada" listesi ve alt
 * taraftaki sıralı gezinme. Üçü de bileşen olarak duruyor çünkü hem belge
 * sayfası hem belge dizini aynı kabuğu kullanıyor; EJS'te iki kez yazılan bir
 * sidebar, bir gün yalnızca birinde güncellenir.
 */

/**
 * @typedef {{ slug: string, label: string, href: string }} SidebarItem
 * @typedef {{ key: string, title: string, items: SidebarItem[] }} SidebarGroup
 */

/**
 * Sol gezinme. Mobilde `<details>` içine giriyor: açılır kapanır bir menü için
 * island yazmak, JS'siz de çalışan bir davranışı JS'e bağımlı hâle getirmek
 * olurdu.
 *
 * @param {{ groups: SidebarGroup[], pathname: string, labels: object,
 *   release: { version: string, nodeLabel: string }, indexHref: string,
 *   indexLabel: string }} props
 * @returns {string}
 */
export function docsSidebar({
  groups,
  pathname,
  labels,
  release,
  indexHref,
  indexLabel,
}) {
  const tree = groups
    .map(
      (group) => `<div class="mt-6 first:mt-0">
        <p class="m-0 px-3 text-[11px] font-bold tracking-[0.14em] text-slate-500 uppercase dark:text-slate-400">${esc(group.title)}</p>
        <ul class="mt-2 grid list-none gap-0.5 p-0">
          ${group.items.map((item) => sidebarLink(item, pathname)).join("")}
        </ul>
      </div>`,
    )
    .join("");

  // Sürüm kartı en üstte: "hangi sürümün belgelerini okuyorum" sorusu belge
  // sitelerinde en sık sorulan ve en seyrek cevaplanan soru.
  const version = `<div class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.035]">
    <div class="flex items-center gap-2.5">
      <span class="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300">${icon({ name: "Tag", size: 16 })}</span>
      <span class="min-w-0">
        <span class="block truncate text-xs font-semibold">${esc(labels.versionLabel)}</span>
        <span class="block font-mono text-xs text-slate-500 dark:text-slate-400">v${esc(release.version)}</span>
      </span>
    </div>
  </div>`;

  const overview = sidebarLink(
    { slug: "index", label: indexLabel, href: indexHref },
    pathname,
  );

  return `<nav class="text-sm" aria-label="${esc(labels.nav)}">
    ${version}
    <ul class="mt-4 grid list-none gap-0.5 p-0">${overview}</ul>
    ${tree}
  </nav>`;
}

/**
 * @param {SidebarItem} item
 * @param {string} pathname
 * @returns {string}
 */
function sidebarLink(item, pathname) {
  const active = pathname === item.href;

  return `<li>${link({
    href: item.href,
    text: item.label,
    // `aria-current` görsel duruma eşlik etmeli: ekran okuyucuda etkin
    // bağlantıyı yalnızca renk anlatıyorsa hiç anlatılmıyor.
    attrs: active ? { "aria-current": "page" } : {},
    class: cn(
      "block rounded-lg border-l-2 px-3 py-1.5 transition-colors",
      active
        ? "border-cyan-500 bg-cyan-50 font-semibold text-cyan-800 dark:bg-cyan-400/10 dark:text-cyan-200"
        : "border-transparent text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:border-white/20 dark:hover:bg-white/5 dark:hover:text-white",
    ),
  })}</li>`;
}

/**
 * "Bu sayfada" listesi. Etkin bölümü işaretleme işi `doc-toc` island'ında:
 * sunucu hangi başlığın ekranda olduğunu bilemez, ama liste JS inmese de
 * çalışan bir bağlantı kümesi olarak kalır.
 *
 * @param {{ toc: import("../../lib/markdown.js").TocEntry[], title: string,
 *   editUrl: string, editLabel: string }} props
 * @returns {string}
 */
export function docsToc({ toc, title, editUrl, editLabel }) {
  const items = toc
    .map(
      (entry) => `<li>${link({
        href: `#${entry.id}`,
        text: entry.text,
        attrs: { "data-toc-link": entry.id },
        class: cn(
          "block border-l-2 border-transparent py-1 text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-950 dark:text-slate-400 dark:hover:border-white/20 dark:hover:text-white",
          entry.level === 3 ? "pl-6 text-[13px]" : "pl-3",
        ),
      })}</li>`,
    )
    .join("");

  const list = toc.length
    ? `<p class="m-0 text-[11px] font-bold tracking-[0.14em] text-slate-500 uppercase dark:text-slate-400">${esc(title)}</p>
       <ul class="mt-3 grid list-none gap-0.5 p-0 text-sm" data-island="doc-toc">${items}</ul>`
    : "";

  const edit = link({
    href: editUrl,
    html: `${icon({ name: "PencilSimple", size: 14 })}<span>${esc(editLabel)}</span>`,
    rel: "noopener",
    class: cn(
      "inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-cyan-700 dark:text-slate-400 dark:hover:text-cyan-300",
      toc.length && "mt-6 border-t border-slate-200 pt-5 dark:border-white/10",
    ),
  });

  return `${list}${edit}`;
}

/**
 * Sıralı gezinme. Belgeler baştan sona okunacak şekilde yazıldı; her bölümün
 * sonunda sidebar'a dönmek zorunda kalmak o akışı kırıyor.
 *
 * @param {{ previous: { label: string, href: string } | null,
 *   next: { label: string, href: string } | null,
 *   labels: { previous: string, next: string } }} props
 * @returns {string}
 */
export function docsPager({ previous, next, labels }) {
  if (!previous && !next) return "";

  return `<nav class="mt-14 grid gap-4 border-t border-slate-200 pt-8 sm:grid-cols-2 dark:border-white/10">
    ${previous ? pagerLink(previous, labels.previous, "back") : "<span></span>"}
    ${next ? pagerLink(next, labels.next, "forward") : ""}
  </nav>`;
}

/**
 * @param {{ label: string, href: string }} target
 * @param {string} caption
 * @param {"back" | "forward"} direction
 * @returns {string}
 */
function pagerLink(target, caption, direction) {
  const forward = direction === "forward";
  const arrow = icon({
    name: forward ? "ArrowRight" : "ArrowLeft",
    size: 16,
  });

  return link({
    href: target.href,
    html: `<span class="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">${forward ? "" : arrow}${esc(caption)}${forward ? arrow : ""}</span>
      <span class="mt-1 block font-semibold">${esc(target.label)}</span>`,
    class: cn(
      "rounded-2xl border border-slate-200 p-4 transition-colors hover:border-cyan-400 dark:border-white/10 dark:hover:border-cyan-300/40",
      forward && "text-right sm:col-start-2",
    ),
  });
}

/**
 * Belge dizinindeki kart. Bağlantı artık GitHub'a değil sitenin kendi belge
 * sayfasına gidiyor; markdown'ı burada render ettiğimiz için okuyucuyu depoya
 * göndermenin bir gerekçesi kalmadı.
 *
 * @param {{ href: string, index: string, title: string, body: string,
 *   hint: string }} props
 * @returns {string}
 */
export function docsCard({ href, index, title, body, hint }) {
  return link({
    href,
    class:
      "group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-cyan-400 hover:shadow-xl hover:shadow-cyan-950/5 dark:border-white/10 dark:bg-white/[0.035] dark:hover:border-cyan-300/40",
    html: `<span class="font-mono text-xs font-bold text-cyan-700 dark:text-cyan-300">${esc(index)}</span>
      <span class="mt-2 block font-semibold tracking-tight">${esc(title)}</span>
      <span class="mt-1.5 block text-sm/6 text-slate-600 dark:text-slate-300">${esc(body)}</span>
      <span class="mt-4 flex items-center gap-1.5 text-xs font-bold tracking-wide text-slate-600 uppercase group-hover:text-cyan-700 dark:text-slate-400 dark:group-hover:text-cyan-300">${esc(hint)}${icon({ name: "ArrowRight", size: 14 })}</span>`,
  });
}
