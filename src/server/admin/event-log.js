/**
 * Admin paneli için süreç içi olay kuyruğu.
 *
 * Kaynaklar: HTTP `finish` middleware'i ve `log.mjs` aboneliği. Gövde yok —
 * yalnızca meta. Admin kapalıyken bu modül yüklenmez.
 */
import * as log from "../../log.mjs";
import { getConfig } from "../../config/index.js";

/** @typedef {{ kind: string, id: number, at: number, [key: string]: unknown }} LogEntry */

/** @type {LogEntry[]} */
const ring = [];

/** @type {Set<(entry: LogEntry) => void>} */
const live = new Set();

let nextId = 1;
/** @type {(() => void) | null} */
let unsubscribeLog = null;
/** @type {string} */
let basePath = "/_jskelet/admin";
/** @type {string} */
let prewarmUa = "jskelet-prewarm";
let maxSize = 500;

/**
 * @param {{ basePath: string, logSize: number, prewarmUserAgent?: string }} options
 */
export function configureEventLog(options) {
  basePath = options.basePath;
  maxSize = options.logSize;
  if (options.prewarmUserAgent) prewarmUa = options.prewarmUserAgent;

  if (!unsubscribeLog) {
    unsubscribeLog = log.subscribe((raw) => {
      // HTTP finish middleware zaten kendi kaydını yazıyor; log.http
      // çift kayıt üretmesin.
      if (raw.kind === "http") return;
      push({
        kind: typeof raw.kind === "string" ? raw.kind : "event",
        scope: raw.scope ?? null,
        message: raw.message ?? "",
        note: raw.note ?? null,
        ms: raw.ms ?? null,
      });
    });
  }
}

/**
 * @param {Omit<LogEntry, "id" | "at"> & { kind: string }} partial
 * @returns {LogEntry}
 */
export function push(partial) {
  /** @type {LogEntry} */
  const entry = {
    ...partial,
    id: nextId++,
    at: Date.now(),
  };

  ring.push(entry);
  while (ring.length > maxSize) ring.shift();

  for (const listener of live) {
    try {
      listener(entry);
    } catch {
      // SSE dinleyicisi paneli düşürmesin.
    }
  }

  return entry;
}

/**
 * @param {number} [afterId]
 * @param {number} [limit]
 * @returns {LogEntry[]}
 */
export function list(afterId = 0, limit = 200) {
  const capped = Math.min(Math.max(1, limit), maxSize);
  const filtered = afterId > 0 ? ring.filter((entry) => entry.id > afterId) : ring;
  return filtered.slice(-capped);
}

/**
 * @param {(entry: LogEntry) => void} listener
 * @returns {() => void}
 */
export function subscribeLive(listener) {
  live.add(listener);
  return () => live.delete(listener);
}

/**
 * HTTP yanıt bitiminde ring'e yazar. Admin yolları ve prewarm UA atlanır.
 *
 * @returns {import('express').RequestHandler}
 */
export function requestLogMiddleware() {
  const brand = getConfig().brand;

  /** @type {import('express').RequestHandler} */
  return (req, res, next) => {
    const pathname = req.path || "";
    if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
      return next();
    }

    if (req.headers["user-agent"] === (brand.prewarmUserAgent || prewarmUa)) {
      return next();
    }

    const started = process.hrtime.bigint();

    res.on("finish", () => {
      const routePath = matchedRoute(req);
      push({
        kind: "http",
        method: req.method,
        url: req.originalUrl,
        path: req.path,
        route: routePath,
        status: res.statusCode,
        ms: Number(process.hrtime.bigint() - started) / 1e6,
        cache: /** @type {string | null} */ (
          res.getHeader(brand.cacheHeader) ?? null
        ),
      });
    });

    next();
  };
}

/**
 * Express'in eşleştirdiği route deseni (mount + path). Yoksa null.
 *
 * @param {import('express').Request} req
 * @returns {string | null}
 */
function matchedRoute(req) {
  const layer = /** @type {any} */ (req).route;
  if (!layer || typeof layer.path !== "string") return null;

  const base = /** @type {any} */ (req).baseUrl || "";
  const pattern = layer.path === "/" ? base || "/" : `${base}${layer.path}`;
  return pattern || null;
}
