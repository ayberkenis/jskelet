import { cn, esc } from "jskelet/html";

import { formatBytes } from "../../lib/payload.js";

/**
 * Bileşen dosyalarındaki her named export şablon local'i olduğu için biçimleme
 * yardımcısı da buradan açılıyor; şablonların `lib/` içinden import etme yolu
 * yok.
 *
 * @param {number} value
 * @returns {string}
 */
export function bytes(value) {
  return formatBytes(value);
}

/**
 * @param {{ value: string, label: string, note?: string, tone?: 'sky' | 'plain' }} props
 * @returns {string}
 */
export function statCard({ value, label, note, tone = "plain" }) {
  return `<div class="${cn(
    "rounded-2xl border p-6 shadow-sm",
    tone === "sky"
      ? "border-cyan-200 bg-gradient-to-br from-cyan-50 to-white dark:border-cyan-500/30 dark:from-cyan-500/10 dark:to-white/[0.03]"
      : "border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.035]",
  )}">
    <p class="m-0 font-mono text-3xl font-bold tracking-tight tabular-nums">${esc(value)}</p>
    <p class="mt-1 m-0 text-sm font-medium">${esc(label)}</p>
    ${note ? `<p class="mt-2 m-0 text-xs text-slate-500 dark:text-slate-400">${esc(note)}</p>` : ""}
  </div>`;
}

/**
 * Build çıktısının ölçülen boyutları. Manifest yoksa tablo yerine bir not
 * basılır — `jskelet build` çalıştırılmadan da sayfanın açılması gerekiyor.
 *
 * Satır adları ölçümle birlikte gelmiyor, sözlükten geliyor: ölçüm dilden
 * bağımsız, etiket değil.
 *
 * @param {{ payload: { entries: import('../../lib/payload.js').PayloadEntry[],
 *   total: import('../../lib/payload.js').PayloadEntry | null },
 *   labels: Record<string, string> }} props
 * @returns {string}
 */
export function payloadTable({ payload, labels }) {
  const { entries, total } = payload;

  if (!entries.length) {
    return `<p class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm/6 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">${esc(labels.missing)}</p>`;
  }

  const rows = entries
    .map(
      (entry) => `<tr class="border-t border-slate-200 dark:border-white/10">
        <td class="py-2.5 pr-4">${esc(labels[entry.name] ?? entry.name)}</td>
        <td class="py-2.5 pr-4 font-mono text-right tabular-nums text-slate-600 dark:text-slate-400">${esc(formatBytes(entry.bytes))}</td>
        <td class="py-2.5 font-mono text-right tabular-nums font-semibold">${esc(formatBytes(entry.gzip))}</td>
      </tr>`,
    )
    .join("");

  const footer = total
    ? `<tr class="border-t-2 border-slate-300 dark:border-white/20">
        <td class="py-2.5 pr-4 font-semibold">${esc(labels.total)}</td>
        <td class="py-2.5 pr-4 font-mono text-right tabular-nums text-slate-600 dark:text-slate-400">${esc(formatBytes(total.bytes))}</td>
        <td class="py-2.5 font-mono text-right tabular-nums font-semibold">${esc(formatBytes(total.gzip))}</td>
      </tr>`
    : "";

  return `<div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.025]">
    <table class="w-full text-sm">
      <caption class="border-b border-slate-200 px-4 py-3 text-left text-xs/5 text-slate-600 dark:border-white/10 dark:text-slate-400">${esc(labels.caption)}</caption>
      <thead class="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <tr class="border-b border-slate-200 dark:border-white/10">
          <th scope="col" class="py-2.5 pr-4 pl-4 text-left font-semibold"></th>
          <th scope="col" class="py-2.5 pr-4 text-right font-semibold">${esc(labels.bytesColumn)}</th>
          <th scope="col" class="py-2.5 pr-4 text-right font-semibold">${esc(labels.gzipColumn)}</th>
        </tr>
      </thead>
      <tbody class="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4">${rows}${footer}</tbody>
    </table>
  </div>`;
}

/**
 * Yatay bar grubu. Genişlik CSS değişkeniyle sürülür ve island görünürlükte
 * `--bar` yazar; JS inmezse barlar %0 değil, sunucudan gelen değerde durur.
 *
 * @param {{ items: Array<{ label: string, value: number, display: string,
 *   note?: string, tone?: 'good' | 'bad' }>, max?: number }} props
 * @returns {string}
 */
