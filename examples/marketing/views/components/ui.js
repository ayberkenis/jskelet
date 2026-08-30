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
        ? `<p class="m-0 inline-flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-cyan-700 uppercase dark:text-cyan-300">
          <span class="h-px w-5 bg-cyan-500" aria-hidden="true"></span>${esc(eyebrow)}
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
      "rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-950/5 dark:border-white/10 dark:bg-white/[0.035]",
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
    ? `<span class="inline-flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-100 to-indigo-100 text-cyan-700 ring-1 ring-cyan-600/10 dark:from-cyan-400/15 dark:to-indigo-400/15 dark:text-cyan-300 dark:ring-white/10">${icon({ name: iconName, size: 22 })}</span>`
    : "";

  return card({
    as: "article",
    class: "group flex flex-col gap-4 transition duration-300 hover:-translate-y-1 hover:border-cyan-400/50 hover:shadow-xl hover:shadow-cyan-950/5",
    children: `${glyph}
      <h3 class="m-0 text-lg font-semibold tracking-tight">${esc(title)}</h3>
      <p class="m-0 text-sm/6 text-slate-600 dark:text-slate-300">${esc(body)}</p>
      ${
        hint
          ? `<span class="mt-auto pt-1 text-xs font-bold tracking-wide text-cyan-700 uppercase dark:text-cyan-300">${esc(hint)}</span>`
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
    sky: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
    slate:
      "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
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
      "bg-slate-950 text-white shadow-lg shadow-slate-950/15 hover:-translate-y-0.5 hover:bg-cyan-700 hover:shadow-cyan-700/20 dark:bg-cyan-300 dark:text-slate-950 dark:hover:bg-white",
    ghost:
      "border border-slate-300 bg-white/60 text-slate-800 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10",
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
