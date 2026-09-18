/**
 * SVG ikon sprite üretimi.
 *
 * Kaynak XOR seçilir: uygulama kökünde `icons/` (veya `icons.dir`) dizini
 * varsa yalnızca oradaki düz SVG'ler; yoksa `@phosphor-icons/core`. İkisi
 * birleştirilmez — boş bir `icons/` dizini Phosphor'a düşmez.
 *
 * Yalnızca kaynakta kullanılan ikonlar `<symbol>` olur. Tüm seti göndermek
 * 1500+ ikon, yani birkaç megabayt; kullanım taraması sprite'ı tipik olarak
 * 10-30 sembolde tutuyor. Çıktı `public/assets/` altında hash'li
 * `sprite.svg` olduğu için mevcut precompress kapsamına girer.
 *
 * Sembol id'si: `<kebab-name>-<weight>` (örn. `arrow-right-bold`).
 * Yerel dosya adı: `house.svg` → `house:regular`, `house-bold.svg` → `house:bold`.
 *
 * Tarama statik metin üzerinden yapıldığı için adı çalışma anında hesaplanan
 * bir `icon()` çağrısı sprite'a girmez. Bu yüzden ad taşıyan yapılandırma
 * alanları (`icon: "XLogo"`) da ayrıca aranır ve `views/helpers/tags.js`
 * dev'de eksik sembol için uyarır.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pruneAssets, writeAsset } from "../paths.mjs";
import * as log from "../../log.mjs";

const SCAN_EXTENSIONS = new Set([".ejs", ".jsk", ".js", ".mjs"]);

/** `icon({ … })` çağrısının tamamı; `name:` ifadesi ayrıca çözümlenir. */
const ICON_CALL = /icon\(\s*\{([^}]*)\}/g;
const ICON_NAME_EXPR = /name:\s*([^,}]+)/;
const ICON_WEIGHT = /weight:\s*["']([^"']+)["']/;
/** `data-icon="flag:fill"` ve JS nesnesindeki `"data-icon": "flag:fill"`. */
const ICON_ATTR = /data-icon"?\s*[:=]\s*["']([a-z0-9-]+)(?::([a-z]+))?["']/g;

/**
 * İkon adı `icon()` çağrısına değişkenle geldiğinde (ör. `name: item.icon`)
 * ad statik olarak görünmez. Bu tür adlar yapılandırma listelerinde
 * `icon: "XLogo"` / `iconName: "XLogo"` biçiminde durur; sprite'a girmezlerse
 * `<use>` boş kalır ve ikon görünmez.
 */
