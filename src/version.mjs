/**
 * Framework sürümü. `package.json`'dan okunur; paket bir kez yayınlandıktan
 * sonra sürümü iki yerde tutmak kaçınılmaz olarak birbirinden ayrılıyor.
 */
import fs from "node:fs";
import path from "node:path";
import { FRAMEWORK_ROOT } from "./config/index.js";

const manifest = (() => {
  try {
    const file = path.join(FRAMEWORK_ROOT, "package.json");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
})();

/** @type {string} */
export const FRAMEWORK_VERSION = manifest.version ?? "0.0.0";

/** Paket adı: sürüm kontrolü hangi kayıt defteri girdisine bakacağını buradan bilir. */
export const FRAMEWORK_PACKAGE = manifest.name ?? "jskelet";
