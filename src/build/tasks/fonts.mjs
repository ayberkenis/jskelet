/**
 * `next/font/google` yerine self-host font dosyaları.
 *
 * Dosyalar `public/fonts/` altında **sabit isimlerle** durur (hash yok), çünkü
 * `@font-face` içindeki `url()` yolları elle yazılıyor; hash'lemek her build'de
 * stylesheet'i de değiştirmek zorunda bırakırdı.
 *
 * Dosya yoksa bir kez Google Fonts'tan indirilir ve **commit edilmesi
 * beklenir**: build'in ağa bağımlı olması CI'da kırılgan. İndirme başarısız
 * olursa uyarı basılır ve sayfa sistem font yığınına düşer — build durmaz.
 *
 * Yapılandırma:
 *   fonts: [{ family: "Inter", weights: [400, 700] }]
 * Çıktı: `public/fonts/inter-400.woff2`, manifest anahtarı aynı dosya adı.
 */
import fs from "node:fs";
import path from "node:path";
import * as log from "../../log.mjs";

/** woff2 döndürmesi için modern tarayıcı UA'sı gerekir. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * @param {string} family
 * @returns {string}
 */
function toSlug(family) {
  return family.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * @param {string} family
 * @param {number[]} weights
 * @returns {string}
 */
function cssUrl(family, weights) {
  const name = family.trim().replace(/\s+/g, "+");
  const wght = [...weights].sort((a, b) => a - b).join(";");
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${wght}&display=swap`;
}

/**
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @returns {Promise<Record<string, string>>}
 */
export async function copyFonts(config) {
  const fontsDir = config.dirs.fonts;
  fs.mkdirSync(fontsDir, { recursive: true });

  /** @type {Record<string, string>} */
  const manifest = {};
  let expected = 0;

  for (const family of config.fonts) {
    const slug = family.slug ?? toSlug(family.family);
    const weights = family.weights ?? [400];
    expected += weights.length;

    /** @type {number[]} */
    const missing = [];

    for (const weight of weights) {
      const fileName = `${slug}-${weight}.woff2`;
      if (fs.existsSync(path.join(fontsDir, fileName))) {
        manifest[fileName] = `/fonts/${fileName}`;
        continue;
      }
      missing.push(weight);
    }

    if (!missing.length) continue;

    const downloaded = await downloadFromGoogle(
      cssUrl(family.family, missing),
      missing,
    );

    for (const [weight, buffer] of downloaded) {
      const fileName = `${slug}-${weight}.woff2`;
      fs.writeFileSync(path.join(fontsDir, fileName), buffer);
      manifest[fileName] = `/fonts/${fileName}`;
      log.detail(`${fileName} downloaded (${log.size(buffer.byteLength)})`);
    }

    const stillMissing = missing.filter(
      (weight) => !manifest[`${slug}-${weight}.woff2`],
    );
    if (stillMissing.length) {
      log.warn(
        `${family.family} ${stillMissing.join(", ")} could not be downloaded — falling back to the system font stack.`,
      );
    }
  }

  log.summary(`${Object.keys(manifest).length}/${expected} weights`);
  return manifest;
}

/**
 * Google'ın döndürdüğü CSS'te her ağırlık ve her subset için ayrı bir
 * `@font-face` bloğu var. Latin subset'i (`U+0000-00FF`) seçilir: diğerleri
 * çoğu site için ölü ağırlık ve `unicode-range` olmadan hepsini indirmek
 * font boyutunu katlar.
 *
 * @param {string} url
 * @param {number[]} weights
 * @returns {Promise<[number, Buffer][]>}
 */
async function downloadFromGoogle(url, weights) {
  /** @type {[number, Buffer][]} */
  const out = [];

  let css;
  try {
    const response = await fetch(url, { headers: { "User-Agent": UA } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    css = await response.text();
  } catch (error) {
    log.warn(`could not fetch Google Fonts CSS (${error.message})`);
    return out;
  }

  const blocks = css.split("@font-face").slice(1);

  for (const weight of weights) {
    const block = blocks.find(
      (candidate) =>
        candidate.includes(`font-weight: ${weight}`) &&
        candidate.includes("U+0000-00FF"),
    );
    const fileUrl = block?.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    if (!fileUrl) continue;

    try {
      const response = await fetch(fileUrl, { headers: { "User-Agent": UA } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      out.push([weight, Buffer.from(await response.arrayBuffer())]);
    } catch (error) {
      log.warn(`${weight} could not be downloaded (${error.message})`);
    }
  }

  return out;
}
