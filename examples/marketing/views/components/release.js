import { cn, esc } from "jskelet/html";
import { icon } from "jskelet/tags";

/**
 * Sürüm notları ve indirme sayfasının blokları. Sürüm numarası, tarih ve
 * bağımlılık listesi ölçülen veri; buradaki bileşenler yalnızca onu biçimler.
 */

/** Değişiklik türü → renk ve ikon. Renk tek başına anlam taşımasın diye
    her türün ayrıca bir ikonu ve yazılı etiketi var. */
const TYPES = {
  added: {
    icon: "Plus",
    class:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-200",
    rule: "bg-emerald-400/70 dark:bg-emerald-400/50",
    bullet: "bg-emerald-500/70 dark:bg-emerald-400/70",
  },
  changed: {
    icon: "Wrench",
    class:
      "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-200",
    rule: "bg-cyan-400/70 dark:bg-cyan-400/50",
    bullet: "bg-cyan-500/70 dark:bg-cyan-400/70",
  },
  fixed: {
    icon: "Bug",
    class:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100",
    rule: "bg-amber-400/70 dark:bg-amber-400/50",
    bullet: "bg-amber-500/70 dark:bg-amber-400/70",
  },
  removed: {
    icon: "Minus",
    class:
      "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200",
    rule: "bg-rose-400/70 dark:bg-rose-400/50",
    bullet: "bg-rose-500/70 dark:bg-rose-400/70",
  },
  breaking: {
    icon: "Warning",
    class:
      "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-100",
    rule: "bg-orange-400/80 dark:bg-orange-400/60",
    bullet: "bg-orange-500/80 dark:bg-orange-400/70",
  },
};

/**
 * Tek bir sürüm kaydı. Sol kolon künye, sağ kolon değişiklikler; mobilde
 * alt alta iner.
 *
 * Madde metinleri CHANGELOG.md'den geldiği için satır içi markdown taşıyor;
 * `render` verildiğinde HTML'e çevirme işi ona bırakılır, verilmezse metin
 * kaçırılarak basılır.
 *
 * @param {{ entry: { version: string, date?: string, unreleased?: boolean,
 *   summary?: string, groups: Array<{ type: string, items: string[] }> },
 *   labels: { dateLabel: string, types: Record<string, string>,
 *   statuses: Record<string, string> }, current?: boolean,
 *   render?: (item: string) => string }} props
 * @returns {string}
 */
export function changelogEntry({ entry, labels, current = false, render, last = false }) {
  const status = entry.unreleased ? "unreleased" : current ? "current" : "previous";
  const highlight = current && !entry.unreleased;

  const groups = entry.groups
    .map((group) => {
      const type = TYPES[group.type] ?? TYPES.changed;

      const items = group.items
        .map(
          (item) =>
            `<li class="flex gap-2.5">
              <span aria-hidden="true" class="${cn("mt-2 size-1.5 shrink-0 rounded-full", type.bullet)}"></span>
              <span>${render ? render(item) : esc(item)}</span>
            </li>`,
        )
        .join("");

      return `<section class="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 pl-5 dark:border-white/5 dark:bg-white/[0.02]">
        <span aria-hidden="true" class="${cn("absolute inset-y-0 left-0 w-1", type.rule)}"></span>
        <div class="mb-3 flex items-center gap-2">
          <span class="${cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide uppercase", type.class)}">
            ${icon({ name: type.icon, size: 12 })}${esc(labels.types[group.type] ?? group.type)}
          </span>
          <span class="font-mono text-xs text-slate-500 dark:text-slate-500">${group.items.length}</span>
        </div>
        <ul class="m-0 grid list-none gap-2 p-0 text-sm/6 text-slate-700 dark:text-slate-300">${items}</ul>
      </section>`;
    })
    .join("");

  const title = entry.unreleased
    ? esc(labels.statuses.unreleased ?? "unreleased")
    : `v${esc(entry.version)}`;

  return `<article id="v${esc(entry.version)}" class="relative grid scroll-mt-24 gap-5 lg:grid-cols-[12rem_1fr] lg:gap-10">
    <div class="lg:sticky lg:top-24 grid content-start gap-3 lg:h-fit">
      <div class="flex items-center gap-2.5">
        <span class="${cn(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-xl",
          highlight
            ? "bg-gradient-to-br from-cyan-600 to-indigo-600 text-white shadow-lg shadow-cyan-950/20"
            : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
        )}">${icon({
          name: highlight ? "RocketLaunch" : entry.unreleased ? "GitBranch" : "Tag",
          size: 18,
        })}</span>
        <a href="#v${esc(entry.version)}" class="m-0 font-mono text-2xl font-bold tracking-tight no-underline hover:text-cyan-700 dark:hover:text-cyan-300">${title}</a>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span class="${cn(
          "inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide uppercase",
          highlight
            ? "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200"
            : "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
        )}">${esc(labels.statuses[status] ?? status)}</span>
        ${
          entry.date
            ? `<time datetime="${esc(entry.date)}" class="font-mono text-xs text-slate-500 dark:text-slate-400" title="${esc(labels.dateLabel)}">${esc(entry.date)}</time>`
            : ""
        }
      </div>
    </div>

    <div class="relative pl-6 sm:pl-8 lg:pl-10">
      <span aria-hidden="true" class="${cn(
        "absolute top-3 left-1.5 w-px bg-gradient-to-b from-slate-300 to-transparent sm:left-2.5 lg:left-3.5 dark:from-white/15",
        last ? "bottom-4" : "-bottom-14",
      )}"></span>
      <span aria-hidden="true" class="${cn(
        "absolute top-2 left-0 size-3 rounded-full ring-4 ring-white sm:left-1 lg:left-2 dark:ring-[#070b18]",
        highlight
          ? "bg-gradient-to-br from-cyan-500 to-indigo-600"
          : "bg-slate-300 dark:bg-slate-600",
      )}"></span>

      <div class="${cn(
        "grid gap-5 rounded-3xl border p-5 sm:p-7",
        highlight
          ? "border-cyan-300 bg-gradient-to-br from-cyan-50/80 to-white shadow-xl shadow-cyan-950/5 dark:border-cyan-400/30 dark:from-cyan-400/[0.08] dark:to-white/[0.03]"
          : "border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.03]",
      )}">
        ${
          entry.summary
            ? `<p class="m-0 text-base/7 font-medium text-slate-800 dark:text-slate-200">${
                render ? render(entry.summary) : esc(entry.summary)
              }</p>`
            : ""
        }
        <div class="grid gap-4 xl:grid-cols-2">${groups}</div>
      </div>
    </div>
  </article>`;
}

