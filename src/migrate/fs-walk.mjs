/**
 * Next App Router ağacında dosya keşfi ve path → URL eşlemesi.
 */
import fs from "node:fs";
import path from "node:path";

const PAGE_RE = /^page\.(jsx?|tsx?|mjs|cjs)$/;
const LAYOUT_RE = /^layout\.(jsx?|tsx?|mjs|cjs)$/;
const SOURCE_RE = /\.(jsx?|tsx?|mjs|cjs)$/;

/**
 * @param {string} root
 * @returns {string | null}
 */
export function findAppDir(root) {
  for (const candidate of ["app", "src/app"]) {
    const abs = path.join(root, candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
  }
  return null;
}

/**
 * @param {string} root
 * @returns {string | null}
 */
export function findNextConfig(root) {
  for (const name of [
    "next.config.mjs",
    "next.config.js",
    "next.config.cjs",
    "next.config.ts",
  ]) {
    const abs = path.join(root, name);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

/**
 * @param {string} dir
 * @param {(rel: string, abs: string) => void} visit
 * @param {string} [base]
 */
export function walkFiles(dir, visit, base = dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(abs, visit, base);
      continue;
    }
    visit(path.relative(base, abs).replace(/\\/g, "/"), abs);
  }
}

/**
 * App Router segment yolunu Express path'ine çevirir.
 * `news/[slug]` → `/news/:slug`, `docs/[...slug]` → `/docs/:slug*`
 *
 * @param {string} relativeDir app/ altındaki dizin (posix, trailing slash yok)
 * @returns {string}
 */
export function segmentToExpressPath(relativeDir) {
  if (!relativeDir || relativeDir === ".") return "/";
  const parts = relativeDir.split("/").filter(Boolean);
  const out = [];
  for (const part of parts) {
    if (part.startsWith("(") && part.endsWith(")")) continue; // route groups
    if (part.startsWith("@")) continue; // parallel routes
    const catchAll = part.match(/^\[\.\.\.(.+)\]$/);
    if (catchAll) {
      out.push(`:${catchAll[1]}*`);
      continue;
    }
    const optional = part.match(/^\[\[\.\.\.(.+)\]\]$/);
    if (optional) {
      out.push(`:${optional[1]}*`);
      continue;
    }
    const dyn = part.match(/^\[(.+)\]$/);
    if (dyn) {
      out.push(`:${dyn[1]}`);
      continue;
    }
    out.push(part);
  }
  return "/" + out.join("/");
}

/**
 * Feature adı: ilk anlamlı segment veya `home`.
 *
 * @param {string} relativeDir
 * @returns {string}
 */
export function featureNameFromDir(relativeDir) {
  const parts = relativeDir
    .split("/")
    .filter(Boolean)
    .filter((p) => !(p.startsWith("(") && p.endsWith(")")))
    .filter((p) => !p.startsWith("@"))
    .filter((p) => !p.startsWith("["));
  if (parts.length === 0) return "home";
  return parts[0].replace(/[^a-zA-Z0-9_-]/g, "-") || "home";
}

/**
 * Sayfa dosya gövde adı.
 *
 * @param {string} relativeDir
 * @returns {string}
 */
export function pageNameFromDir(relativeDir) {
  const parts = relativeDir
    .split("/")
    .filter(Boolean)
    .filter((p) => !(p.startsWith("(") && p.endsWith(")")))
    .filter((p) => !p.startsWith("@"));
  if (parts.length === 0) return "home";
  const last = parts[parts.length - 1];
  if (last.startsWith("[")) {
    return parts.length > 1 ? parts[parts.length - 2] : "detail";
  }
  return last.replace(/[^a-zA-Z0-9_-]/g, "-") || "page";
}

/**
 * @param {string} appDir
 * @returns {{ pages: Array<{ abs: string, rel: string, dir: string, url: string, feature: string, page: string }>, layouts: Array<{ abs: string, rel: string, dir: string, depth: number }>, sources: Array<{ abs: string, rel: string }> }}
 */
export function inventoryApp(appDir) {
  /** @type {Array<{ abs: string, rel: string, dir: string, url: string, feature: string, page: string }>} */
  const pages = [];
  /** @type {Array<{ abs: string, rel: string, dir: string, depth: number }>} */
  const layouts = [];
  /** @type {Array<{ abs: string, rel: string }>} */
  const sources = [];

  walkFiles(appDir, (rel, abs) => {
    const base = path.basename(rel);
    const dir = path.posix.dirname(rel);
    const dirKey = dir === "." ? "" : dir;

    if (PAGE_RE.test(base)) {
      pages.push({
        abs,
        rel,
        dir: dirKey,
        url: segmentToExpressPath(dirKey),
        feature: featureNameFromDir(dirKey),
        page: pageNameFromDir(dirKey),
      });
      return;
    }
    if (LAYOUT_RE.test(base)) {
      const depth = dirKey ? dirKey.split("/").length : 0;
      layouts.push({ abs, rel, dir: dirKey, depth });
      return;
    }
    if (SOURCE_RE.test(base)) {
      sources.push({ abs, rel });
    }
  });

  layouts.sort((a, b) => a.depth - b.depth);
  pages.sort((a, b) => a.url.localeCompare(b.url));
  return { pages, layouts, sources };
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function findClientEnvKeys(root) {
  /** @type {Set<string>} */
  const keys = new Set();
  for (const name of [".env", ".env.local", ".env.production", ".env.development"]) {
    const abs = path.join(root, name);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*NEXT_PUBLIC_([A-Za-z0-9_]+)\s*=/);
      if (m) keys.add(m[1]);
    }
  }
  return [...keys].sort();
}

export { PAGE_RE, LAYOUT_RE, SOURCE_RE };
