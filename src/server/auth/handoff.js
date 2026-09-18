/**
 * Alt alan adı handoff: kısa ömürlü tek kullanımlık bilet.
 *
 * Akış:
 *   1. Paylaşımlı cookie yazımı başarısız (istemci read-back fail)
 *   2. POST /_jskelet/auth/handoff { name, value, next }
 *   3. Yanıt { url: "https://tr.…/path?handoff=TICKET" }
 *   4. Hedef host'ta GET middleware bileti tüketir → Set-Cookie + 303
 *
 * Bilet süreç belleğinde; tek süreçte tüm locale host'ları servis eden
 * kurulumlar için yeterli. Değer kısa session id olmalı.
 */
import { getConfig } from "../../config/index.js";
import { randomToken, setCookie } from "../../http/cookies.js";
import {
  SHARED_COOKIE_WARN_BYTES,
  requestIsHttps,
  writeSharedCookie,
} from "../../http/shared-cookie.js";
import { resolveSharedCookieDomain } from "../../shared/cookie-domain.js";

/** @type {Map<string, { name: string, value: string, maxAge?: number, exp: number }>} */
const tickets = new Map();

const DEFAULT_TTL_SECONDS = 60;
const HANDOFF_PATH = "/_jskelet/auth/handoff";

/**
 * @returns {{ enabled: boolean, ttlSeconds: number, path: string, maxValueBytes: number }}
 */
function settings() {
  const auth = getConfig().auth ?? {};
  const raw = auth.crossSubdomainHandoff;
  if (raw === false || raw == null) {
    return {
      enabled: false,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      path: HANDOFF_PATH,
      maxValueBytes: SHARED_COOKIE_WARN_BYTES,
    };
  }

  if (raw === true) {
    return {
      enabled: true,
      ttlSeconds: DEFAULT_TTL_SECONDS,
      path: HANDOFF_PATH,
      maxValueBytes: SHARED_COOKIE_WARN_BYTES,
    };
  }

  const source = /** @type {Record<string, unknown>} */ (raw);
  const ttl = Number(source.ttlSeconds);
  const maxBytes = Number(source.maxValueBytes);
  return {
    enabled: source.enabled !== false,
    ttlSeconds:
      Number.isFinite(ttl) && ttl > 0 ? Math.min(300, Math.floor(ttl)) : DEFAULT_TTL_SECONDS,
    path:
      typeof source.path === "string" && source.path.startsWith("/")
        ? source.path
        : HANDOFF_PATH,
    maxValueBytes:
      Number.isFinite(maxBytes) && maxBytes > 0
        ? Math.floor(maxBytes)
        : SHARED_COOKIE_WARN_BYTES,
  };
}

function sweep() {
  const now = Date.now();
  for (const [id, entry] of tickets) {
    if (entry.exp <= now) tickets.delete(id);
  }
}

/**
 * @param {string} next
 * @param {import('express').Request} req
 * @returns {URL | null}
 */
function parseNext(next, req) {
  try {
    return new URL(next, `${req.protocol}://${req.get("host")}`);
  } catch {
    return null;
  }
}

/**
 * @param {URL} url
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function nextAllowed(url, req) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const roots = getConfig().brand?.sharedCookieRoots ?? [];
  const targetHost = url.hostname.toLowerCase();
  const sourceHost = String(req.hostname || "")
    .toLowerCase()
    .replace(/:\d+$/, "");

  if (targetHost === sourceHost) return true;

  const sourceRoot = resolveSharedCookieDomain(sourceHost, roots);
  const targetRoot = resolveSharedCookieDomain(targetHost, roots);
  return Boolean(sourceRoot && targetRoot && sourceRoot === targetRoot);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ name: string, value: string, maxAge?: number }} payload
 * @returns {void}
 */
function issueCookie(req, res, payload) {
  const shared = writeSharedCookie(res, payload.name, payload.value, {
    req,
    maxAge: payload.maxAge,
  });

  if (shared.ok) return;

  setCookie(res, payload.name, payload.value, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: requestIsHttps(req),
    maxAge: payload.maxAge,
  });
}

/**
 * @param {string} ticketId
 * @returns {{ name: string, value: string, maxAge?: number } | null}
 */
function redeem(ticketId) {
  sweep();
  const entry = tickets.get(ticketId);
  if (!entry) return null;
  tickets.delete(ticketId);
  if (entry.exp <= Date.now()) return null;
  return { name: entry.name, value: entry.value, maxAge: entry.maxAge };
}

/**
 * Handoff uçlarını mount eder. `auth.crossSubdomainHandoff` kapalıysa no-op.
 *
 * @param {import('express').Express} app
 * @returns {void}
 */
export function mountAuthHandoff(app) {
  const cfg = settings();
  if (!cfg.enabled) return;

  app.post(cfg.path, (req, res) => {
    sweep();

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const value = typeof req.body?.value === "string" ? req.body.value : "";
    const next = typeof req.body?.next === "string" ? req.body.next.trim() : "";
    const maxAge =
      req.body?.maxAge != null && Number.isFinite(Number(req.body.maxAge))
        ? Math.floor(Number(req.body.maxAge))
        : undefined;

    if (!name || !next) {
      res.status(400).json({ ok: false, error: "name and next are required" });
      return;
    }

    if (Buffer.byteLength(value, "utf8") > cfg.maxValueBytes) {
      res.status(400).json({
        ok: false,
        error: `value exceeds ${cfg.maxValueBytes} bytes; use a short session id`,
      });
      return;
    }

    const nextUrl = parseNext(next, req);
    if (!nextUrl || !nextAllowed(nextUrl, req)) {
      res.status(400).json({ ok: false, error: "next is not an allowed URL" });
      return;
    }

    const id = randomToken(24);
    tickets.set(id, {
      name,
      value,
      maxAge,
      exp: Date.now() + cfg.ttlSeconds * 1000,
    });

    nextUrl.searchParams.set("handoff", id);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, url: nextUrl.href });
  });

  // Hedef host'ta `?handoff=` yakala — route render'ından önce.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const ticket = typeof req.query?.handoff === "string" ? req.query.handoff : "";
    if (!ticket) return next();

    const payload = redeem(ticket);
    if (!payload) return next();

    issueCookie(req, res, payload);

    const url = new URL(req.originalUrl || req.url, `${req.protocol}://${req.get("host")}`);
    url.searchParams.delete("handoff");
    res.setHeader("Cache-Control", "no-store");
    res.redirect(303, url.pathname + url.search + url.hash);
  });
}

/** @returns {void} */
export function _resetHandoffTickets() {
  tickets.clear();
}

/** @returns {number} */
export function _handoffTicketCount() {
  return tickets.size;
}
