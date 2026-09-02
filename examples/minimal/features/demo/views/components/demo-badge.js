import { esc } from "jskelet/html";

/**
 * Feature-local bileşen — yalnızca demo feature'ının views/components altında.
 *
 * @param {{ label: string }} props
 * @returns {string}
 */
export function DemoBadge({ label }) {
  return `<span class="mt-4 inline-block rounded bg-zinc-100 px-2 py-1 text-sm">${esc(label)}</span>`;
}
