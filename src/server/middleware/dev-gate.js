/**
 * Yayına açılmamış bir ortamı gizler: `DEV_TOKEN` ayarlıyken token taşımayan
 * her isteğe 404 döner. 403 değil 404 — 403 ortamın var olduğunu doğrular,
 * 404 hiç yokmuş gibi davranır.
 *
 * Token bir kez `?dev_token=…` ile gelirse çereze yazılır, böylece link
 * paylaşımı yeterli olur. `DEV_TOKEN` yoksa middleware tamamen devre dışıdır
 * ve üretimde hiçbir maliyeti olmaz.
 */
import process from "node:process";
import { getConfig } from "../../config/index.js";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

/**
 * @param {import('http').IncomingMessage} req
 * @param {string} name
 * @returns {string | undefined}
 */
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** @returns {import('express').RequestHandler} */
export function devGate() {
  const { devGateBypass, brand } = getConfig();
  const bypass = new Set(devGateBypass);
  const cookieName = brand.devTokenCookie;

  return (req, res, next) => {
    const devToken = process.env.DEV_TOKEN;
    if (!devToken) return next();
    if (bypass.has(req.path)) return next();

    const fromQuery = req.query?.[cookieName];
    const tokenFromQuery = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
    const tokenFromCookie = readCookie(req, cookieName);

    if (tokenFromQuery !== devToken && tokenFromCookie !== devToken) {
      res.status(404).type("text/plain").send("Not Found");
      return;
    }

    if (tokenFromQuery === devToken) {
      res.setHeader(
        "Set-Cookie",
        `${cookieName}=${encodeURIComponent(devToken)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`,
      );
    }

    next();
  };
}
