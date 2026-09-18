/**
 * Migrate (JSX/TSX → .jsk) için Babel — opsiyonel peer.
 *
 * Normal `build` / `start` / `dev` bunları indirmez. İlk parse anında paket
 * yoksa kurulum komutunu gösteren net bir hata verir.
 */
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { FRAMEWORK_ROOT } from "../config/index.js";

const MISSING =
  "`jskelet migrate` requires optional peer dependencies `@babel/parser` and `@babel/types`.\n" +
  "Install them in the project you are migrating:\n" +
  "  npm i -D @babel/parser @babel/types";

/**
 * @typedef {{
 *   parse: typeof import('@babel/parser').parse,
 *   types: typeof import('@babel/types'),
 * }} BabelApi
 */

/** @type {BabelApi | null | undefined} */
let cached;

/**
 * @param {string} [root] Hedef proje kökü (varsayılan: cwd).
 * @returns {BabelApi}
 */
export function getBabel(root = process.cwd()) {
  if (cached) return cached;
  if (cached === null) throw new Error(MISSING);

  for (const base of [root, FRAMEWORK_ROOT]) {
    try {
      const require = createRequire(path.join(base, "package.json"));
      const parser = require("@babel/parser");
      const types = require("@babel/types");
      cached = {
        parse: parser.parse.bind(parser),
        types,
      };
      return cached;
    } catch {
      // Sonraki köke bak.
    }
  }

  cached = null;
  throw new Error(MISSING);
}

/**
 * Migrate girişinde erken ve anlaşılır hata için.
 *
 * @param {string} [root]
 */
export function ensureBabel(root) {
  getBabel(root);
}

/**
 * `@babel/types` — ilk erişimde peer'ları yükler.
 * Metodlar doğru `this` ile bağlanır (`t.isIdentifier(node)`).
 *
 * @type {typeof import('@babel/types')}
 */
export const t = /** @type {typeof import('@babel/types')} */ (
  new Proxy(/** @type {object} */ ({}), {
    get(_target, prop) {
      // Promise thenable tuzağına düşmesin.
      if (prop === "then") return undefined;
      const types = getBabel().types;
      const value = Reflect.get(types, prop, types);
      return typeof value === "function" ? value.bind(types) : value;
    },
  })
);
