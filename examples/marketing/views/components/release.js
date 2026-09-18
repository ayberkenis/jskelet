import { cn, esc } from "jskelet/html";
import { icon, link } from "jskelet/tags";

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
    labelClass: "text-emerald-700 dark:text-emerald-300",
    bullet: "bg-emerald-500/70 dark:bg-emerald-400/70",
  },
  changed: {
    icon: "Wrench",
    class:
      "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-200",
    labelClass: "text-cyan-700 dark:text-brand-300",
    bullet: "bg-cyan-500/70 dark:bg-cyan-400/70",
  },
  fixed: {
    icon: "Bug",
    class:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100",
    labelClass: "text-amber-800 dark:text-amber-200",
    bullet: "bg-amber-500/70 dark:bg-amber-400/70",
  },
  removed: {
    icon: "Minus",
    class:
      "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-200",
    labelClass: "text-rose-700 dark:text-rose-300",
    bullet: "bg-rose-500/70 dark:bg-rose-400/70",
  },
  breaking: {
    icon: "Warning",
    class:
      "border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-100",
    labelClass: "text-orange-800 dark:text-orange-200",
    bullet: "bg-orange-500/80 dark:bg-orange-400/70",
  },
};

const GITHUB = "https://github.com/ayberkenis/jskelet";

/**
 * Üstteki dört ölçüm kartı. Değerler CHANGELOG + paket künyesinden gelir.
 *
 * @param {{ total: number, released: number, breaking: number,
 *   latest: { version: string, date: string }, labels: Record<string, string> }} props
 * @returns {string}
 */
export function changelogStats({ total, released, breaking, latest, labels }) {
  const cards = [
    {
      label: labels.statTotal,
      value: String(total),
      note: labels.statTotalNote,
      icon: "Pulse",
      tone: "plain",
    },
    {
      label: labels.statReleased,
      value: String(released),
      note: labels.statReleasedNote,
      icon: "CheckCircle",
      tone: "good",
    },
    {
      label: labels.statBreaking,
      value: String(breaking),
      note: labels.statBreakingNote,
      icon: "Warning",
      tone: "warn",
    },
    {
      label: labels.statLatest,
      value: latest.version ? `v${latest.version}` : "—",
      note: latest.date || labels.statLatestNote,
      icon: "Clock",
      tone: "sky",
    },
  ];

  const tones = {
    plain: "border-slate-200 dark:border-white/10",
    good: "border-emerald-200/80 dark:border-emerald-400/25",
    warn: "border-orange-200/80 dark:border-orange-400/25",
    sky: "border-cyan-200/80 dark:border-brand-400/30",
  };

  const iconTones = {
    plain: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
    good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    warn: "bg-orange-500/15 text-orange-800 dark:text-orange-200",
    sky: "bg-brand-400/15 text-cyan-700 dark:text-brand-300",
  };

  return `<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    ${cards
      .map(
        (card) => `<div class="${cn(
          "rounded-2xl border bg-white/80 p-5 dark:bg-white/[0.04]",
          tones[card.tone],
        )}">
          <div class="flex items-start justify-between gap-3">
            <p class="m-0 text-[11px] font-bold tracking-[0.14em] text-slate-500 uppercase dark:text-slate-400">${esc(card.label)}</p>
            <span class="${cn("inline-flex size-8 items-center justify-center rounded-lg", iconTones[card.tone])}" aria-hidden="true">${icon({ name: card.icon, size: 16 })}</span>
          </div>
          <p class="mt-3 mb-0 font-mono text-3xl font-bold tracking-tight tabular-nums">${esc(card.value)}</p>
          <p class="mt-1 mb-0 text-xs text-slate-500 dark:text-slate-400">${esc(card.note)}</p>
        </div>`,
      )
      .join("")}
  </div>`;
}

/**
 * Arama + sıralama araç çubuğu.
 *
 * @param {{ labels: Record<string, string>, total: number }} props
 * @returns {string}
 */
export function changelogToolbar({ labels, total }) {
  return `<div class="flex flex-col gap-3 lg:flex-row lg:items-center">
    <label class="relative min-w-0 flex-1">
      <span class="sr-only">${esc(labels.searchLabel)}</span>
      <span class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400">${icon({ name: "MagnifyingGlass", size: 16 })}</span>
      <input
        type="search"
        data-changelog-search
        placeholder="${esc(labels.searchPlaceholder)}"
        autocomplete="off"
        class="w-full rounded-xl border border-slate-200 bg-white py-3 pr-4 pl-10 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-brand-400/50"
      >
    </label>
    <div class="flex flex-wrap items-center gap-2" role="group" aria-label="${esc(labels.sortLabel)}">
      <button
        type="button"
        data-changelog-sort="newest"
        aria-pressed="true"
        class="rounded-xl border border-brand-400/40 bg-brand-400/15 px-3.5 py-2.5 text-sm font-semibold text-cyan-900 dark:border-brand-400/35 dark:bg-brand-400/15 dark:text-brand-300"
      >${esc(labels.sortNewest)}</button>
      <button
        type="button"
        data-changelog-sort="oldest"
        aria-pressed="false"
        class="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-white/20"
      >${esc(labels.sortOldest)}</button>
    </div>
  </div>
  <div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
    <p class="m-0" data-changelog-count>${esc(
      labels.showing
        .replace("%s", "1")
        .replace("%e", String(Math.min(8, total)))
        .replace("%t", String(total)),
    )}</p>
    <div class="flex items-center gap-3">
      <p class="m-0" data-changelog-page></p>
      <div class="flex gap-1">
        <button type="button" data-changelog-prev class="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20" aria-label="${esc(labels.prevPage)}">←</button>
        <button type="button" data-changelog-next class="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20" aria-label="${esc(labels.nextPage)}">→</button>
      </div>
    </div>
  </div>`;
}

