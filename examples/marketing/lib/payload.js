import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { getConfig } from "jskelet";

/**
 * Sayfada gösterilen bayt sayıları uydurma olmasın diye, sitenin **kendi**
 * build çıktısı ölçülüyor: manifest'teki her varlık diskten okunup gzip'lenir.
 *
 * Neden gzip: brotli çıktısı build sırasında zaten üretiliyor ama her kurulumda
 * mevcut olacağının garantisi yok; gzip her Node'da var, dolayısıyla sayı
 * ortamlar arasında karşılaştırılabilir kalıyor.
 */

/** @typedef {{ name: string, label: string, bytes: number, gzip: number }} PayloadEntry */

/** @type {{ entries: PayloadEntry[], total: PayloadEntry | null } | null} */
let memo = null;

const LABELS = {
  "app.css": "Stylesheet (Tailwind v4 çıktısı)",
  "main.js": "Client entry (island yükleyicisi)",
  "sprite.svg": "İkon sprite",
};

/**
 * Build çıktısının ölçülen boyutları. Manifest yoksa boş liste döner; sayfa
 * bu durumda sayı yerine "build çalıştırılmamış" notunu gösterir.
 *
 * @returns {{ entries: PayloadEntry[], total: PayloadEntry | null }}
 */
export function getPayload() {
  // Prod'da build çıktısı süreç boyunca değişmiyor, o yüzden bir kez ölçülür.
  // Dev'de her restart yeni süreç olduğu için bayat kalma riski yok.
  if (memo) return memo;

  const { dirs } = getConfig();
  const manifest = readManifest(path.join(dirs.generated, "manifest.json"));

  /** @type {PayloadEntry[]} */
  const entries = [];

  for (const [name, label] of Object.entries(LABELS)) {
    const url = manifest[name];
    if (!url) continue;

    const file = path.join(dirs.public, url.replace(/^\//, ""));
    const measured = measure(file);
    if (measured) entries.push({ name, label, ...measured });
  }

  // Island'lar dinamik import ile indiği için manifest'te ayrı bir adı yok:
  // esbuild bunları chunk olarak yazıyor. Sayfanın "toplam ağırlığı" iddiası
  // bunları saymazsa fazla iyimser olur, o yüzden entry dışındaki chunk'lar
  // tek satırda toplanıyor.
  const chunks = measureIslandChunks(dirs.public, manifest["main.js"]);
  if (chunks) {
    entries.push({
      name: "islands",
      label: "Tüm island'lar (talep üzerine, ayrı chunk'lar)",
      ...chunks,
    });
  }

  const total = entries.length
    ? {
        name: "total",
        label: "Toplam — her island yüklenirse",
        bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
        gzip: entries.reduce((sum, entry) => sum + entry.gzip, 0),
      }
    : null;

  memo = { entries, total };
  return memo;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * @param {string} file
 * @returns {Record<string, string>}
 */
function readManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // Manifest yokluğu hata değil: `jskelet build` çalıştırılmamış olabilir.
    return {};
  }
}

/**
 * Entry'nin yanındaki diğer JS dosyaları: island chunk'ları ve paylaşılan
 * parçalar.
 *
 * @param {string} publicDir
 * @param {string | undefined} entryUrl
 * @returns {{ bytes: number, gzip: number } | null}
 */
function measureIslandChunks(publicDir, entryUrl) {
  if (!entryUrl) return null;

  const entryFile = path.join(publicDir, entryUrl.replace(/^\//, ""));
  const dir = path.dirname(entryFile);

  let bytes = 0;
  let gzip = 0;

  try {
    // Chunk'lar entry'nin yanındaki `chunks/` altına yazılıyor, o yüzden
    // tarama derinlemesine. `.map` dosyaları `.js` ile bitmediği için kendi
    // kendine dışarıda kalıyor.
    for (const entry of fs.readdirSync(dir, {
      withFileTypes: true,
      recursive: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;

      const file = path.join(entry.parentPath, entry.name);
      if (file === entryFile) continue;

      const measured = measure(file);
      if (!measured) continue;

      bytes += measured.bytes;
      gzip += measured.gzip;
    }
  } catch {
    return null;
  }

  return bytes ? { bytes, gzip } : null;
}

/**
 * @param {string} file
 * @returns {{ bytes: number, gzip: number } | null}
 */
function measure(file) {
  try {
    const buffer = fs.readFileSync(file);
    return { bytes: buffer.byteLength, gzip: gzipSync(buffer).byteLength };
  } catch {
    return null;
  }
}
