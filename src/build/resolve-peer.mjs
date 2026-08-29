/**
 * Opsiyonel peer bağımlılıklarını **uygulamanın** node_modules'ünden yükler.
 *
 * Framework `file:` ya da workspace bağlantısıyla kuruluysa kaynak dosyaları
 * kendi dizininde çalışır ve düz bir `import "postcss"` framework'ün
 * node_modules'üne bakar — uygulamanınkine değil. Tailwind/PostCSS/sharp gibi
 * paketler uygulamanın devDependency'si olduğu için çözümlemeyi uygulama
 * kökünden başlatmak zorundayız.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * @param {string} root Uygulama kökü.
 * @param {string} specifier
 * @returns {Promise<any>}
 * @throws Paket bulunamazsa; zorunlu bağımlılıklar için.
 */
export async function importFromApp(root, specifier) {
  const require = createRequire(path.join(root, "package.json"));
  return import(pathToFileURL(require.resolve(specifier)).href);
}

/**
 * @param {string} root
 * @param {string} specifier
 * @returns {Promise<any | null>} Paket yoksa `null`; adım atlanabilsin diye.
 */
export async function tryImportFromApp(root, specifier) {
  try {
    return await importFromApp(root, specifier);
  } catch {
    return null;
  }
}