const ICON_NAME_PROP = /\b(?:icon|iconName)\s*[:=]\s*["']([A-Z][A-Za-z0-9]*)["']/g;

/** Adın içinden çıkarılabilecek sabitler: `"X"`, `cond ? "A" : "B"`. */
const QUOTED_NAME = /["']([A-Z][A-Za-z0-9]*)["']/g;

const WEIGHTS = new Set(["thin", "light", "regular", "bold", "fill", "duotone"]);

const DEFAULT_VIEWBOX = "0 0 256 256";

/**
 * `ArrowRightIcon` → `arrow-right`
 * @param {string} name
 * @returns {string}
 */
function toKebab(name) {
  return String(name)
    .replace(/Icon$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * Düz dizin dosya adı → `name` + `weight`.
 * `house.svg` / `house-regular.svg` → regular; `arrow-right-bold.svg` → bold.
 *
 * @param {string} fileName uzantılı veya uzantısız
 * @returns {{ name: string, weight: string } | null}
 */
export function parseIconFileName(fileName) {
  const base = String(fileName).replace(/\.svg$/i, "");
  if (!base) return null;

  let name = base;
  let weight = "regular";

  const dash = base.lastIndexOf("-");
  if (dash > 0) {
    const maybeWeight = base.slice(dash + 1);
    if (WEIGHTS.has(maybeWeight)) {
      name = base.slice(0, dash);
      weight = maybeWeight;
    }
  }

  // kebab: harf/rakam segmentleri, başta/sonda tire yok
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return null;

  return { name, weight };
}

/**
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @returns {string | null} mutlak dizin; yoksa veya dizin değilse null
 */
function resolveLocalIconsDir(config) {
  const relative = config.icons?.dir ?? "icons";
  const dir = path.resolve(config.root, relative);
  try {
    if (fs.statSync(dir).isDirectory()) return dir;
  } catch {
    // yok
  }
  return null;
}

/**
 * Paket, framework'ün değil **uygulamanın** node_modules'ünden çözülür:
 * ikon seti uygulamanın devDependency'si.
 *
 * @param {string} root
 * @returns {string | null}
 */
function resolveIconAssets(root) {
  const require = createRequire(path.join(root, "package.json"));

  // Paketin `exports` haritası `./package.json` alt yolunu açmıyor, bu yüzden
  // bilinen bir asset dosyası üzerinden çözülür.
  try {
    const probe = require.resolve(
      "@phosphor-icons/core/assets/regular/house.svg",
    );
    return path.dirname(path.dirname(probe));
  } catch {
    // exports kapalıysa klasörü doğrudan ara.
  }

  const direct = path.join(
    root,
    "node_modules",
    "@phosphor-icons",
    "core",
    "assets",
  );

  return fs.existsSync(direct) ? direct : null;
}

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function collectFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }

  return out;
}

/**
 * @param {string[]} scanDirs
 * @returns {Set<string>} `name:weight` çiftleri
 */
function scanUsedIcons(scanDirs) {
  /** @type {Set<string>} */
  const used = new Set();

  // Adı değişkenle gelen çağrıların ağırlıkları: dolaylı bulunan adlar
  // yalnızca bu ağırlıklarda üretilir, sprite gereksiz büyümez.
  /** @type {Set<string>} */
  const dynamicWeights = new Set();

  /** @type {Set<string>} */
  const indirectNames = new Set();

  for (const dir of scanDirs) {
    for (const file of collectFiles(dir)) {
      const source = fs.readFileSync(file, "utf8");

      for (const match of source.matchAll(ICON_CALL)) {
        const raw = match[1].match(ICON_WEIGHT)?.[1] ?? "regular";
        const weight = WEIGHTS.has(raw) ? raw : "regular";
        const expression = match[1].match(ICON_NAME_EXPR)?.[1] ?? "";
        const names = [...expression.matchAll(QUOTED_NAME)].map((m) => m[1]);

        if (!names.length) {
          dynamicWeights.add(weight);
          continue;
        }

        for (const name of names) used.add(`${toKebab(name)}:${weight}`);
      }

      for (const match of source.matchAll(ICON_NAME_PROP)) {
        indirectNames.add(toKebab(match[1]));
      }

      for (const match of source.matchAll(ICON_ATTR)) {
        const weight = match[2] ?? "regular";
        used.add(`${match[1]}:${WEIGHTS.has(weight) ? weight : "regular"}`);
      }
    }
  }

  if (!dynamicWeights.size) dynamicWeights.add("regular");

  for (const name of indirectNames) {
    for (const weight of dynamicWeights) used.add(`${name}:${weight}`);
  }

  return used;
}

/**
 * @param {string} svg
 * @returns {{ body: string, viewBox: string }}
 */
function parseSvgParts(svg) {
  const open = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const viewBox =
    open.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ||
    DEFAULT_VIEWBOX;
  const body = svg
    .replace(/^[\s\S]*?<svg[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "")
    .trim();
  return { body, viewBox };
}

/**
 * Düz `icons/` altındaki `*.svg` dosyalarından `name:weight` → parça haritası.
 *
 * @param {string} dir
 * @returns {Map<string, { body: string, viewBox: string }>}
 */
function indexLocalIcons(dir) {
  /** @type {Map<string, { body: string, viewBox: string }>} */
  const index = new Map();

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".svg") {
      continue;
    }

    const parsed = parseIconFileName(entry.name);
    if (!parsed) {
      log.warn(`icon file ignored (bad name) → ${entry.name}`);
      continue;
    }

    const key = `${parsed.name}:${parsed.weight}`;
    const svg = fs.readFileSync(path.join(dir, entry.name), "utf8");
    index.set(key, parseSvgParts(svg));
  }

  return index;
}

/**
 * @param {string} coreAssets
 * @param {string} name kebab
 * @param {string} weight
 * @returns {{ body: string, viewBox: string } | null}
 */
function readPhosphorIcon(coreAssets, name, weight) {
  const fileName = weight === "regular" ? `${name}.svg` : `${name}-${weight}.svg`;
  const filePath = path.join(coreAssets, weight, fileName);

  if (!fs.existsSync(filePath)) return null;

  return parseSvgParts(fs.readFileSync(filePath, "utf8"));
}

/**
 * @param {Map<string, { body: string, viewBox: string }>} index
 * @param {string} name
 * @param {string} weight
 * @returns {{ body: string, viewBox: string } | null}
 */
function readLocalIcon(index, name, weight) {
  const exact = index.get(`${name}:${weight}`);
  if (exact) return exact;

  // `house.svg` regular sayılır; tarama `house:regular` ister.
  if (weight === "regular") return index.get(`${name}:regular`) ?? null;

  return null;
}

/**
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @returns {Promise<Record<string, string>>}
 */
export async function buildIconSprite(config) {
  const localDir = resolveLocalIconsDir(config);
  /** @type {Map<string, { body: string, viewBox: string }> | null} */
  let localIndex = null;
  /** @type {string | null} */
  let coreAssets = null;

  if (localDir) {
    localIndex = indexLocalIcons(localDir);
    const rel = path.relative(config.root, localDir) || ".";
    log.detail(`icons from ${rel} (${localIndex.size} files)`);
  } else {
    coreAssets = resolveIconAssets(config.root);
    if (!coreAssets) {
      log.detail("@phosphor-icons/core not installed, skipped");
      return {};
    }
  }

  const scanDirs = (
    config.icons?.scan ?? ["views", "client", "routes", "lib", "features", "shared"]
  ).map((dir) => path.resolve(config.root, dir));

  const used = [...scanUsedIcons(scanDirs)].sort();
  const symbols = [];
  const missing = [];

  for (const entry of used) {
    const [name, weight] = entry.split(":");
    const parts = localIndex
      ? readLocalIcon(localIndex, name, weight)
      : readPhosphorIcon(/** @type {string} */ (coreAssets), name, weight);

    if (!parts?.body) {
      missing.push(entry);
      continue;
    }

    symbols.push(
      `<symbol id="${name}-${weight}" viewBox="${parts.viewBox}">${parts.body}</symbol>`,
    );
  }

  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols.join("")}</svg>`;
  const url = writeAsset("sprite.svg", sprite);
  pruneAssets(["sprite."], { keep: [path.basename(url)] });

  log.detail(`${symbols.length} symbols`);
  if (missing.length) {
    log.warn(`${missing.length} icons missing → ${missing.join(", ")}`);
  }

  return { "sprite.svg": url };
}
