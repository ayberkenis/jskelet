/**
 * `next/image` optimizer'ının build zamanı karşılığı.
 *
 * `public/` altındaki elle konmuş raster görseller (png/jpg) için birkaç
 * genişlikte webp üretir ve `images.json` manifest'ine yazar.
 * `views/helpers/tags.js` → `image()` bu manifest'e bakıp `srcset` + intrinsic
 * `width`/`height` ekler; çağıran taraf hiçbir şey değiştirmez.
 *
 * Çıktılar hash'li olarak `public/assets/img/` altına düşer, yani `immutable`
 * cache ve precompress kapsamına girerler. Kaynak dosyalar olduğu yerde kalır:
 * manifest'te olmayan bir görsel her zaman orijinaliyle servis edilir.
 *
 * Manifest'e kodlayıcı imzası (`webp-q78-e4`) yazılır. Kalite ayarı değişince
 * imza da değişir ve tüm görseller yeniden kodlanır; aksi hâlde eski ayarla
 * üretilmiş çıktılar sessizce kalırdı.
 */
import fs from "node:fs";
import path from "node:path";
import { hash, paths } from "../paths.mjs";
import * as log from "../../log.mjs";

const SOURCE = /\.(?:png|jpe?g)$/i;

/** Build çıktısı ve ikon setleri taranmaz. */
const DEFAULT_SKIP = ["assets", "fonts"];

/** Yaygın kırılma noktaları; kaynaktan büyük olanlar elenir. */
const DEFAULT_WIDTHS = [400, 640, 960, 1280, 1920];

/** Retina ekranlarda bile bunun üstü israf. */
const MAX_WIDTH = 1920;

/**
 * @typedef {{ width: number, height: number, hash: string,
 *   variants: { width: number, url: string }[] }} ImageEntry
 */

/**
 * @param {string} dir
 * @param {Set<string>} skip
 * @returns {string[]}
 */
