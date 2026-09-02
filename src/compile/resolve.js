/**
 * View kökleri ve `.jsk` dosya keşfi.
 *
 * Sıra: views, sonra shared/views, sonra her feature altındaki views.
 * Aynı view id birden fazla kökte varsa son bulunan kazanır.
 */
import fs from "node:fs";
import path from "node:path";
import { toPascalCase } from "./codegen.js";
import { CompileError } from "./errors.js";
import { scanNamedExports } from "./scan-exports.js";

/**
 * Runtime'ın camelCase → PascalCase alias'ı ile aynı kural.
 * @param {string} name
 * @returns {string}
 */
export function toComponentTag(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * @param {{ root: string, dirs: Record<string, string> }} config
 * @returns {string[]} Mutlak view kökleri (var olanlar).
 */
export function getViewRoots(config) {
  /** @type {string[]} */
  const roots = [];
  const { dirs, root } = config;

  if (dirs.views && fs.existsSync(dirs.views)) {
    roots.push(dirs.views);
  }

  const sharedViews = dirs.shared
    ? path.join(dirs.shared, "views")
    : path.join(root, "shared", "views");
  if (fs.existsSync(sharedViews)) roots.push(sharedViews);

  const featuresDir = dirs.features ?? path.join(root, "features");
  if (fs.existsSync(featuresDir)) {
    const features = fs
      .readdirSync(featuresDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));

    for (const name of features) {
      const views = path.join(featuresDir, name, "views");
      if (fs.existsSync(views)) roots.push(views);
    }
  }

  return roots;
}

/**
 * Bileşen dizinleri: her view kökü altındaki `components/`.
 * @param {{ root: string, dirs: Record<string, string> }} config
 * @returns {string[]}
 */
export function getComponentDirs(config) {
  return getViewRoots(config)
    .map((root) => path.join(root, "components"))
    .filter((dir) => fs.existsSync(dir));
}

/**
 * @param {string[]} viewRoots
 * @returns {Map<string, string>} viewId → mutlak `.jsk` yolu
 */
export function discoverJskFiles(viewRoots) {
  /** @type {Map<string, string>} */
  const map = new Map();

  for (const root of viewRoots) {
    collectJsk(root, root, map);
  }

  return map;
}

/**
 * @param {string} dir
 * @param {string} root
 * @param {Map<string, string>} out
 */
function collectJsk(dir, root, out) {
  if (!fs.existsSync(dir)) return;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsk(full, root, out);
      continue;
    }
    if (!entry.name.endsWith(".jsk")) continue;
    const rel = path.relative(root, full).split(path.sep).join("/");
    const viewId = rel.replace(/\.jsk$/i, "");
    out.set(viewId, full);
  }
}

/**
 * `components/foo-bar.jsk` → `FooBar`
 * @param {string} viewId
 * @returns {string | null}
 */
export function componentNameFromViewId(viewId) {
  const parts = viewId.split("/");
  if (parts[0] !== "components" || parts.length < 2) return null;
  const base = parts[parts.length - 1];
  return toPascalCase(base);
}

/**
 * Bilinen bileşen adları: JS named export'lar + derlenecek `.jsk` bileşenleri
 * + yerleşik etiketler.
 *
 * JS tarafında dosya adı varsayılmaz; kaynak metinden `export` adları okunur.
 * Aynı export (veya aynı PascalCase etiket) iki dosyada varsa derleme hatası.
 *
 * @param {string[]} componentDirs
 * @param {Map<string, string>} jskFiles
 * @returns {Set<string>}
 */
export function collectKnownComponents(componentDirs, jskFiles) {
  const known = new Set([
    "Link",
    "Image",
    "Icon",
    "CsrfField",
    "PreloadImage",
  ]);

  /** @type {Map<string, string>} export adı → göreli yol */
  const byName = new Map();
  /** @type {Map<string, string>} PascalCase etiket → göreli yol */
  const byTag = new Map();

  for (const [viewId] of jskFiles) {
    const name = componentNameFromViewId(viewId);
    if (!name) continue;
    known.add(name);
    byTag.set(name, `${viewId}.jsk`);
  }

  for (const dir of componentDirs) {
    collectJsComponentNames(dir, known, byName, byTag);
  }

  return known;
}

/**
 * @param {string} name
 * @param {string} origin
 * @param {Map<string, string>} byName
 * @param {Map<string, string>} byTag
 */
function registerExportOrigin(name, origin, byName, byTag) {
  const previousName = byName.get(name);
  if (previousName && previousName !== origin) {
    throw new CompileError(
      `Component '${name}' is defined twice: ${previousName} and ${origin}`,
    );
  }
  byName.set(name, origin);

  const tag = toComponentTag(name);
  const previousTag = byTag.get(tag);
  if (previousTag && previousTag !== origin) {
    throw new CompileError(
      `Component '${tag}' is defined twice: ${previousTag} and ${origin}`,
    );
  }
  byTag.set(tag, origin);
}

/**
 * @param {string} dir
 * @param {Set<string>} out
 * @param {Map<string, string>} byName
 * @param {Map<string, string>} byTag
 */
function collectJsComponentNames(dir, out, byName, byTag) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsComponentNames(full, out, byName, byTag);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    if (entry.name === "loader.js" || entry.name === "index.js") continue;

    // Kimlik mutlak yol: çoklu kökte iki `list.js` aynı göreli ada sahip olabilir.
    const origin = full.split(path.sep).join("/");
    const source = fs.readFileSync(full, "utf8");
    const exports = scanNamedExports(source);

    for (const name of exports) {
      registerExportOrigin(name, origin, byName, byTag);
      out.add(name);
      out.add(toComponentTag(name));
    }
  }
}
