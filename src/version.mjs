/**
 * Framework sürümü. `package.json`'dan okunur; paket bir kez yayınlandıktan
 * sonra sürümü iki yerde tutmak kaçınılmaz olarak birbirinden ayrılıyor.
 */
import fs from "node:fs";
import path from "node:path";
import { FRAMEWORK_ROOT } from "./config/index.js";

/** @type {string} */
export const FRAMEWORK_VERSION = (() => {
  try {
    const file = path.join(FRAMEWORK_ROOT, "package.json");
    return JSON.parse(fs.readFileSync(file, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