function collect(dir, skip) {
  if (!fs.existsSync(dir)) return [];

  /** @type {string[]} */
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skip.has(entry.name)) continue;
      files.push(...collect(path.join(dir, entry.name), skip));
    } else if (SOURCE.test(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

/**
 * `…\public\hero\a.png` → `/hero/a.png`
 * @param {string} file
 * @returns {string}
 */
function publicUrl(file) {
  return `/${path.relative(paths.public, file).split(path.sep).join("/")}`;
}

/**
 * Üretilecek genişlikler: kaynaktan büyük olanlar atılır, kaynağın kendi
 * genişliği (MAX_WIDTH ile sınırlı) her zaman listeye girer.
 *
 * @param {number} intrinsic
 * @param {number[]} widths
 * @returns {number[]}
 */
function targetWidths(intrinsic, widths) {
  const capped = Math.min(intrinsic, MAX_WIDTH);
  const out = widths.filter((width) => width < capped);
  out.push(capped);
  return out;
}

/**
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @param {typeof import('sharp')} sharp
 * @returns {Promise<Record<string, string>>} Ana manifest'e katkı yok; görsel
 *   manifest'i ayrı dosyaya yazılır.
 */
export async function buildImages(config, sharp) {
  const widths = config.images?.widths ?? DEFAULT_WIDTHS;
  const quality = config.images?.quality ?? 78;
  const encoder = `webp-q${quality}-e4`;
  const webpOptions = { quality, effort: 4 };

  const skip = new Set([...DEFAULT_SKIP, ...(config.images?.skip ?? [])]);
  const manifestPath = path.join(paths.generated, "images.json");
  const outDir = path.join(paths.assets, "img");

  const sources = collect(paths.public, skip);
  if (!sources.length) {
    log.detail("no images, skipped");
    return {};
  }

  fs.mkdirSync(outDir, { recursive: true });

  /** @type {Record<string, ImageEntry>} */
  let cached = {};
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (data.encoder === encoder) cached = data.images;
  } catch {
    // Manifest yok ya da kodlayıcı değişti: hepsi yeniden kodlanır.
  }

  /** @type {Record<string, ImageEntry>} */
  const images = {};

  let encoded = 0;
  let sourceBytes = 0;
  let outputBytes = 0;

  /** @param {ImageEntry} entry */
  const variantBytes = (entry) =>
    entry.variants.reduce(
      (sum, variant) =>
        sum + fs.statSync(path.join(paths.public, variant.url.slice(1))).size,
      0,
    );

  for (const file of sources) {
    const url = publicUrl(file);
    const source = fs.readFileSync(file);
    const digest = hash(source);
    const previous = cached[url];

    // Kaynak değişmediyse ve çıktılar hâlâ yerindeyse yeniden kodlamak
    // boşa CPU; büyük bir public/ dizininde build süresini dakikalara çıkarır.
    if (
      previous?.hash === digest &&
      previous.variants.every((variant) =>
        fs.existsSync(path.join(paths.public, variant.url.slice(1))),
      )
    ) {
      images[url] = previous;
      sourceBytes += source.length;
      outputBytes += variantBytes(previous);
      continue;
    }

    try {
      const entry = await encode(sharp, {
        file,
        source,
        digest,
        widths,
        webpOptions,
        outDir,
      });
      if (!entry) continue;

      images[url] = entry;
      encoded += 1;
      sourceBytes += source.length;
      outputBytes += variantBytes(entry);
    } catch (error) {
      // Bozuk/okunamayan tek bir görsel build'i düşürmesin: manifest'te yer
      // almazsa orijinal dosya servis edilmeye devam eder.
      log.warn(`${url} could not be optimized (${error.message})`);
    }
  }

  pruneOutputs(
    outDir,
    new Set(
      Object.values(images).flatMap((entry) =>
        entry.variants.map((variant) => variant.url),
      ),
    ),
  );

  fs.mkdirSync(paths.generated, { recursive: true });
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ encoder, images }, null, 2)}\n`,
  );

  const total = Object.keys(images).length;
  const saved = sourceBytes - outputBytes;
  log.detail(
    `${total} images${encoded ? ` (${encoded} encoded)` : " (cached)"}, ` +
      `${log.size(Math.max(saved, 0))} saved`,
  );

  return {};
}

/**
 * Manifest'te artık geçmeyen eski çıktıları siler.
 *
 * @param {string} outDir
 * @param {Set<string>} keep public URL kümesi
 */
function pruneOutputs(outDir, keep) {
  if (!fs.existsSync(outDir)) return;
  for (const file of fs.readdirSync(outDir)) {
    if (!keep.has(`/assets/img/${file}`)) {
      fs.rmSync(path.join(outDir, file), { force: true });
    }
  }
}

/**
 * @param {typeof import('sharp')} sharp
 * @param {{ file: string, source: Buffer, digest: string, widths: number[],
 *   webpOptions: object, outDir: string }} job
 * @returns {Promise<ImageEntry | null>}
 */
async function encode(sharp, job) {
  const { width, height } = await sharp(job.source, { failOn: "none" }).metadata();
  if (!width || !height) return null;

  const base = path.basename(job.file, path.extname(job.file));

  /** @type {{ width: number, url: string }[]} */
  const variants = [];

  for (const target of targetWidths(width, job.widths)) {
    const buffer = await sharp(job.source, { failOn: "none" })
      .resize({ width: target, withoutEnlargement: true })
      .webp(job.webpOptions)
      .toBuffer();

    // Hash kaynak + genişlikten türetilir: aynı içerik her build'de aynı
    // dosya adını verir, `immutable` cache bayatlamaz.
    const fileName = `${base}-${target}.${hash(`${job.digest}:${target}`)}.webp`;
    fs.writeFileSync(path.join(job.outDir, fileName), buffer);
    variants.push({ width: target, url: `/assets/img/${fileName}` });
  }

  return { width, height, hash: job.digest, variants };
}
