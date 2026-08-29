/**
 * Build'de üretilmiş `.br` / `.gz` kopyalarını servis eder.
 *
 * `express.static`ten önce çalışır: istemcinin kabul ettiği bir kopya varsa
 * istek yolunu ona çevirir ve doğru `Content-Type` / `Content-Encoding`
 * başlıklarını kendisi kurar. Böylece hash'li varlıklar istek başına yeniden
 * sıkıştırılmaz ve build'deki kalite 11 brotli kullanılır.
 *
 * Kopya yoksa istek olduğu gibi `express.static`e devredilir.
 */
import fs from "node:fs";
import path from "node:path";
import { negotiateEncoding } from "./compression.js";
import { IMMUTABLE_CACHE } from "../../config/defaults.js";

/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/**
 * @param {string} publicDir
 * @returns {import('express').RequestHandler}
 */
export function staticPrecompressed(publicDir) {
  const root = path.resolve(publicDir);

  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    const type = CONTENT_TYPES[path.extname(req.path).toLowerCase()];
    if (!type) {
      next();
      return;
    }

    const encoding = negotiateEncoding(req.headers["accept-encoding"]);
    if (!encoding) {
      next();
      return;
    }

    let decoded;
    try {
      decoded = decodeURIComponent(req.path);
    } catch {
      next();
      return;
    }

    const target = path.resolve(root, `.${decoded}`);

    // Path traversal koruması: çözülen yol public/ dışına çıkamaz.
    if (target !== root && !target.startsWith(root + path.sep)) {
      next();
      return;
    }

    const file = `${target}${encoding === "br" ? ".br" : ".gz"}`;

    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      next();
      return;
    }

    if (!stat.isFile()) {
      next();
      return;
    }

    res.setHeader("Content-Type", type);
    res.setHeader("Content-Encoding", encoding);
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Vary", "Accept-Encoding");

    if (req.path.startsWith("/assets/")) {
      res.setHeader("Cache-Control", IMMUTABLE_CACHE);
    }

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(file).on("error", () => res.end()).pipe(res);
  };
}
