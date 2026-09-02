/**
 * HTTP access log middleware.
 *
 * Admin ve prewarm yolları atlanır. Kayıt `log.http` ile stdout'a (console
 * açıksa) ve `acceptLogEntry` ile sink'lere gider. `emitHttp` kapalı olduğu
 * için `log.http` abonelere ikinci kez yazmaz.
 */
import * as log from "../../log.mjs";
import { getConfig } from "../../config/index.js";
import { acceptLogEntry } from "./pipeline.js";

/**
 * @param {{ basePath?: string }} [options]
 * @returns {import('express').RequestHandler}
 */
export function accessLogMiddleware(options = {}) {
  const config = getConfig();
  const brand = config.brand;
  const basePath =
    options.basePath ??
    (config.admin.enabled ? config.admin.basePath : null);

  /** @type {import('express').RequestHandler} */
  return (req, res, next) => {
    const pathname = req.path || "";
    if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
      return next();
    }

    if (req.headers["user-agent"] === brand.prewarmUserAgent) {
      return next();
    }

    const started = process.hrtime.bigint();

    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const cache = /** @type {string | null} */ (
        res.getHeader(brand.cacheHeader) ?? null
      );

      const info = {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms,
        cache,
      };

      // Stdout (console açıksa). emitHttp kapalı → subscribe çiftlemez.
      log.http(info);

      acceptLogEntry({
        kind: "http",
        method: info.method,
        url: info.url,
        path: req.path,
        status: info.status,
        ms: info.ms,
        cache: info.cache,
      });
    });

    next();
  };
}