export function barGroup({ items, max }) {
  const ceiling = max ?? Math.max(...items.map((item) => item.value), 1);

  const rows = items
    .map((item) => {
      const percent = Math.max(2, Math.round((item.value / ceiling) * 100));
      const fill =
        item.tone === "bad"
          ? "bg-rose-400/80 dark:bg-rose-500/70"
          : "bg-sky-500 dark:bg-sky-400";

      return `<li class="grid gap-1.5">
        <div class="flex items-baseline justify-between gap-4 text-sm">
          <span class="font-medium">${esc(item.label)}</span>
          <span class="font-mono tabular-nums text-slate-500 dark:text-slate-400">${esc(item.display)}</span>
        </div>
        <div class="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            class="${cn("bar-fill h-full rounded-full", fill)}"
            style="--bar: ${percent}%"
            data-bar="${percent}"
          ></div>
        </div>
        ${item.note ? `<p class="m-0 text-xs text-slate-500 dark:text-slate-400">${esc(item.note)}</p>` : ""}
      </li>`;
    })
    .join("");

  return `<ul class="grid list-none gap-4 p-0" data-island="bars">${rows}</ul>`;
}

/**
 * Ölçülen JSkelet toplamı vs örnek Next.js App Router tahmini — aynı ölçekte
 * iki bar + satır kırılımı. Next tarafı `estimate` ile gelir; uydurma
 * "ölçüldü" iddiası taşımaması için badge metni sözlükten gelir.
 *
 * @param {{ ours: { label: string, badge: string, totalGzip: number,
 *     entries: Array<{ label: string, gzip: number }> },
 *   next: { label: string, badge: string, totalGzip: number,
 *     entries: Array<{ label: string, gzip: number }>, note: string } }} props
 * @returns {string}
 */
export function weightContrast({ ours, next }) {
  const ceiling = Math.max(ours.totalGzip, next.totalGzip, 1);

  return `<div class="mt-10 grid gap-5 lg:grid-cols-2">
    ${weightPanel(ours, ceiling, "good")}
    ${weightPanel(next, ceiling, "bad")}
  </div>
  <p class="mt-4 m-0 max-w-3xl text-xs/5 text-slate-500 dark:text-slate-400">${esc(next.note)}</p>`;
}

/**
 * @param {{ label: string, badge: string, totalGzip: number,
 *   entries: Array<{ label: string, gzip: number }> }} panel
 * @param {number} ceiling
 * @param {'good' | 'bad'} tone
 * @returns {string}
 */
function weightPanel(panel, ceiling, tone) {
  const shell =
    tone === "good"
      ? "border-cyan-200/80 dark:border-cyan-400/25"
      : "border-rose-200/80 dark:border-rose-400/25";
  const badge =
    tone === "good"
      ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
      : "bg-amber-500/15 text-amber-900 dark:text-amber-100";
  const fill =
    tone === "good"
      ? "bg-sky-500 dark:bg-sky-400"
      : "bg-rose-400/80 dark:bg-rose-500/70";
  const percent = Math.max(2, Math.round((panel.totalGzip / ceiling) * 100));

  const rows = panel.entries
    .map(
      (entry) => `<li class="flex items-baseline justify-between gap-4 text-sm">
        <span class="text-slate-600 dark:text-slate-300">${esc(entry.label)}</span>
        <span class="font-mono tabular-nums text-slate-500 dark:text-slate-400">${esc(formatBytes(entry.gzip))}</span>
      </li>`,
    )
    .join("");

  return `<article class="${cn("rounded-2xl border bg-white p-6 shadow-sm dark:bg-white/[0.035]", shell)}">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="m-0 text-sm font-semibold tracking-tight">${esc(panel.label)}</h3>
      <span class="${cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase", badge)}">${esc(panel.badge)}</span>
    </div>
    <p class="mt-4 mb-1 font-mono text-3xl font-bold tracking-tight tabular-nums">${esc(formatBytes(panel.totalGzip))}</p>
    <p class="m-0 text-xs text-slate-500 dark:text-slate-400">gzip · first-load client assets</p>
    <div class="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div class="${cn("bar-fill h-full rounded-full", fill)}" style="--bar: ${percent}%" data-bar="${percent}"></div>
    </div>
    <ul class="mt-5 grid list-none gap-2 border-t border-slate-200 p-0 pt-4 dark:border-white/10">${rows}</ul>
  </article>`;
}