/**
 * Tek sürüm kartı — release notes tarzı: her zaman açık.
 *
 * @param {{ entry: { version: string, date?: string, unreleased?: boolean,
 *   summary?: string, groups: Array<{ type: string, items: string[] }> },
 *   labels: Record<string, string>, current?: boolean, latest?: boolean,
 *   render?: (item: string) => string }} props
 * @returns {string}
 */
export function changelogEntry({
  entry,
  labels,
  current = false,
  latest = false,
  render,
}) {
  const title = entry.unreleased
    ? esc(labels.statuses.unreleased ?? "unreleased")
    : `v${esc(entry.version)}`;

  const searchBlob = [
    entry.version,
    entry.date,
    entry.summary,
    ...entry.groups.flatMap((group) => [group.type, ...group.items]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const badges = [];
  if (latest && !entry.unreleased) {
    badges.push(
      `<span class="inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-2.5 py-1 text-[10px] font-bold tracking-wider text-white uppercase dark:bg-white dark:text-ink-950"><span class="size-1.5 rounded-full bg-emerald-400" aria-hidden="true"></span>${esc(labels.latestBadge)}</span>`,
    );
  }
  if (current && !entry.unreleased) {
    badges.push(
      `<span class="inline-flex items-center rounded-full bg-cyan-500/15 px-2.5 py-1 text-[10px] font-bold tracking-wider text-cyan-800 uppercase dark:text-brand-300">${esc(labels.statuses.current)}</span>`,
    );
  }
  if (entry.unreleased) {
    badges.push(
      `<span class="inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold tracking-wider text-amber-900 uppercase dark:text-amber-100">${esc(labels.statuses.unreleased)}</span>`,
    );
  } else {
    badges.push(
      `<span class="inline-flex items-center rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold tracking-wider text-emerald-800 uppercase dark:text-emerald-200">${esc(labels.releasedBadge)}</span>`,
    );
  }

  const githubHref = entry.unreleased
    ? `${GITHUB}/blob/master/CHANGELOG.md`
    : `${GITHUB}/releases/tag/v${encodeURIComponent(entry.version)}`;

  const items = entry.groups
    .flatMap((group) => {
      const type = TYPES[group.type] ?? TYPES.changed;
      const typeLabel = labels.types[group.type] ?? group.type;
      return group.items.map(
        (item) => `<li class="flex gap-3 text-sm/7 text-slate-700 dark:text-slate-300">
          <span aria-hidden="true" class="${cn("mt-2.5 size-1.5 shrink-0 rounded-full", type.bullet)}"></span>
          <span class="min-w-0">
            <span class="${cn("mr-1.5 font-mono text-[11px] font-bold tracking-wide uppercase", type.labelClass)}">${esc(typeLabel)}</span>
            ${render ? render(item) : esc(item)}
          </span>
        </li>`,
      );
    })
    .join("");

  return `<article
    id="v${esc(entry.version)}"
    class="scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-white/10 dark:bg-white/[0.035]"
    data-changelog-card
    data-version="${esc(entry.version)}"
    data-search="${esc(searchBlob)}"
  >
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">${badges.join("")}</div>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          data-changelog-copy="#v${esc(entry.version)}"
          class="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-brand-400 hover:text-cyan-700 dark:border-white/10 dark:text-slate-400 dark:hover:border-brand-400/40 dark:hover:text-brand-300"
          title="${esc(labels.copyLink)}"
          aria-label="${esc(labels.copyLink)}"
        >${icon({ name: "Link", size: 16 })}</button>
        ${link({
          href: githubHref,
          html: icon({ name: "ArrowSquareOut", size: 16 }),
          rel: "noopener",
          title: labels.openGithub,
          class:
            "inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-brand-400 hover:text-cyan-700 dark:border-white/10 dark:text-slate-400 dark:hover:border-brand-400/40 dark:hover:text-brand-300",
        })}
      </div>
    </div>

    <h2 class="mt-4 mb-0 font-mono text-3xl font-bold tracking-tight sm:text-4xl">${title}</h2>

    <p class="mt-3 mb-0 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
      ${
        entry.date
          ? `<time datetime="${esc(entry.date)}">${esc(labels.releasedMeta.replace("%s", entry.date))}</time>`
          : `<span>${esc(labels.statuses.unreleased)}</span>`
      }
    </p>

    ${
      entry.summary
        ? `<p class="mt-5 mb-0 max-w-3xl text-base/7 text-slate-600 dark:text-slate-300">${
            render ? render(entry.summary) : esc(entry.summary)
          }</p>`
        : ""
    }

    ${
      items
        ? `<ul class="mt-6 grid list-none gap-3 border-t border-slate-200/80 p-0 pt-6 dark:border-white/10">${items}</ul>`
        : ""
    }
  </article>`;
}

/**
 * @returns {string}
 */
export function versionRail() {
  return "";
}

/**
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
 * @param {{ items: Array<{ label: string, value: string, icon: string }> }} props
 * @returns {string}
 */
export function metaRow({ items }) {
  const cells = items
    .map(
      (item) => `<div class="flex items-center gap-3 px-5 py-4">
        <span class="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-700 dark:border-brand-400/35 dark:bg-brand-400/10 dark:text-brand-300">${icon({ name: item.icon, size: 18 })}</span>
        <span class="grid">
          <span class="text-[11px] font-bold tracking-[0.16em] text-slate-600 uppercase dark:text-slate-400">${esc(item.label)}</span>
          <span class="font-mono text-base font-bold">${esc(item.value)}</span>
        </span>
      </div>`,
    )
    .join("");

  return `<div class="grid divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.04]">${cells}</div>`;
}

/**
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

  return `<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
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
