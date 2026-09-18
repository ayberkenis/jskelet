import { attrs, cn, esc } from "jskelet/html";
import { icon, link } from "jskelet/tags";

/**
 * `views/components/**` altındaki her named export otomatik olarak şablon
 * local'i olur; import gerekmez. Bileşenler EJS değil, HTML string döndüren
 * fonksiyonlar — aynı bileşen sayfada, partial'da ve fragment ucunda aynı
 * çıktıyı verir.
 */

/**
 * Şablonların `lib/` içinden import etme yolu yok; sözlükteki `%s` yer
 * tutucularını dolduran yardımcı bu yüzden buradan yeniden açılıyor.
 */
export { format } from "../../lib/content.js";

/**
 * Bölüm başlığı. Pazarlama sayfalarında en çok tekrarlanan blok; tek yerde
 * tutmak başlık hiyerarşisinin (h2 → h3) kaymasını da engelliyor.
 *
 * @param {{ eyebrow?: string, title: string, lead?: string, align?: 'left' | 'center' }} props
 * @returns {string}
 */
export function sectionHead({ eyebrow, title, lead, align = "left" }) {
  const centered = align === "center";

  return `<div class="${cn("max-w-3xl", centered && "mx-auto text-center")}">
    ${
      eyebrow
        ? `<p class="m-0 inline-flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-cyan-700 uppercase dark:text-brand-300">
          <span class="h-px w-5 bg-brand-500" aria-hidden="true"></span>${esc(eyebrow)}
        </p>`
        : ""
    }
    <h2 class="mt-3 text-3xl font-bold tracking-[-0.035em] text-balance sm:text-4xl">${esc(title)}</h2>
    ${
      lead
        ? `<p class="mt-4 text-base/7 text-slate-600 sm:text-lg/8 dark:text-slate-300">${esc(lead)}</p>`
        : ""
    }
  </div>`;
}

/**
 * @param {{ children: string, class?: string, as?: string }} props
 * @returns {string}
 */
export function card({ children, class: className, as = "div" }) {
  const attributes = attrs({
    class: cn(
      "rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-950/5 dark:border-white/10 dark:bg-white/[0.04]",
      className,
    ),
  });

  return `<${as}${attributes}>${children}</${as}>`;
}

/**
 * @param {{ icon?: string, title: string, body: string, hint?: string }} props
 * @returns {string}
 */
export function featureCard({ icon: iconName, title, body, hint }) {
  const glyph = iconName
    ? `<span class="inline-flex size-11 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-700 dark:border-brand-400/35 dark:bg-brand-400/10 dark:text-brand-300">${icon({ name: iconName, size: 22 })}</span>`
    : "";

  return card({
    as: "article",
    class:
      "group flex flex-col gap-4 transition duration-300 hover:-translate-y-1 hover:border-cyan-400/50 hover:shadow-xl hover:shadow-cyan-950/10 dark:hover:border-brand-400/40 dark:hover:shadow-brand-400/5",
    children: `${glyph}
      <h3 class="m-0 text-lg font-semibold tracking-tight">${esc(title)}</h3>
      <p class="m-0 text-sm/6 text-slate-600 dark:text-slate-300">${esc(body)}</p>
      ${
        hint
          ? `<span class="mt-auto pt-1 text-xs font-bold tracking-wide text-cyan-700 uppercase dark:text-brand-300">${esc(hint)}</span>`
          : ""
      }`,
  });
}

/**
 * @param {{ text: string, tone?: 'sky' | 'slate' | 'amber' }} props
 * @returns {string}
 */
export function pill({ text, tone = "slate" }) {
  const tones = {
    sky: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-brand-400/30 dark:bg-brand-400/10 dark:text-brand-300",
    slate:
      "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
    amber:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  };

  return `<span class="${cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", tones[tone])}">${esc(text)}</span>`;
}

/**
 * @param {{ href: string, text: string, variant?: 'primary' | 'ghost', icon?: string }} props
 * @returns {string}
 */
