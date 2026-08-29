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
    "rounded-xl border p-5",
    tone === "sky"
      ? "border-sky-200 bg-sky-50/60 dark:border-sky-500/30 dark:bg-sky-500/5"
      : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40",
  )}">
    <p class="m-0 font-mono text-2xl font-semibold tabular-nums sm:text-3xl">${esc(value)}</p>
    <p class="mt-1 m-0 text-sm font-medium">${esc(label)}</p>
    ${note ? `<p class="mt-2 m-0 text-xs text-slate-500 dark:text-slate-400">${esc(note)}</p>` : ""}
  </div>`;
}

/**
 * Build çıktısının ölçülen boyutları. Manifest yoksa tablo yerine bir not
 * basılır — `jskelet build` çalıştırılmadan da sayfanın açılması gerekiyor.
 *
 * @param {{ entries: import('../../lib/payload.js').PayloadEntry[],
 *   total: import('../../lib/payload.js').PayloadEntry | null }} props
 * @returns {string}
 */
export function payloadTable({ entries, total }) {
  if (!entries.length) {
    return `<p class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      Build çıktısı bulunamadı, dolayısıyla ölçülecek dosya da yok.
      <code class="font-mono">jskelet build</code> çalıştırıldığında bu tablo
      sitenin gerçek varlık boyutlarıyla dolar. Sayfanın kendisi build olmadan
      da çalışmaya devam ediyor: manifest yoksa layout stylesheet etiketini hiç
      basmıyor.
    </p>`;
  }

  const rows = entries
    .map(
      (entry) => `<tr class="border-t border-slate-200 dark:border-slate-800">
        <td class="py-2.5 pr-4">${esc(entry.label)}</td>
        <td class="py-2.5 pr-4 font-mono text-right tabular-nums text-slate-500 dark:text-slate-400">${esc(formatBytes(entry.bytes))}</td>
        <td class="py-2.5 font-mono text-right tabular-nums font-semibold">${esc(formatBytes(entry.gzip))}</td>
      </tr>`,
    )
    .join("");

  const footer = total
    ? `<tr class="border-t-2 border-slate-300 dark:border-slate-700">
        <td class="py-2.5 pr-4 font-semibold">${esc(total.label)}</td>
        <td class="py-2.5 pr-4 font-mono text-right tabular-nums text-slate-500 dark:text-slate-400">${esc(formatBytes(total.bytes))}</td>
        <td class="py-2.5 font-mono text-right tabular-nums font-semibold">${esc(formatBytes(total.gzip))}</td>
      </tr>`
    : "";

  return `<div class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
    <table class="w-full text-sm">
      <caption class="border-b border-slate-200 px-4 py-3 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Bu sayfanın kendi build çıktısı, istek anında diskten okunup ölçüldü. Sağdaki sütun gzip sonrası. Island chunk'ları yalnızca ilgili element görünürlüğe girerse iner; ilk yükte hepsi indirilmez.
      </caption>
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
