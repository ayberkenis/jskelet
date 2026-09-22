/**
 * Yayına açılmamış bir ortamı gizler. Gate kapalıyken (varsayılan) `DEV_TOKEN`
 * olsa bile istekler geçer: değişkenin task ortamında unutulması production'u
 * kilitlemesin. Açmak için `devGate: true` ya da `DEV_GATE=1` gerekir; o zaman
 * token taşımayan her isteğe 404 döner. 403 değil 404 — 403 ortamın var
 * olduğunu doğrular, 404 hiç yokmuş gibi davranır.
 *
 * Token bir kez `?dev_token=…` ile gelirse çereze yazılır, böylece link
 * paylaşımı yeterli olur. Token boşsa gate açık olsa da kimse kilitlenmez.
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
  const { devGate: enabled, devGateBypass, brand } = getConfig();
  const bypass = new Set(devGateBypass);
  const cookieName = brand.devTokenCookie;
  const devToken = process.env.DEV_TOKEN;

  // Unutulmuş bir değişken sessizce herkese 404 kesmesin; operatör görsün.
  if (!enabled && devToken) {
    console.warn(
      "[dev-gate] DEV_TOKEN is set but the gate is off, so the site stays public. " +
        "Set devGate: true or DEV_GATE=1 to require the token.",
    );
  } else if (enabled && !devToken) {
    console.warn(
      "[dev-gate] the gate is on but DEV_TOKEN is empty; requests are not blocked.",
    );
  }

  return (req, res, next) => {
    if (!enabled || !devToken) return next();
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
