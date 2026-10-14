/**
 * Tek build girişi: fontlar → ikon sprite → CSS → client JS → görseller →
 * manifest → precompress → (opsiyonel) S3 asset upload.
 *
 * Sıra rastgele değil. CSS Tailwind için şablonları tarar, bu yüzden ikon
 * sprite'ından sonra gelir (sprite bir varlık, sınıf üretmez ama manifest
 * anahtarı verir). Precompress upload'tan önce: origin hâlâ `.br` üretir;
 * S3 adımı ham dosyaları kopyalar. Upload yalnızca `build.assets.upload`
 * açıksa ve watch değilse çalışır.
 *
 * Görevler yalnızca ilgili yapılandırma varsa çalışır. Font tanımlamayan bir
 * proje font adımını hiç görmez; bu, "framework her projeye kendi
 * varsayımlarını dayatmaz" ilkesinin build tarafındaki karşılığı.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadConfig } from "../config/index.js";
import { initBuildPaths, paths, writeManifest } from "./paths.mjs";
import * as log from "../log.mjs";
import { FRAMEWORK_VERSION } from "../version.mjs";

const watch = process.argv.includes("--watch");

// Dev script'i banner'ı ve "Ready" özetini kendisi basar; alt süreçte
// yalnızca build satırları görünür.
const child = Boolean(process.env.JSKELET_CHILD);

const config = await loadConfig();
initBuildPaths(config);

const started = Date.now();

if (!child) {
  log.banner(
    `v${FRAMEWORK_VERSION}`,
    watch ? "build · watch" : "production build",
    config.root,
  );
}

log.section("build");

// Şablonlar asset taramasından önce derlenir; istek anında parse yok.
await task("Templates", async () => {
  const { buildTemplates } = await import("./tasks/templates.mjs");
  await buildTemplates(config);
});

/** @type {Record<string, string>} */
const manifest = {};

/**
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
async function task(label, run) {
  const step = log.task(label);
  try {
    const result = await run();
    step.done();
    return result;
  } catch (error) {
    step.fail(error);
    throw error;
  }
}

// Fonts ve icon sprite birbirine bağlı değil — paralel.
{
  /** @type {Promise<Record<string, string> | void>[]} */
  const parallel = [];
  if (config.fonts?.length) {
    parallel.push(
      (async () => {
        const { copyFonts } = await import("./tasks/fonts.mjs");
        return task("Fonts", () => copyFonts(config));
      })(),
    );
  }
  if (config.icons !== false) {
    parallel.push(
      (async () => {
        const { buildIconSprite } = await import("./tasks/icons.mjs");
        return task("Icon sprite", () => buildIconSprite(config));
      })(),
    );
  }
  for (const part of await Promise.all(parallel)) {
    if (part) Object.assign(manifest, part);
  }
}

if (fs.existsSync(config.dirs.styles)) {
  const { buildCss } = await import("./tasks/css.mjs");
  Object.assign(manifest, await task("CSS", () => buildCss(config, { watch })));
} else {
  log.warn(
    `no stylesheet entry: ${path.relative(config.root, config.dirs.styles)} — CSS step skipped`,
  );
}

const { buildClient } = await import("./tasks/client.mjs");
Object.assign(manifest, await task("Client JS", () => buildClient(config, { watch })));

// Görsel optimizasyonu `sharp` gerektirir ve watch turunda pahalı. Paket
// kurulu değilse adım sessizce atlanır: `image()` orijinal dosyaya döner,
// sayfa çalışmaya devam eder.
if (config.images !== false && !watch) {
  const { tryImportFromApp } = await import("./resolve-peer.mjs");
  const sharp = await tryImportFromApp(config.root, "sharp");
  if (sharp) {
    const { buildImages } = await import("./tasks/images.mjs");
    await task("Images", () => buildImages(config, sharp.default));
  }
}

writeManifest(manifest);

// Watch modunda her değişiklikte kalite-11 brotli çalıştırmak yavaş; yalnızca
// tek seferlik build'de üretilir.
if (!watch) {
  const { precompressAssets } = await import("./tasks/precompress.mjs");
  await task("Precompress", precompressAssets);

  // Her production build'de satır görünür; kapalıysa `skipped (sebep)`.
  // CDN'e basılacak dosyalar precompress'ten sonra hazır; `.br`/`.gz` yüklenmez.
  {
    const { uploadAssets } = await import("./tasks/assets-upload.mjs");
    await task("Assets upload", () => uploadAssets(config));
  }

  log.section("output");
  for (const row of manifestRows()) log.line(row);
}

if (child) {
  // Dev script'i "Ready" özetini build bitmeden basmasın diye işaret satırı.
  process.stdout.write("[jskelet:build-ready]\n");
} else {
  log.ready({
    elapsed: Date.now() - started,
    watching: watch,
    label: watch ? "Ready" : "Built",
  });
}

/**
 * Manifest'teki her varlığın ham ve brotli boyutu.
 * @returns {string[]}
 */
function manifestRows() {
  return Object.entries(manifest)
    .map(([name, url]) => {
      const file = path.join(paths.public, url.replace(/^\//, ""));
      const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
      const brotli = fs.existsSync(`${file}.br`) ? fs.statSync(`${file}.br`).size : 0;
      return { name, bytes, brotli };
    })
    .sort((a, b) => b.bytes - a.bytes)
    .map(
      (item) =>
        `${item.name.padEnd(22)}${log.size(item.bytes).padStart(9)}` +
        `${item.brotli ? `${log.size(item.brotli).padStart(11)} br` : ""}`,
    );
}
