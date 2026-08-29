/**
 * Build çıktısı varlıkların brotli/gzip kopyalarını üretir.
 *
 * Yalnızca `public/assets/` kapsanır: oradaki dosyalar hash'li ve `immutable`,
 * yani içerikleri hiç değişmiyor ve her istekte yeniden sıkıştırmak boşa CPU.
 * Build'de bir kez kalite 11 ile sıkıştırmak hem sunucu yükünü sıfırlar hem de
 * çalışma anında göze alınamayacak bir oran verir (istek anındaki kalite 5'e
 * karşı). `public/` altındaki elle konmuş dosyalar küçük ve seyrek istendiği
 * için çalışma anındaki sıkıştırmaya bırakılır.
 *
 * `server/middleware/static-precompressed.js` bu dosyaları servis eder.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { paths } from "../paths.mjs";
import * as log from "../../log.mjs";

/** Zaten sıkışık formatları (woff2, png, jpg, webp) tekrar sıkıştırmak anlamsız. */
const COMPRESSIBLE = /\.(?:css|js|mjs|svg|json|xml|txt|map)$/i;

/** Bu boyutun altında sıkıştırma kazancı başlık maliyetini karşılamıyor. */
const MIN_BYTES = 1024;

const BROTLI_OPTIONS = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
  },
};

/**
 * @param {string} dir
 * @returns {string[]}
 */
function collect(dir) {
  if (!fs.existsSync(dir)) return [];

  /** @type {string[]} */
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) files.push(...collect(full));
    else if (COMPRESSIBLE.test(entry.name)) files.push(full);
  }

  return files;
}

export async function precompressAssets() {
  // Önceki turdan kalan kopyalar kaynak değişince bayatlamasın.
  for (const file of collect(paths.assets)) {
    for (const ext of [".br", ".gz"]) {
      fs.rmSync(file + ext, { force: true });
    }
  }

  let count = 0;
  let saved = 0;

  for (const file of collect(paths.assets)) {
    const source = fs.readFileSync(file);
    if (source.length < MIN_BYTES) continue;

    const br = zlib.brotliCompressSync(source, BROTLI_OPTIONS);
    const gz = zlib.gzipSync(source, { level: 9 });

    fs.writeFileSync(`${file}.br`, br);
    fs.writeFileSync(`${file}.gz`, gz);

    count += 1;
    saved += source.length - br.length;
  }

  log.detail(`${count} files, ${log.size(saved)}`);
}
