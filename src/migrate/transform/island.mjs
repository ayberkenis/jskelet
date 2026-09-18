/**
 * `"use client"` → island `mount()` iskeleti.
 */
import path from "node:path";

/**
 * @typedef {{ status: 'ok' | 'partial' | 'skipped', notes: string[], code: string | null, islandName: string }} IslandResult
 */

/**
 * @param {string} code
 * @param {string} filename
 * @param {{ name?: string }} [options]
 * @returns {IslandResult}
 */
export function transformIsland(code, filename, options = {}) {
  const base = path.basename(filename).replace(/\.(jsx?|tsx?|mjs|cjs)$/, "");
  const islandName = options.name ?? camel(base);
  /** @type {IslandResult} */
  const result = {
    status: "partial",
    notes: [],
    code: null,
    islandName,
  };

  const hasHooks = /\buse(State|Effect|Memo|Callback|Ref|Context|Reducer)\s*\(/.test(code);
  if (hasHooks) {
    result.notes.push("hooks require a manual port into mount()");
  }
  if (!/["']use client["']/.test(code) && !hasHooks) {
    result.notes.push("no \"use client\" directive — treating as island candidate anyway");
  }

  result.code =
    `/**\n` +
    ` * Island migrated from ${filename.replace(/\\/g, "/")}\n` +
    ` * Register: registerAll({ ${islandName}: () => import("./${islandName}.js") })\n` +
    ` * Markup: <div data-island="${islandName}" data-island-props='{}'></div>\n` +
    ` */\n` +
    `/**\n` +
    ` * @param {HTMLElement} el\n` +
    ` * @param {Record<string, unknown>} [props]\n` +
    ` */\n` +
    `export function mount(el, props = {}) {\n` +
    `  // TODO[jskelet-migrate]: port client logic from ${path.basename(filename)}\n` +
    (hasHooks
      ? `  // Original file used React hooks — rewrite with plain DOM + events.\n`
      : "") +
    `  el.textContent = "";\n` +
    `  void props;\n` +
    `}\n`;

  return result;
}

/**
 * @param {string} name
 * @returns {string}
 */
function camel(name) {
  return name
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
}
