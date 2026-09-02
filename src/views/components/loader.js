/**
 * `views/components/**` (ve feature/shared köklerindeki eşleri) altındaki
 * tüm modülleri yükler ve named export'larını tek bir nesnede birleştirir.
 *
 * Elle bakılan bir barrel dosyası yok: yeni bir bileşen eklemek için dosyayı
 * oluşturmak yeterli.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Bileşen olmayan altyapı dosyaları. */
const SKIP_FILES = new Set(["loader.js", "index.js"]);

/**
 * Barrel önce, en düşük öncelikle yüklenir: tek amacı `lib/` yeniden
 * ihraçlarını şablon local'i yapmak. Bileşenlerin kendi dosyaları sonradan
 * gelip sessizce üzerine yazar.
 */
const BARREL = "index.js";

/**
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collect(full, out);
      continue;
    }

    if (!entry.name.endsWith(".js")) continue;
    if (SKIP_FILES.has(entry.name)) continue;

    out.push(full);
  }

  return out;
}

/**
 * Tek bir `components/` dizinini yükler.
 *
 * @param {string} dir
 * @param {Record<string, unknown>} components
 * @param {Map<string, string>} origin
 * @returns {Promise<void>}
 */
async function loadDir(dir, components, origin) {
  if (!dir || !fs.existsSync(dir)) return;

  const barrel = path.join(dir, BARREL);
  const files = [
    ...(fs.existsSync(barrel) ? [barrel] : []),
    ...collect(dir).sort(),
  ];

  for (const file of files) {
    const isBarrel = path.basename(file) === BARREL;
    // Kimlik mutlak yol — çoklu components kökünde göreli ad çakışmasın.
    const fileId = isBarrel ? BARREL : file.split(path.sep).join("/");
    const module = await import(pathToFileURL(file).href);

    for (const [name, value] of Object.entries(module)) {
      if (name === "default") continue;

      const previous = origin.get(name);
      // Barrel üzerine yazmak bilinçli; iki gerçek bileşen dosyası çakışması hata.
      if (previous && previous !== BARREL && previous !== fileId) {
        throw new Error(
          `[components] '${name}' is defined twice: ${previous} and ${fileId}`,
        );
      }

      components[name] = value;
      origin.set(name, fileId);
    }
  }
}

/**
 * @param {string | string[]} dirs Tek dizin veya çoklu kök (feature/shared).
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadComponents(dirs) {
  /** @type {Record<string, unknown>} */
  const components = {};
  /** @type {Map<string, string>} */
  const origin = new Map();

  const list = Array.isArray(dirs) ? dirs : [dirs];
  for (const dir of list) {
    await loadDir(dir, components, origin);
  }

  return components;
}
