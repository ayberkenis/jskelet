import { esc } from "jskelet/html";

/**
 * Bileşenler HTML string döndüren fonksiyonlardır. `.jsk` içinde
 * `<List :items="items" />`, EJS içinde `<%- list({ items }) %>` — named
 * export otomatik local olur.
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
