import { cn, esc } from "jskelet/html";

const TONES = {
  good: "text-emerald-700 dark:text-emerald-300",
  bad: "text-rose-700 dark:text-rose-300",
  neutral: "text-slate-600 dark:text-slate-300",
};

const MARKS = { good: "+", bad: "−", neutral: "•" };

/**
 * Kıyaslama tablosu. Renk tek başına anlam taşımıyor: her hücrede ayrıca bir
 * işaret var, çünkü renk körlüğünde ve yazdırmada renk kayboluyor.
 *
 * @param {{ columns: string[], rows: Array<{ label: string,
 *   values: Array<{ text: string, tone: 'good' | 'bad' | 'neutral' }> }> }} props
 * @returns {string}
 */
export function compareTable({ columns, rows }) {
  const head = columns
    .map(
      (column, index) =>
        `<th scope="col" class="${cn(
          "px-4 py-3 text-left align-bottom text-xs font-semibold tracking-wide uppercase",
          index === 0
            ? "text-slate-900 dark:text-white"
            : "text-slate-500 dark:text-slate-400",
        )}">${esc(column)}</th>`,
    )
    .join("");

  const body = rows
    .map(
      (row) => `<tr class="border-t border-slate-200 align-top dark:border-slate-800">
        <th
          scope="row"
          class="compare-sticky bg-white px-4 py-3 text-left text-sm font-semibold whitespace-nowrap dark:bg-slate-950"
        >${esc(row.label)}</th>
        ${row.values
          .map(
            (value) => `<td class="px-4 py-3 text-sm">
              <span class="${cn("mr-1.5 font-mono font-semibold", TONES[value.tone])}" aria-hidden="true">${MARKS[value.tone]}</span>
              <span class="text-slate-700 dark:text-slate-200">${esc(value.text)}</span>
            </td>`,
          )
          .join("")}
      </tr>`,
    )
    .join("");

  return `<div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-950/5 dark:border-white/10 dark:bg-white/[0.025]">
    <table class="w-full min-w-[52rem] border-collapse">
      <thead class="bg-slate-50 dark:bg-slate-900/60">
        <tr><th scope="col" class="compare-sticky bg-slate-50 px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase dark:bg-slate-900/60">Ölçüt</th>${head}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

/**
 * @param {{ title: string, items: string[], tone: 'good' | 'bad' }} props
 * @returns {string}
 */
export function fitList({ title, items, tone }) {
  const mark = tone === "good" ? "+" : "−";
  const color =
    tone === "good"
      ? "border-emerald-200 dark:border-emerald-500/30"
      : "border-rose-200 dark:border-rose-500/30";

  return `<div class="${cn("rounded-2xl border bg-white p-7 shadow-sm dark:bg-white/[0.035]", color)}">
    <h3 class="m-0 text-lg font-semibold tracking-tight">${esc(title)}</h3>
    <ul class="mt-3 grid list-none gap-2 p-0 text-sm text-slate-700 dark:text-slate-200">
      ${items
        .map(
          (item) => `<li class="flex gap-2">
            <span class="${cn("font-mono font-semibold", TONES[tone])}" aria-hidden="true">${mark}</span>
            <span>${esc(item)}</span>
          </li>`,
        )
        .join("")}
    </ul>
  </div>`;
}

/**
 * Kaynak HTML kontrastı: Next tarzı gömülü JSON kirliliği vs düz sunucu HTML.
 * Sayı değil görsel kanıt — View Source'ta ne olmadığını göstermek için.
 *
 * @param {{ left: { label: string, badge: string, code: string, note: string },
 *   right: { label: string, badge: string, code: string, note: string } }} props
 * @returns {string}
 */
export function sourceContrast({ left, right }) {
  return `<div class="grid gap-5 lg:grid-cols-2">
    ${sourcePanel(left, "bad")}
    ${sourcePanel(right, "good")}
  </div>`;
}

/**
 * @param {{ label: string, badge: string, code: string, note: string }} panel
 * @param {'good' | 'bad'} tone
 * @returns {string}
 */
function sourcePanel(panel, tone) {
  const shell =
    tone === "good"
      ? "border-emerald-200/80 dark:border-emerald-400/25"
      : "border-rose-200/80 dark:border-rose-400/25";
  const badge =
    tone === "good"
      ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
      : "bg-rose-500/15 text-rose-800 dark:text-rose-200";

  return `<figure class="${cn("overflow-hidden rounded-2xl border bg-[#0b1020] shadow-xl shadow-slate-950/20", shell)}">
    <figcaption class="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <span class="font-mono text-xs font-semibold tracking-wide text-slate-200">${esc(panel.label)}</span>
      <span class="${cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase", badge)}">${esc(panel.badge)}</span>
    </figcaption>
    <pre class="m-0 overflow-x-auto p-4 font-mono text-[11px]/5 text-slate-300 sm:text-xs/6"><code>${esc(panel.code)}</code></pre>
    <p class="m-0 border-t border-white/10 px-4 py-3 text-xs/5 text-slate-400">${esc(panel.note)}</p>
  </figure>`;
}
