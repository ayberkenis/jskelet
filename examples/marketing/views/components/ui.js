import { attrs, cn, esc } from "jskelet/html";
import { icon, link } from "jskelet/tags";

/**
 * `views/components/**` altındaki her named export otomatik olarak şablon
 * local'i olur; import gerekmez. Bileşenler EJS değil, HTML string döndüren
 * fonksiyonlar — aynı bileşen sayfada, partial'da ve fragment ucunda aynı
 * çıktıyı verir.
 */

/**
 * Bölüm başlığı. Pazarlama sayfalarında en çok tekrarlanan blok; tek yerde
 * tutmak başlık hiyerarşisinin (h2 → h3) kaymasını da engelliyor.
 *
 * @param {{ eyebrow?: string, title: string, lead?: string, align?: 'left' | 'center' }} props
 * @returns {string}
 */
export function sectionHead({ eyebrow, title, lead, align = "left" }) {
  const centered = align === "center";

  return `<div class="${cn("max-w-2xl", centered && "mx-auto text-center")}">
    ${
      eyebrow
        ? `<p class="m-0 text-xs font-semibold tracking-[0.18em] text-sky-600 uppercase dark:text-sky-400">${esc(eyebrow)}</p>`
        : ""
    }
    <h2 class="mt-2 text-2xl font-bold tracking-tight text-balance sm:text-3xl">${esc(title)}</h2>
    ${
      lead
        ? `<p class="mt-3 text-base/7 text-slate-600 dark:text-slate-300">${esc(lead)}</p>`
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
      "rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900/40",
      className,
    ),
  });

  return `<${as}${attributes}>${children}</${as}>`;
}

/**
 * @param {{ icon?: string, title: string, body: string }} props
 * @returns {string}
 */
export function featureCard({ icon: iconName, title, body }) {
  const glyph = iconName
    ? `<span class="inline-flex size-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">${icon({ name: iconName, size: 20 })}</span>`
    : "";

  return card({
    as: "article",
    class: "flex flex-col gap-3",
    children: `${glyph}
      <h3 class="m-0 text-base font-semibold">${esc(title)}</h3>
      <p class="m-0 text-sm/6 text-slate-600 dark:text-slate-300">${esc(body)}</p>`,
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
      "bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200",
    ghost:
      "border border-slate-300 text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800",
  };

  return link({
    href,
    html: `${esc(text)}${iconName ? icon({ name: iconName, size: 16 }) : ""}`,
    class: cn(
      "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
      variants[variant],
    ),
  });
}

/**
 * Kod bloğu + kopyalama island'ı. `code` ham metin olarak gelir ve `esc()`
 * üzerinden basılır; `<%- %>` ile basılan bir bileşende bunu atlamak doğrudan
 * XSS demek.
 *
 * @param {{ code: string, label?: string, copyable?: boolean }} props
 * @returns {string}
 */
export function codeBlock({ code, label, copyable = false }) {
  const head = label
    ? `<div class="border-b border-slate-800 px-4 py-2 font-mono text-xs text-slate-400">${esc(label)}</div>`
    : "";

  const copy = copyable
    ? `<button
        type="button"
        data-island="copy-command"
        data-island-props='${esc(JSON.stringify({ text: code }))}'
        class="absolute top-2 right-2 rounded-md border border-slate-700 bg-slate-900/80 px-2 py-1 text-xs text-slate-300 hover:text-white"
      >kopyala</button>`
    : "";

  return `<div class="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-100">
    ${head}
    ${copy}
    <pre class="m-0 overflow-x-auto p-4 font-mono text-[13px]/6"><code>${esc(code)}</code></pre>
  </div>`;
}