/**
 * Sürüm listesinin üstündeki hızlı geçiş şeridi. Kayıt sayısı arttıkça sayfa
 * uzuyor; kullanıcı aradığı sürüme tek tıkla insin diye.
 *
 * @param {{ entries: Array<{ version: string, unreleased?: boolean }>,
 *   labels: { statuses: Record<string, string> }, current: string }} props
 * @returns {string}
 */
export function versionRail({ entries, labels, current }) {
  if (entries.length < 2) return "";

  const chips = entries
    .map((entry) => {
      const active = entry.version === current && !entry.unreleased;
      const text = entry.unreleased
        ? (labels.statuses.unreleased ?? "unreleased")
        : `v${entry.version}`;

      return `<a href="#v${esc(entry.version)}" class="${cn(
        "inline-flex items-center rounded-full border px-3 py-1.5 font-mono text-xs font-bold no-underline transition-colors",
        active
          ? "border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:text-white",
      )}">${esc(text)}</a>`;
    })
    .join("");

  return `<nav class="flex flex-wrap gap-2">${chips}</nav>`;
}

/**
 * Kurulum adımı: numaralı etiket, kopyalanabilir komut ve tek satır gerekçe.
 *
 * @param {{ label: string, command: string, note: string,
 *   copy: { idle: string, done: string, failed: string } }} props
 * @returns {string}
 */
export function commandStep({ label, command, note, copy }) {
  return `<div class="grid gap-3">
    <p class="m-0 text-xs font-bold tracking-[0.16em] text-slate-600 uppercase dark:text-slate-400">${esc(label)}</p>
    ${codeShell(command, copy)}
    <p class="m-0 text-sm/6 text-slate-600 dark:text-slate-400">${esc(note)}</p>
  </div>`;
}

/**
 * Tek satırlık komut kabuğu. `codeBlock` çok satırlı örnekler için; burada
 * satır başında bir prompt işareti ve kopyalama düğmesi yeterli.
 *
 * @param {string} command
 * @param {{ idle: string, done: string, failed: string }} copy
 * @returns {string}
 */
function codeShell(command, copy) {
  return `<div class="relative overflow-hidden rounded-2xl border border-white/10 bg-[#090d1d] py-3.5 pr-24 pl-4 shadow-lg shadow-slate-950/20">
    <code class="block overflow-x-auto font-mono text-[13px] whitespace-nowrap text-slate-100">
      <span class="mr-2 text-cyan-300" aria-hidden="true">$</span>${esc(command)}
    </code>
    <button
      type="button"
      data-island="copy-command"
      data-island-props='${esc(JSON.stringify({ text: command, done: copy.done, failed: copy.failed }))}'
      class="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-white/20 hover:text-white"
    >${esc(copy.idle)}</button>
  </div>`;
}

/**
 * Sürüm künyesi: sürüm, lisans ve Node gereksinimi yan yana.
 *
 * @param {{ items: Array<{ label: string, value: string, icon: string }> }} props
 * @returns {string}
 */
export function metaRow({ items }) {
  const cells = items
    .map(
      (item) => `<div class="flex items-center gap-3 px-5 py-4">
        <span class="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200">${icon({ name: item.icon, size: 18 })}</span>
        <span class="grid">
          <span class="text-[11px] font-bold tracking-[0.16em] text-slate-600 uppercase dark:text-slate-400">${esc(item.label)}</span>
          <span class="font-mono text-base font-bold">${esc(item.value)}</span>
        </span>
      </div>`,
    )
    .join("");

  return `<div class="grid divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.035]">${cells}</div>`;
}

/**
 * Bağımlılık listesi. Sürüm aralıkları kurulu paketten okunuyor, elle
 * yazılmıyor; liste bu yüzden her zaman gerçek.
 *
 * @param {{ title: string, items: Array<{ name: string, range: string }>,
 *   nameColumn: string, versionColumn: string }} props
 * @returns {string}
 */
export function dependencyTable({ title, items, nameColumn, versionColumn }) {
  if (!items.length) return "";

  const rows = items
    .map(
      (item) => `<tr class="border-t border-slate-200 dark:border-white/10">
        <td class="py-2.5 pr-4 pl-4 font-mono text-xs">${esc(item.name)}</td>
        <td class="py-2.5 pr-4 text-right font-mono text-xs text-slate-600 dark:text-slate-400">${esc(item.range)}</td>
      </tr>`,
    )
    .join("");

  return `<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.025]">
    <p class="m-0 border-b border-slate-200 px-4 py-3 text-sm font-semibold dark:border-white/10">${esc(title)}</p>
    <table class="w-full">
      <thead class="text-[11px] tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <tr>
          <th scope="col" class="py-2 pr-4 pl-4 text-left font-semibold">${esc(nameColumn)}</th>
          <th scope="col" class="py-2 pr-4 text-right font-semibold">${esc(versionColumn)}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
