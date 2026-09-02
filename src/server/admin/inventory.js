/**
 * Route ve view envanteri — admin paneline salt okunur döküm.
 */
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../../config/index.js";
import { list as listLogs } from "./event-log.js";

/**
 * Express router stack'ini dolaşır. İç API kırılgan; yalnızca gözlem için.
 *
 * @param {import('express').Express} app
 * @returns {{ method: string, path: string }[]}
 */
export function listExpressRoutes(app) {
  /** @type {{ method: string, path: string }[]} */
  const out = [];
  const stack = /** @type {any} */ (app)?._router?.stack;
  if (!Array.isArray(stack)) return out;

  /**
   * @param {any[]} layers
   * @param {string} prefix
   */
  function walk(layers, prefix) {
    for (const layer of layers) {
      if (layer.route) {
        const routePath = joinPath(prefix, layer.route.path);
        const methods = Object.keys(layer.route.methods || {}).filter(
          (name) => layer.route.methods[name],
        );
        for (const method of methods) {
          out.push({ method: method.toUpperCase(), path: routePath });
        }
        continue;
      }

      if (layer.name === "router" && layer.handle?.stack) {
        const mount = layer.regexp ? regexpToPrefix(layer.regexp) : "";
        walk(layer.handle.stack, joinPath(prefix, mount));
      }
    }
  }

  walk(stack, "");
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
function joinPath(a, b) {
  if (!a) return b || "/";
  if (!b || b === "/") return a || "/";
  return `${a.replace(/\/+$/, "")}/${String(b).replace(/^\/+/, "")}`;
}

/**
 * Express mount regexp → okunabilir önek. Tam doğruluk şart değil.
 *
 * @param {RegExp} regexp
 * @returns {string}
 */
function regexpToPrefix(regexp) {
  const source = regexp.source
    .replace("^\\/", "/")
    .replace("\\/?(?=\\/|$)", "")
    .replace(/\$$/, "")
    .replace(/\\\//g, "/")
    .replace(/\(\?:\(\?=.*$/, "");
  if (!source.startsWith("/")) return "";
  const cleaned = source.replace(/[^a-zA-Z0-9/_\-.:*]/g, "");
  return cleaned || "";
}

/**
 * `routes/` altındaki (veya config.routes listesindeki) modül dosyaları.
 *
 * @returns {{ file: string, relative: string }[]}
 */
export function listRouteModules() {
  const config = getConfig();
  const root = config.root;

  const files = config.routes
    ? config.routes.map((entry) => path.resolve(root, entry))
    : discover(config.dirs.routes);

  return files.map((file) => ({
    file,
    relative: path.relative(root, file).replaceAll("\\", "/"),
  }));
}

/**
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function discover(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      discover(full, out);
      continue;
    }
    if (!/\.(js|mjs)$/.test(entry.name)) continue;
    if (entry.name.startsWith("_")) continue;
    out.push(full);
  }

  return out;
}

/**
 * `views/` altındaki şablon ve bileşen dosyaları.
 *
 * @returns {{ relative: string, kind: "ejs" | "js" | "other" }[]}
 */
export function listViews() {
  const config = getConfig();
  const root = config.dirs.views;
  /** @type {{ relative: string, kind: "ejs" | "js" | "other" }[]} */
  const out = [];

  /**
   * @param {string} dir
   */
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const relative = path.relative(root, full).replaceAll("\\", "/");
      const kind = entry.name.endsWith(".ejs")
        ? "ejs"
        : /\.(js|mjs)$/.test(entry.name)
          ? "js"
          : "other";
      out.push({ relative, kind });
    }
  }

  walk(root);
  return out;
}

/**
 * Son HTTP log'larından path başına özet.
 *
 * @returns {Record<string, { status: number, ms: number, cache: string | null, at: number, count: number }>}
 */
export function routeActivity() {
  /** @type {Record<string, { status: number, ms: number, cache: string | null, at: number, count: number }>} */
  const byPath = {};

  for (const entry of listLogs(0, 500)) {
    if (entry.kind !== "http") continue;
    const key = typeof entry.route === "string" && entry.route
      ? entry.route
      : String(entry.path ?? entry.url ?? "");
    if (!key) continue;

    const prev = byPath[key];
    byPath[key] = {
      status: Number(entry.status) || 0,
      ms: Number(entry.ms) || 0,
      cache: /** @type {string | null} */ (entry.cache ?? null),
      at: entry.at,
      count: (prev?.count ?? 0) + 1,
    };
  }

  return byPath;
}
