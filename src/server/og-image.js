/**
 * Dinamik Open Graph görselleri — Next.js `ImageResponse` /
 * `opengraph-image.tsx` karşılığı.
 *
 * JSX yok: ya hazır kart alanları (`title`, `description`, `siteName`) ya da
 * ham `svg` verilir. sharp (opsiyonel peer) varsa PNG üretilir; yoksa SVG
 * döner. Sosyal kazıyıcıların çoğu PNG beklediği için prod'da sharp önerilir.
 *
 * Domain bilgisi taşınmaz — metin, renk ve SVG uygulama tarafındandır.
 *
 * Slim imajda `system-ui` karşılığı yoktur; librsvg her sitede aynı boş
 * kareleri basar. `@font-face` (data URI dahil) bu çizici tarafından yok
 * sayılır, `woff2` de kare basar. `fonts` içindeki `ttf` / `otf` dosyaları
 * fontconfig'e eklenir. Paket imajda yine gerekir; sistem font paketi gerekmez.
 */
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tryImportFromApp } from "../build/resolve-peer.mjs";
import { getConfig } from "../config/index.js";
import { isNotFoundError } from "../http/control-flow.js";
import { setEdgeCacheHeaders } from "./cache-control.js";

/** @type {((input: Buffer, opts?: object) => import('sharp').Sharp) | null | undefined} */
let sharpModule;

/** Sosyal kartlar için yaygın boyut (Facebook / X / LinkedIn). */
export const OG_SIZE = Object.freeze({ width: 1200, height: 630 });

/**
 * Kartın yedeği. Slim imajda bu yığın boş kare basar; `fonts` verilince
 * uygulamanın yüzü öne alınır.
 */
const SYSTEM_FONT_STACK = "system-ui, -apple-system, Segoe UI, sans-serif";

/**
 * OG süreleri HTML TTL'ye bağlanmaz. Yalnızca `s-maxage` kalkar; edge
 * `CDN-Cache-Control` üzerinde aynı pencereyi görür.
 */
const OG_EDGE_MAX_AGE = 86400;
const OG_EDGE_STALE = 604800;

/**
 * @typedef {object} OgCardOptions
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [siteName]
 * @property {string} [background] Düz SVG rengi (`#0f172a`)
 * @property {string} [color] Ana metin rengi
 * @property {string} [mutedColor] Açıklama / site adı
 * @property {string} [accent] Sol şerit rengi
 */

/**
 * OG metnine gömülen yüz. `path` + `family` yeter. PNG, dosyanın içindeki
 * ağırlığı kullanır; `weight` yalnızca SVG yanıtındaki `@font-face` içindir.
 *
 * @typedef {object} OgFontFace
 * @property {string} path Font dosyası. PNG için `ttf` veya `otf`
 *   (librsvg `woff` / `woff2` dosyasından kare basar). Uygulama köküne
 *   göreli ya da mutlak.
 * @property {string} family SVG `font-family` adı. Dosyanın içindeki adla
 *   aynı olmak zorunda değil.
 * @property {number | string} [weight] Tek ağırlık (`700`) ya da aralık (`"100 900"`).
 * @property {'normal' | 'italic' | 'oblique'} [style]
 */

/**
 * @typedef {OgCardOptions & {
 *   svg?: string,
 *   width?: number,
 *   height?: number,
 *   format?: 'png' | 'svg',
 *   cacheControl?: string,
 *   fonts?: OgFontFace[],
 * }} OgImageOptions
 */

/**
 * @typedef {object} OgImageResult
 * @property {Buffer} body
 * @property {string} contentType
 * @property {number} width
 * @property {number} height
 */

/**
 * XML metin kaçışı — kullanıcı başlığı SVG'ye gömülür.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Kelime sınırında satır kır. Uzun kelime kesilir; taşan içerik son satırda `…`.
 * @param {string} text
 * @param {number} maxChars
 * @param {number} maxLines
 * @returns {string[]}
 */
