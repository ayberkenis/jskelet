import { esc } from "../../../../../src/views/helpers/html.js";

/**
 * @param {{ items: string[] }} props
 * @returns {string}
 */
export function list({ items }) {
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}
