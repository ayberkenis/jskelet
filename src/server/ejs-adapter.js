/**
 * Legacy EJS şablon motoru — opsiyonel peer.
 *
 * `.jsk`-only uygulamalar `ejs` kurmadan çalışır. Bir `.ejs` view veya layout
 * istendiğinde bu modül uygulamadan (yoksa framework'ten) `ejs` yükler;
 * paket yoksa göç yolunu gösteren net bir hata verir.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { getConfig, FRAMEWORK_ROOT } from "../config/index.js";
import { tryImportFromApp } from "../build/resolve-peer.mjs";

/** @type {import('ejs') | null | undefined} */
let cached;

const MISSING =
  "EJS templates require the optional peer dependency `ejs`. " +
  "Install it (`npm i ejs`) or migrate the template to `.jsk`.";

/**
 * @returns {Promise<import('ejs')>}
 */
export async function loadEjs() {
  if (cached) return cached;
  if (cached === null) throw new Error(MISSING);

  const config = getConfig();
  let mod = await tryImportFromApp(config.root, "ejs");

  // Framework kendi test/dev ortamında peer olarak tutuyor olabilir.
  if (!mod) {
    try {
      const require = createRequire(path.join(FRAMEWORK_ROOT, "package.json"));
      mod = await import(pathToFileURL(require.resolve("ejs")).href);
    } catch {
      mod = null;
    }
  }

  if (!mod) {
    cached = null;
    throw new Error(MISSING);
  }

  cached = /** @type {import('ejs')} */ (mod.default ?? mod);
  return cached;
}

/**
 * @param {string} file
 * @param {Record<string, unknown>} data
 * @param {object} options
 * @returns {Promise<string>}
 */
export async function renderEjsFile(file, data, options) {
  const ejs = await loadEjs();
  return ejs.renderFile(file, data, options);
}
