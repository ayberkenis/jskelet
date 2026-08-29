import { esc } from "jskelet/html";

/**
 * Bileşenler EJS şablonu değil, HTML string döndüren fonksiyonlardır.
 * `views/components/**` altındaki her named export otomatik olarak şablon
 * local'i olur — barrel dosyası tutmak gerekmez.
 *
 * @param {{ items: string[] }} props
 * @returns {string}
 */
export function list({ items }) {
  if (!items?.length) return "";

  const rows = items
    .map((item) => `<li class="py-1">${esc(item)}</li>`)
    .join("");

  return `<ul class="mt-6 list-disc pl-6">${rows}</ul>`;
}