export function wrapText(text, maxChars, maxLines) {
  const words = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || maxLines < 1 || maxChars < 1) return [];

  /** @type {string[]} */
  const lines = [];
  let current = "";
  let overflow = false;

  const pushCurrent = () => {
    if (!current) return;
    lines.push(current);
    current = "";
  };

  for (const word of words) {
    if (lines.length >= maxLines) {
      overflow = true;
      break;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    pushCurrent();
    if (lines.length >= maxLines) {
      overflow = true;
      break;
    }

    if (word.length <= maxChars) {
      current = word;
      continue;
    }

    let rest = word;
    while (rest.length > maxChars) {
      if (lines.length >= maxLines) {
        overflow = true;
        rest = "";
        break;
      }
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    current = rest;
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  } else if (current) {
    overflow = true;
  }

  if (overflow && lines.length) {
    const last = lines[lines.length - 1];
    const base = last.endsWith("…") ? last.slice(0, -1) : last;
    const trimmed = base.slice(0, Math.max(1, maxChars - 1));
    lines[lines.length - 1] = `${trimmed}…`;
  }

  return lines;
}

/**
 * Hazır kart SVG'si. Uygulama kendi SVG'sini vermek isterse `svg` kullanır.
 * @param {OgCardOptions & { width?: number, height?: number, fontFamily?: string }} options
 * @returns {string}
 */
export function buildOgSvg(options = {}) {
  const width = options.width ?? OG_SIZE.width;
  const height = options.height ?? OG_SIZE.height;
  const background = options.background ?? "#0f172a";
  const color = options.color ?? "#f8fafc";
  const muted = options.mutedColor ?? "#94a3b8";
  const accent = options.accent ?? "#38bdf8";
  const fontFamily = options.fontFamily || SYSTEM_FONT_STACK;

  const titleLines = wrapText(options.title ?? "", 28, 3);
  const descLines = wrapText(options.description ?? "", 52, 2);
  const siteName = options.siteName ? escapeXml(options.siteName) : "";

  const titleTs = titleLines
    .map((line, i) => {
      const dy = i === 0 ? 0 : 72;
      return `<tspan x="80" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  const descTs = descLines
    .map((line, i) => {
      const dy = i === 0 ? 0 : 40;
      return `<tspan x="80" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  const titleY = 200;
  const descY = titleY + Math.max(titleLines.length, 1) * 72 + 36;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="${escapeXml(background)}"/>` +
    `<rect x="0" y="0" width="14" height="${height}" fill="${escapeXml(accent)}"/>` +
    (titleTs
      ? `<text x="80" y="${titleY}" font-family="${escapeXml(fontFamily)}" font-size="64" font-weight="700" fill="${escapeXml(color)}">${titleTs}</text>`
      : "") +
    (descTs
      ? `<text x="80" y="${descY}" font-family="${escapeXml(fontFamily)}" font-size="30" font-weight="400" fill="${escapeXml(muted)}">${descTs}</text>`
      : "") +
    (siteName
      ? `<text x="80" y="${height - 64}" font-family="${escapeXml(fontFamily)}" font-size="24" font-weight="600" fill="${escapeXml(muted)}">${siteName}</text>`
      : "") +
    `</svg>`
  );
}

/**
 * @returns {Promise<((input: Buffer, opts?: object) => import('sharp').Sharp) | null>}
 */
async function loadSharp() {
  if (sharpModule !== undefined) return sharpModule;

  /** @type {any} */
  let mod = null;
  try {
    mod = await tryImportFromApp(getConfig().root, "sharp");
  } catch {
    // Config yoksa (birim test) doğrudan çözümle.
    try {
      mod = await import("sharp");
    } catch {
      mod = null;
    }
  }

  sharpModule = mod?.default ?? mod ?? null;
  return sharpModule;
}

/**
 * Aynı eksik dosya her OG isteğinde yeniden uyarılmasın.
 * @type {Set<string>}
 */
const warnedFonts = new Set();

/**
 * Dosya baytı. Ağırlık ve family istekten isteme değişebilir; URI dosyaya bağlı.
 * @type {Map<string, { mtimeMs: number, size: number, dataUri: string }>}
 */
const fontDataCache = new Map();

/**
 * @param {string} key
 * @param {string} message
 */
function warnFont(key, message) {
  if (warnedFonts.has(key)) return;
  warnedFonts.add(key);
  console.warn(message);
}

/**
 * Config yoksa (birim test) süreç dizinine düşülür.
 * @returns {string}
 */
function appRoot() {
  try {
    return getConfig().root;
  } catch {
    return process.cwd();
  }
}

/**
 * @param {unknown} filePath
 * @returns {string}
 */
function resolveFontPath(filePath) {
  const raw = String(filePath ?? "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.resolve(appRoot(), raw);
}

/**
 * CSS string'ine ve SVG'ye sızmasın diye tırnak ve işaretler düşer.
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeFamily(value) {
  return String(value ?? "")
    .replace(/["\\\n\r<>]/g, "")
    .trim();
}

/**
 * @param {unknown} weight
 * @returns {string}
 */
function fontWeightValue(weight) {
  if (weight == null || weight === "") return "100 900";
  if (typeof weight === "number") {
    if (!Number.isInteger(weight) || weight < 1 || weight > 1000) return "100 900";
    return String(weight);
  }
  const text = String(weight).trim();
  if (/^[1-9]\d{0,2}(\s+[1-9]\d{0,2})?$/.test(text)) return text;
  return "100 900";
}

/**
 * @param {unknown} style
 * @returns {'normal' | 'italic' | 'oblique'}
 */
function fontStyleValue(style) {
  if (style === "italic" || style === "oblique") return style;
  return "normal";
}

/**
 * @param {string} filePath
 * @returns {{ mime: string, format: string } | null}
 */
function fontSource(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".woff2":
      return { mime: "font/woff2", format: "woff2" };
    case ".woff":
      return { mime: "font/woff", format: "woff" };
    case ".otf":
      return { mime: "font/otf", format: "opentype" };
    case ".ttc":
      return { mime: "font/collection", format: "collection" };
    case ".ttf":
      return { mime: "font/ttf", format: "truetype" };
    default:
      return null;
  }
}

/**
 * @param {string} filePath
 * @param {string} mime
 * @returns {Promise<string>}
 */
async function fontDataUri(filePath, mime) {
  const stat = await fs.stat(filePath);
  const cached = fontDataCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.dataUri;
  }
  const buf = await fs.readFile(filePath);
  const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
  fontDataCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, dataUri });
  return dataUri;
}

/**
 * @param {OgFontFace} font
 * @returns {Promise<string>}
 */
async function fontFaceRule(font) {
  const family = sanitizeFamily(font?.family);
  if (!family) {
    warnFont("family", "[og] fonts[].family is empty, skipping");
    return "";
  }
  const filePath = resolveFontPath(font?.path);
  if (!filePath) {
    warnFont("path", "[og] fonts[].path is empty, skipping");
    return "";
  }
  const source = fontSource(filePath);
  if (!source) {
    warnFont(filePath, `[og] unsupported font extension, skipping: ${filePath}`);
    return "";
  }

  let dataUri;
  try {
    dataUri = await fontDataUri(filePath, source.mime);
  } catch (error) {
    const missing =
      error && typeof error === "object" && "code" in error && error.code === "ENOENT";
    warnFont(
      filePath,
      missing
        ? `[og] font file not found, skipping: ${filePath}`
        : `[og] could not read font, skipping: ${filePath}`,
    );
    return "";
  }

  return (
    `@font-face {\n` +
    `  font-family: "${family}";\n` +
    `  font-style: ${fontStyleValue(font.style)};\n` +
    `  font-weight: ${fontWeightValue(font.weight)};\n` +
    `  src: url("${dataUri}") format("${source.format}");\n` +
    `}`
  );
}

/**
 * Ham SVG'deki `font-family` uygulamanın işi. Burada yalnızca yüz tanımı eklenir,
 * böylece uygulama kendi `@font-face` bloğunu yazmaz.
 *
 * @param {string} svg
 * @param {string} css
 * @returns {string}
 */
function injectFontFaces(svg, css) {
  const style = `<style><![CDATA[\n${css}\n]]></style>`;
  if (/<defs[\s>]/i.test(svg)) {
    return svg.replace(/<defs(\s[^>]*)?>/i, (open) => `${open}${style}`);
  }
  return svg.replace(/<svg\b[^>]*>/i, (open) => `${open}<defs>${style}</defs>`);
}

/**
 * Kayıtlar çakışmasın diye sıraya girer. Çizim kuyruğun dışında kalır.
 * @type {Promise<void>}
 */
let fontQueue = Promise.resolve();

const fontconfigRoot = path.join(os.tmpdir(), "jskelet-og-fontconfig");

/**
 * Kaynak yol → kullanıcının family adı ve dosyanın içindeki ad.
 * @type {Map<string, { userFamily: string, internalFamily: string }>}
 */
const rasterFonts = new Map();

/**
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function enqueueFont(task) {
  const run = fontQueue.then(task, task);
  fontQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * @param {string} value
 * @returns {string}
 */
function xmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {Buffer} buf
 * @returns {boolean}
 */
function isSfnt(buf) {
  if (buf.length < 12) return false;
  const tag = buf.readUInt32BE(0);
  // 0x00010000 ttf, OTTO otf, true (eski trueType)
  return tag === 0x00010000 || tag === 0x4f54544f || tag === 0x74727565;
}

/**
 * name tablosundan typographic family (nameID 16), yoksa font family (1).
 * Ayrıştırılamazsa `null` — site düşmez, verilen ad denenir.
 * @param {Buffer} buf
 * @returns {string | null}
 */
function readInternalFamily(buf) {
  try {
    if (!isSfnt(buf)) return null;
    const numTables = buf.readUInt16BE(4);
    let nameOffset = -1;
    let nameLength = 0;
    for (let i = 0; i < numTables; i += 1) {
      const rec = 12 + i * 16;
      if (rec + 16 > buf.length) return null;
      const tag = buf.toString("latin1", rec, rec + 4);
      if (tag !== "name") continue;
      nameOffset = buf.readUInt32BE(rec + 8);
      nameLength = buf.readUInt32BE(rec + 12);
      break;
    }
    if (nameOffset < 0 || nameOffset + nameLength > buf.length) return null;
    const table = buf.subarray(nameOffset, nameOffset + nameLength);
    const count = table.readUInt16BE(2);
    const stringOffset = table.readUInt16BE(4);
    let best = "";
    let bestScore = -1;
    for (let i = 0; i < count; i += 1) {
      const rec = 6 + i * 12;
      if (rec + 12 > table.length) break;
      const platformID = table.readUInt16BE(rec);
      const nameID = table.readUInt16BE(rec + 6);
      const length = table.readUInt16BE(rec + 8);
      const offset = table.readUInt16BE(rec + 10);
      if (nameID !== 16 && nameID !== 1) continue;
      const start = stringOffset + offset;
      if (start + length > table.length) continue;
      const bytes = table.subarray(start, start + length);
      let text = "";
      if (platformID === 3 || platformID === 0) {
        const swapped = Buffer.alloc(bytes.length - (bytes.length % 2));
        for (let b = 0; b + 1 < bytes.length; b += 2) {
          swapped[b] = bytes[b + 1];
          swapped[b + 1] = bytes[b];
        }
        text = swapped.toString("utf16le").replace(/\0/g, "").trim();
      } else {
        text = bytes.toString("latin1").trim();
      }
      if (!text) continue;
      const score = (nameID === 16 ? 10 : 0) + (platformID === 3 ? 2 : platformID === 0 ? 1 : 0);
      if (score > bestScore) {
        best = text;
        bestScore = score;
      }
    }
    return best || null;
  } catch {
    return null;
  }
}

/**
 * FONTCONFIG_FILE varsayılan listeyi değiştirir; sistem dizinlerini geri koy.
 * @returns {string[]}
 */
function systemFontDirs() {
  /** @type {string[]} */
  const dirs = [];
  const windir = process.env.WINDIR || process.env.windir;
  if (windir) dirs.push(path.join(windir, "Fonts"));
  dirs.push("/usr/share/fonts", "/usr/local/share/fonts", path.join(os.homedir(), ".local/share/fonts"));
  return dirs.filter((dir) => existsSync(dir));
}

/**
 * @param {string} conf
 * @param {string} fontsDir
 * @param {string} cacheDir
 * @returns {Promise<void>}
 */
async function writeFontconfigFile(conf, fontsDir, cacheDir) {

  /** @type {Map<string, Set<string>>} */
  const aliases = new Map();
  for (const face of rasterFonts.values()) {
    const targets = aliases.get(face.userFamily) ?? new Set();
    targets.add(face.internalFamily);
    aliases.set(face.userFamily, targets);
  }

  const dirs = [fontsDir, ...systemFontDirs()]
    .map((dir) => `  <dir>${xmlText(dir.split(path.sep).join("/"))}</dir>`)
    .join("\n");
  const aliasXml = [...aliases.entries()]
    .map(([userFamily, targets]) => {
      const prefer = [...targets].map((name) => `      <family>${xmlText(name)}</family>`).join("\n");
      return (
        `  <alias binding="strong">\n` +
        `    <family>${xmlText(userFamily)}</family>\n` +
        `    <prefer>\n${prefer}\n    </prefer>\n` +
        `  </alias>`
      );
    })
    .join("\n");

  const xml =
    `<?xml version="1.0"?>\n` +
    `<fontconfig>\n` +
    `  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>\n` +
    `${dirs}\n` +
    `  <cachedir>${xmlText(cacheDir.split(path.sep).join("/"))}</cachedir>\n` +
    `${aliasXml}\n` +
    `</fontconfig>\n`;
  await fs.writeFile(conf, xml);
}

/**
 * @param {string} filePath
 * @param {string} userFamily
 * @returns {Promise<boolean>}
 */
async function registerRasterFont(filePath, userFamily) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".woff" || ext === ".woff2") {
    if (existsSync(filePath)) {
      warnFont(
        `web:${filePath}`,
        `[og] woff/woff2 is not drawn by librsvg (empty boxes). Pass a ttf or otf: ${filePath}`,
      );
    }
    return false;
  }
  if (ext !== ".ttf" && ext !== ".otf" && ext !== ".ttc") return false;

  let buf;
  try {
    buf = await fs.readFile(filePath);
  } catch (error) {
    const missing = error && typeof error === "object" && "code" in error && error.code === "ENOENT";
    warnFont(
      filePath,
      missing
        ? `[og] font file not found, skipping: ${filePath}`
        : `[og] could not read font, skipping: ${filePath}`,
    );
    return false;
  }

  if (ext !== ".ttc" && !isSfnt(buf)) {
    warnFont(filePath, `[og] font file is not a ttf/otf, skipping raster face: ${filePath}`);
    return false;
  }

  const parsed = readInternalFamily(buf);
  const internalFamily = parsed || userFamily;
  if (!parsed) {
    warnFont(
      filePath,
      `[og] could not read the name inside the font, using the given family: ${filePath}`,
    );
  }

  const fontsDir = path.join(fontconfigRoot, "fonts");
  await fs.mkdir(fontsDir, { recursive: true });
  const destName = `${crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 16)}${ext}`;
  await fs.copyFile(filePath, path.join(fontsDir, destName));
  rasterFonts.set(filePath, { userFamily, internalFamily });
  return true;
}

/**
 * @param {OgFontFace[] | undefined} fonts
 * @returns {Promise<{ css: string, family: string | null, rasterFamily: string | null }>}
 */
async function loadOgFonts(fonts) {
  if (!Array.isArray(fonts) || fonts.length === 0) {
    return { css: "", family: null, rasterFamily: null };
  }

  return enqueueFont(async () => {
    /** @type {string[]} */
    const rules = [];
    /** @type {string[]} */
    const families = [];
    /** @type {string[]} */
    const rasterFamilies = [];

    for (const font of fonts) {
      if (!font || typeof font !== "object") continue;
      const family = sanitizeFamily(font.family);
      const rule = await fontFaceRule(font);
      if (rule && family) {
        rules.push(rule);
        if (!families.includes(family)) families.push(family);
      }
      if (!family) continue;
      const filePath = resolveFontPath(font.path);
      if (!filePath) continue;
      const registered = await registerRasterFont(filePath, family);
      if (registered && !rasterFamilies.includes(family)) rasterFamilies.push(family);
    }

    const stack = (names) =>
      names.length ? `${names.map((name) => `"${name}"`).join(", ")}, ${SYSTEM_FONT_STACK}` : null;

    return {
      css: rules.join("\n"),
      family: stack(families),
      rasterFamily: stack(rasterFamilies),
    };
  });
}

/**
 * fontconfig `FONTCONFIG_FILE`'ı süreç açılırken okur. Windows'ta çalışan
 * sürecin `process.env` ataması CRT `getenv`'ine düşmez; yüzlü PNG'yi bu
 * dosyayı baştan gören bir alt süreç çizer. Üst sürecin fontconfig'i
 * (görsel optimizer) değişmez.
 *
 * @param {string} svg
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Buffer | null>}
 */
async function rasterizeWithFonts(svg, width, height) {
  const sharpUrl = sharpModuleUrl();
  if (!sharpUrl) return null;

  const fontsDir = path.join(fontconfigRoot, "fonts");
  const cacheDir = path.join(fontconfigRoot, "cache");
  await fs.mkdir(fontsDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  const conf = path.join(fontconfigRoot, `fonts-${crypto.randomBytes(8).toString("hex")}.conf`);
  await writeFontconfigFile(conf, fontsDir, cacheDir);

  const script = fileURLToPath(new URL("./og-raster.mjs", import.meta.url));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], {
        env: {
          ...process.env,
          FONTCONFIG_FILE: conf,
          JSKELET_SHARP: sharpUrl,
          JSKELET_OG_WIDTH: String(width),
          JSKELET_OG_HEIGHT: String(height),
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      /** @type {Buffer[]} */
      const out = [];
      /** @type {Buffer[]} */
      const err = [];
      child.stdout.on("data", (chunk) => out.push(chunk));
      child.stderr.on("data", (chunk) => err.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          const detail = Buffer.concat(err).toString("utf8").trim();
          reject(new Error(`[og] raster failed (${code})${detail ? `: ${detail}` : ""}`));
          return;
        }
        resolve(Buffer.concat(out));
      });
      child.stdin.end(svg);
    });
  } finally {
    await fs.rm(conf, { force: true });
  }
}

/**
 * Uygulamanın sharp'ı. Framework `node_modules` içindeyken kendi paketinden
 * çözülmez.
 * @returns {string | null}
 */
function sharpModuleUrl() {
  /** @type {string[]} */
  const roots = [appRoot()];
  for (const root of roots) {
    try {
      const require = createRequire(path.join(root, "package.json"));
      return pathToFileURL(require.resolve("sharp")).href;
    } catch {
      // framework kopyasına düş
    }
  }
  try {
    return pathToFileURL(createRequire(import.meta.url).resolve("sharp")).href;
  } catch {
    return null;
  }
}

/**
 * @param {string} svg
 * @param {number} width
 * @param {number} height
 * @param {boolean} withFonts
 * @returns {Promise<Buffer | null>}
 */
async function rasterizeOg(svg, width, height, withFonts) {
  if (withFonts) return rasterizeWithFonts(svg, width, height);
  const sharp = await loadSharp();
  if (!sharp) return null;
  return sharp(Buffer.from(svg, "utf8"))
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();
}

/**
 * SVG veya kart alanlarından PNG/SVG gövde üretir.
 *
 * PNG'de `ttf` / `otf` fontconfig'e eklenir ve kart bu `family` adlarını
 * kullanır. `woff` / `woff2` yalnızca sharp yokken (ya da `format: "svg"`)
 * `@font-face` olarak gömülür; librsvg onlardan kare basar. Dosya okunamazsa
 * görsel yine üretilir, o yüz atlanır. Çalışma imajında `fontconfig` paketi
 * gerekir.
 *
 * @param {OgImageOptions} [options]
 * @returns {Promise<OgImageResult>}
 */
export async function ogImage(options = {}) {
  const width = options.width ?? OG_SIZE.width;
  const height = options.height ?? OG_SIZE.height;
  const loaded = await loadOgFonts(options.fonts);
  const raw = typeof options.svg === "string" && options.svg.trim() ? options.svg : null;

  /**
   * @param {boolean} raster
   * @returns {string}
   */
  const makeSvg = (raster) => {
    const family = raster ? loaded.rasterFamily : loaded.family;
    let svg =
      raw ??
      buildOgSvg({
        ...options,
        width,
        height,
        fontFamily: family ?? undefined,
      });
    // librsvg gömülü yüzü çizmez; data URI yalnızca tarayıcıya giden SVG'de durur.
    if (!raster && loaded.css) svg = injectFontFaces(svg, loaded.css);
    return svg;
  };

  if (options.format !== "svg") {
    const body = await rasterizeOg(makeSvg(true), width, height, Boolean(loaded.rasterFamily));
    if (body) {
      return {
        body,
        contentType: "image/png",
        width,
        height,
      };
    }
  }

  return {
    body: Buffer.from(makeSvg(false), "utf8"),
    contentType: "image/svg+xml; charset=utf-8",
    width,
    height,
  };
}

/**
 * Express yanıtına OG görseli basar.
 *
 * Varsayılan edge penceresi 86400 / 604800'tür ve HTML TTL'ye bağlı değildir.
 * `cacheControl` verilirse yalnızca `Cache-Control` yazılır;
 * `CDN-Cache-Control` basılmaz.
 *
 * @param {import('express').Response} res
 * @param {OgImageOptions} [options]
 * @returns {Promise<OgImageResult>}
 */
export async function sendOgImage(res, options = {}) {
  const result = await ogImage(options);

  res.status(200);
  res.setHeader("Content-Type", result.contentType);
  if (options.cacheControl != null) {
    res.setHeader("Cache-Control", options.cacheControl);
  } else {
    setEdgeCacheHeaders(res, OG_EDGE_MAX_AGE, OG_EDGE_STALE);
  }
  res.setHeader("Content-Length", String(result.body.length));
  // Kazıyıcılar ve CDN'ler için boyut ipucu (meta ile de verilir).
  res.setHeader("X-Og-Width", String(result.width));
  res.setHeader("X-Og-Height", String(result.height));
  res.end(result.body);
  return result;
}

/**
 * Next `opengraph-image` route handler'ına yakın Express sarmalayıcı.
 *
 * Factory `null` dönerse veya `notFound()` fırlatırsa 404.
 *
 * @param {(ctx: { params: Record<string, string>, query: import('express').Request['query'], req: import('express').Request }) =>
 *   OgImageOptions | null | Promise<OgImageOptions | null>} factory
 * @param {OgImageOptions} [defaults] Her istekte birleşen varsayılanlar
 * @returns {import('express').RequestHandler}
 */
export function ogHandler(factory, defaults = {}) {
  return async (req, res, next) => {
    try {
      const result = await factory({
        params: req.params ?? {},
        query: req.query,
        req,
      });
      if (result == null) {
        res.status(404).end();
        return;
      }
      await sendOgImage(res, { ...defaults, ...result });
    } catch (error) {
      if (isNotFoundError(error)) {
        res.status(404).end();
        return;
      }
      next(error);
    }
  };
}

/**
 * Next.js `new ImageResponse(...)` DX'si. JSX yok — ilk argüman SVG string
 * veya kart alanları nesnesi.
 *
 * @example
 * ```js
 * return new ImageResponse(
 *   { title: post.title, description: post.excerpt, siteName: "Blog" },
 *   { width: 1200, height: 630 },
 * );
 * // handler içinde: await image.send(res)
 * ```
 */
export class ImageResponse {
  /** @type {OgImageOptions} */
  #options;

  /**
   * @param {string | (OgCardOptions & { fonts?: OgFontFace[] })} element
   * @param {Omit<OgImageOptions, keyof OgCardOptions | 'svg'> & { width?: number, height?: number }} [init]
   */
  constructor(element, init = {}) {
    if (typeof element === "string") {
      this.#options = { ...init, svg: element };
    } else {
      this.#options = { ...element, ...init };
    }
  }

  /** @returns {OgImageOptions} */
  get options() {
    return this.#options;
  }

  /** @returns {Promise<OgImageResult>} */
  async buffer() {
    return ogImage(this.#options);
  }

  /**
   * @param {import('express').Response} res
   * @returns {Promise<OgImageResult>}
   */
  async send(res) {
    return sendOgImage(res, this.#options);
  }
}
