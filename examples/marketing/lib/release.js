import fs from "node:fs";
import path from "node:path";

import { getConfig } from "jskelet";

/**
 * Sürüm ve indirme bilgisi. `payload.js` ile aynı ilke: sayfada görünen hiçbir
 * değer elle yazılmıyor, kurulu paketin `package.json`'ı okunuyor. Böylece
 * framework'ün sürümü yükseldiğinde site kendiliğinden güncel oluyor.
 *
 * Yol hesabı `getConfig().root` üzerinden: `../..` sayan bir satır, paket
 * `node_modules/` içine girdiğinde ya da örnek başka bir yere kopyalandığında
 * bozulur.
 */

/**
 * @typedef {{ name: string, range: string }} Dependency
 *
 * @typedef {object} Release
 * @property {string} version Kurulu sürüm
 * @property {string} license
 * @property {string} node `engines.node` aralığı
 * @property {string} nodeLabel Görüntü için sadeleştirilmiş hâli: `22+`
 * @property {Dependency[]} dependencies Zorunlu çalışma zamanı bağımlılıkları
 * @property {Dependency[]} optional Opsiyonel peer bağımlılıklar
 * @property {string} repository
 * @property {string} spec `npm install` için paket belirteci
 * @property {boolean} measured `package.json` gerçekten okunabildi mi
 */

const REPOSITORY = "https://github.com/ayberkenis/jskelet";
const SPEC = "github:ayberkenis/jskelet";

/**
 * Paket npm'de olmadığı için kurulum git üzerinden yapılıyor; komutlar bu
 * belirteci paylaşıyor ve tek yerde duruyor.
 */
export const COMMANDS = {
  install: `npm install ${SPEC}`,
  init: "npx jskelet init",
  dev: "npx jskelet dev",
  build: "npx jskelet build",
  start: "npx jskelet start",
};

/** @type {Release | null} */
let memo = null;

/**
 * Kurulu framework sürümünün künyesi.
 *
 * @returns {Release}
 */
export function getRelease() {
  if (memo) return memo;

  const manifest = readPackage();

  const version = typeof manifest.version === "string" ? manifest.version : "0.0.0";
  const node =
    typeof manifest.engines?.node === "string" ? manifest.engines.node : ">=22";

  memo = {
    version,
    license: typeof manifest.license === "string" ? manifest.license : "MIT",
    node,
    nodeLabel: `${node.replace(/[^\d.]/g, "")}+`,
    dependencies: toList(manifest.dependencies),
    optional: toList(manifest.peerDependencies),
    repository: REPOSITORY,
    spec: SPEC,
    measured: Boolean(manifest.version),
  };

  return memo;
}

/**
 * @param {Record<string, string> | undefined} record
 * @returns {Dependency[]}
 */
function toList(record) {
  if (!record) return [];

  return Object.entries(record)
    .map(([name, range]) => ({ name, range }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @returns {Record<string, any>}
 */
function readPackage() {
  // `require.resolve("jskelet/package.json")` çalışmaz: `exports` haritasında
  // `./package.json` girdisi yok ve Node bunu bilinçli olarak reddediyor.
  const file = path.join(
    getConfig().root,
    "node_modules",
    "jskelet",
    "package.json",
  );

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Kurulum yapılmamış ya da paket başka bir yerden çözülüyor olabilir.
    // Sayfa yine açılmalı; `measured: false` ile bunu işaretliyoruz.
    return {};
  }
}
