/** HTML üretimi için ortak yardımcılar (React'in kaçış davranışının karşılığı). */
import { twMerge } from "tailwind-merge";

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Metin içeriği ve attribute değerleri için kaçış.
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
  if (value == null || value === false) return "";
  return String(value).replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
}

/**
 * `<script type="application/ld+json">` gövdesi için güvenli JSON.
 * `</script`, `<!--` ve U+2028/2029 kaçırılır.
 * @param {unknown} value
 * @returns {string}
 */
export function jsonScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Attribute nesnesini string'e çevirir. `false`/`null`/`undefined` atlanır,
 * `true` boolean attribute olarak yazılır.
 * @param {Record<string, unknown>} attrs
 * @returns {string}
 */
export function attrs(attrs) {
  const parts = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (value === true) {
      parts.push(key);
      continue;
    }
    parts.push(`${key}="${esc(value)}"`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/**
 * `clsx` karşılığı — koşullu sınıf birleştirme, çakışma çözümü yok.
 * @param {...unknown} inputs
 * @returns {string}
 */
export function cx(...inputs) {
  const out = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === "string" || typeof input === "number") {
      out.push(String(input));
      continue;
    }

    if (Array.isArray(input)) {
      const nested = cx(...input);
      if (nested) out.push(nested);
      continue;
    }

    if (typeof input === "object") {
      for (const [key, active] of Object.entries(input)) {
        if (active) out.push(key);
      }
    }
  }

  return out.join(" ");
}

/**
 * `lib/ui/cn.js` ile aynı davranış: birleştir, sonra Tailwind çakışmalarını çöz.
 *
 * `tailwind-merge` çalışma zamanı bağımlılığı olarak korunur çünkü sınıf
 * hesabı **yalnızca sunucuda** yapılır — client bundle'a hiç girmez, dolayısıyla
 * sayfa ağırlığına etkisi yoktur. Elle yazılmış bir grup tablosu ise
 * `border-2` + `border-transparent` gibi genişlik/renk çiftlerini birbirine
 * karıştırıp sınıf düşürdüğü için görsel regresyon üretiyordu.
 *
 * @param {...unknown} inputs
 * @returns {string}
 */
export function cn(...inputs) {
  return twMerge(cx(...inputs));
}