export function buttonLink({ href, text, variant = "primary", icon: iconName }) {
  const variants = {
    primary:
      "bg-brand-400 text-ink-950 shadow-lg shadow-brand-400/25 hover:-translate-y-0.5 hover:bg-brand-300 hover:shadow-brand-400/35",
    ghost:
      "border border-slate-300 bg-white/60 text-slate-800 hover:-translate-y-0.5 hover:border-cyan-400/50 hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:border-brand-400/40 dark:hover:bg-white/10",
  };

  return link({
    href,
    html: `${esc(text)}${iconName ? icon({ name: iconName, size: 16 }) : ""}`,
    class: cn(
      "inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition duration-200",
      variants[variant],
    ),
  });
}

/**
 * Kopyalanabilir kurulum satırı. Hero'da birincil CTA yanında durur; metinler
 * props ile gelir ki iki dilde ayrı bundle gerekmesin.
 *
 * @param {{ command: string, copy: { idle: string, done: string, failed: string } }} props
 * @returns {string}
 */
export function commandChip({ command, copy }) {
  return `<div class="inline-flex max-w-full items-center gap-2 rounded-xl border border-slate-300 bg-slate-950 px-3.5 py-2.5 font-mono text-sm text-slate-100 shadow-lg shadow-slate-950/20 dark:border-white/15 dark:bg-[#0a0f1c]">
    <span class="min-w-0 truncate"><span class="text-brand-400">$</span> ${esc(command)}</span>
    <button
      type="button"
      data-island="copy-command"
      data-island-props='${esc(
        JSON.stringify({
          text: command,
          done: copy.done,
          failed: copy.failed,
        }),
      )}'
      class="shrink-0 rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-[11px] font-sans font-medium text-slate-200 transition-colors hover:bg-white/20 hover:text-white"
      aria-label="${esc(copy.idle)}"
    >${esc(copy.idle)}</button>
  </div>`;
}

/**
 * Ölçümlü trust/stats şeridi. Değerler şablonda üretilir; burada yalnızca
 * biçimlenir — uydurma benchmark yok.
 *
 * @param {{ items: Array<{ icon?: string, value: string, label: string }> }} props
 * @returns {string}
 */
export function trustBar({ items }) {
  const cells = items
    .map(
      (item) => `<div class="trust-bar-item">
        ${
          item.icon
            ? `<span class="trust-bar-icon" aria-hidden="true">${icon({ name: item.icon, size: 18 })}</span>`
            : ""
        }
        <span class="min-w-0">
          <span class="trust-bar-value block truncate">${esc(item.value)}</span>
          <span class="trust-bar-label block">${esc(item.label)}</span>
        </span>
      </div>`,
    )
    .join("");

  return `<div class="trust-bar" role="list">${cells}</div>`;
}

/**
 * Kod bloğu + kopyalama island'ı. `code` ham metin olarak gelir ve `esc()`
 * üzerinden basılır; `<%- %>` ile basılan bir bileşende bunu atlamak doğrudan
 * XSS demek.
 *
 * Kopyalama düğmesinin üç durumu da props olarak island'a geçiyor: metin
 * client'ta üretilirse iki dilde iki ayrı bundle gerekirdi.
 *
 * @param {{ code: string, label?: string,
 *   copy?: { idle: string, done: string, failed: string } }} props
 * @returns {string}
 */
export function codeBlock({ code, label, copy: copyLabels }) {
  const head = label
    ? `<div class="border-b border-white/10 px-4 py-2 font-mono text-xs text-slate-400">${esc(label)}</div>`
    : "";

  const copy = copyLabels
    ? `<button
        type="button"
        data-island="copy-command"
        data-island-props='${esc(
          JSON.stringify({
            text: code,
            done: copyLabels.done,
            failed: copyLabels.failed,
          }),
        )}'
        class="absolute top-2 right-2 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-white/20 hover:text-white"
      >${esc(copyLabels.idle)}</button>`
    : "";

  return `<div class="relative overflow-hidden rounded-2xl border border-white/10 bg-[#090d1d] text-slate-100 shadow-2xl shadow-slate-950/20">
    ${head}
    ${copy}
    <pre class="m-0 overflow-x-auto p-4 font-mono text-[13px]/6"><code>${esc(code)}</code></pre>
  </div>`;
}
