/**
 * `views/components/**` altındaki tüm modülleri yükler ve named export'larını
 * tek bir nesnede birleştirir. Bu nesne EJS şablonlarına local olarak geçer,
 * böylece `<%- card({ … }) %>` gibi çağrılar import gerektirmeden çalışır.
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
 * @param {string} dir `views/components` dizininin mutlak yolu. Dizin yoksa
 *   boş nesne döner: bileşen kullanmayan bir proje de çalışmalı.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadComponents(dir) {
  if (!dir || !fs.existsSync(dir)) return {};

  /** @type {Record<string, unknown>} */
  const components = {};
  /** @type {Map<string, string>} */
  const origin = new Map();

  const barrel = path.join(dir, BARREL);
  const files = [
    ...(fs.existsSync(barrel) ? [barrel] : []),
    ...collect(dir).sort(),
  ];

  for (const file of files) {
    const relative = path.relative(dir, file).split(path.sep).join("/");
    const module = await import(pathToFileURL(file).href);

    for (const [name, value] of Object.entries(module)) {
      if (name === "default") continue;

      const previous = origin.get(name);
      if (previous && previous !== BARREL && previous !== relative) {
        console.warn(
          `[components] '${name}' is defined twice: ${previous} and ${relative} — the second one wins.`,
        );
      }

      components[name] = value;
      origin.set(name, relative);
    }
  }

  return components;
}
