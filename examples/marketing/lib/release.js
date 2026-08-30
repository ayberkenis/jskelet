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
const SPEC = "jskelet";

/**
 * Komutlar paket belirtecini tek yerden paylaşıyor: kurulum satırı hem indirme
 * sayfasında hem sürüm geçmişinde geçiyor ve ikisinin ayrışmaması gerekiyor.
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

/** npm'deki `latest` etiketi; altı saatte birden fazla sorulmuyor. */
const REGISTRY_TTL = 6 * 60 * 60 * 1000;

/** @type {{ version: string | null, at: number } | null} */
let published = null;

/**
 * npm'de yayınlanmış son sürüm. Kurulu sürümle karşılaştırılıyor: sitenin
 * gösterdiği paketin gerçekten yayındaki paket olduğunu görmenin tek yolu.
 *
 * Kayıt defterine ulaşılamazsa `null` döner ve sayfa o satırı hiç basmaz —
 * ağı olmayan bir kurulumda sürüm sayfası yine açılmalı. Sonuç render sırasında
 * bir kez alınıp altı saat saklanıyor; HTML cache zaten sayfayı tuttuğu için
 * pratikte istek başına ağ trafiği yok.
 *
 * @returns {Promise<{ version: string, newer: boolean } | null>}
 */
export async function getPublishedRelease() {
  if (!published || Date.now() - published.at > REGISTRY_TTL) {
    published = { version: await fetchLatest(), at: Date.now() };
  }

  if (!published.version) return null;

  return {
    version: published.version,
    newer: isNewer(published.version, getRelease().version),
  };
}

/**
 * @returns {Promise<string | null>}
 */
async function fetchLatest() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`https://registry.npmjs.org/${SPEC}/latest`, {
      signal: controller.signal,
      headers: { accept: "application/vnd.npm.install-v1+json, application/json" },
    });

    if (!response.ok) return null;

    const body = await response.json();
    return typeof body?.version === "string" ? body.version : null;
  } catch {
    // Ağ yok, kayıt defteri kapalı ya da zaman aşımı.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Yalnızca major/minor/patch karşılaştırılır; ön sürüm etiketleri `latest`
 * altında yayınlanmadığı için pratikte gelmiyor.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean} a, b'den yeni mi
 */
function isNewer(a, b) {
  const parse = (value) =>
    String(value)
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);

  const left = parse(a);
  const right = parse(b);

  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff) return diff > 0;
  }

  return false;
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
