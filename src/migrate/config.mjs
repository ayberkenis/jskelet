/**
 * next.config → jskelet.config.mjs taslağı.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findNextConfig, findClientEnvKeys } from "./fs-walk.mjs";

/**
 * @param {string} root
 * @returns {Promise<{ status: 'ok' | 'partial' | 'skipped', notes: string[], code: string | null }>}
 */
export async function draftConfig(root) {
  /** @type {string[]} */
  const notes = [];
  const configPath = findNextConfig(root);
  const clientEnv = findClientEnvKeys(root);

  /** @type {Record<string, unknown>} */
  let next = {};

  if (!configPath) {
    notes.push("no next.config.* — emitting minimal jskelet.config.mjs");
  } else if (configPath.endsWith(".ts")) {
    notes.push("next.config.ts cannot be imported — copy headers/redirects/rewrites manually");
  } else {
    try {
      const mod = await import(pathToFileURL(configPath).href);
      next = mod.default ?? mod;
      if (typeof next === "function") {
        next = await next({ default: {} });
      }
    } catch (error) {
      notes.push(
        `could not load next.config: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const trailingSlash = Boolean(next.trailingSlash);
  const deviceSizes =
    next.images && typeof next.images === "object" && Array.isArray(next.images.deviceSizes)
      ? next.images.deviceSizes
      : null;

  if (next.experimental) {
    notes.push("experimental.* has no JSkelet equivalent — ignored");
  }
  if (fs.existsSync(path.join(root, "middleware.ts")) || fs.existsSync(path.join(root, "middleware.js"))) {
    notes.push("middleware.ts/js → port to Express middleware manually");
  }

  const headersSrc = fnSource(next.headers, "headers", notes);
  const redirectsSrc = fnSource(next.redirects, "redirects", notes);
  const rewritesSrc = fnSource(next.rewrites, "rewrites", notes);

  const clientEnvList =
    clientEnv.length > 0
      ? clientEnv.map((k) => JSON.stringify(k)).join(", ")
      : "";

  const imagesBlock = deviceSizes
    ? `\n  images: {\n    widths: ${JSON.stringify(deviceSizes)},\n  },\n`
    : "";

  const code =
    `/**\n` +
    ` * Drafted by \`jskelet migrate config\` from ${configPath ? path.basename(configPath) : "defaults"}.\n` +
    ` * Review before use — complex path-to-regexp patterns are not supported.\n` +
    ` */\n` +
    `export default {\n` +
    `  brand: { lang: "en" },\n` +
    (trailingSlash ? `  trailingSlash: true,\n` : "") +
    (clientEnvList ? `  clientEnv: [${clientEnvList}],\n` : "") +
    imagesBlock +
    (headersSrc ? `\n  async headers() {\n${headersSrc}\n  },\n` : "") +
    (redirectsSrc ? `\n  async redirects() {\n${redirectsSrc}\n  },\n` : "") +
    (rewritesSrc ? `\n  async rewrites() {\n${rewritesSrc}\n  },\n` : "") +
    `\n  hooks: {\n` +
    `    metadata() {\n` +
    `      return {\n` +
    `        titleTemplate: "%s | Site",\n` +
    `        description: "",\n` +
    `      };\n` +
    `    },\n` +
    `    layoutContext() {\n` +
    `      return { bodyClass: "min-h-full" };\n` +
    `    },\n` +
    `    notFound() {\n` +
    `      return {\n` +
    `        view: "pages/not-found",\n` +
    `        metadata: { title: "Page not found", robots: { index: false } },\n` +
    `      };\n` +
    `    },\n` +
    `  },\n` +
    `};\n`;

  return {
    status: notes.length ? "partial" : "ok",
    notes,
    code,
  };
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {string[]} notes
 * @returns {string | null}
 */
function fnSource(value, name, notes) {
  if (typeof value !== "function") return null;
  try {
    const src = Function.prototype.toString.call(value);
    // "async headers() { ... }" or "headers() { ... }" or arrow
    const bodyMatch = src.match(/^[^{]*\{([\s\S]*)\}$/);
    if (!bodyMatch) {
      notes.push(`${name}() could not be inlined — copy manually`);
      return `    // TODO[jskelet-migrate]: paste ${name}() from next.config\n    return [];`;
    }
    return bodyMatch[1].replace(/^\n/, "").replace(/\n$/, "");
  } catch {
    notes.push(`${name}() could not be serialized`);
    return `    // TODO[jskelet-migrate]: paste ${name}() from next.config\n    return [];`;
  }
}
