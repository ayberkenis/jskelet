/**
 * Admin paneli oturum ve şifre yönetimi.
 *
 * Şifre süreç ömrü kadar; kalıcı sır yok. Cookie parse framework'ün
 * `parseCookies()` yolunu kullanmaz — o yol isteği "kişiselleştirilmiş"
 * işaretler.
 */
import crypto from "node:crypto";
import process from "node:process";
import { safeEqual } from "../../http/cookies.js";

export const COOKIE_NAME = "jskelet_admin_sid";

/**
 * Aksiyon isteklerinde beklenen başlık. Tarayıcı bu başlığı çapraz site bir
 * formla gönderemez (preflight gerekir), yani panelin kendi CSRF freni.
 */
export const ACTION_HEADER = "x-jskelet-admin";

/** 32 haneli, süreç ömrü kadar geçerli şifre. */
export const PASSWORD = crypto.randomBytes(16).toString("hex");

/** @type {Map<string, number>} token → son kullanma zamanı. */
const sessions = new Map();

/**
 * @param {import('express').Request} req
 * @param {string} name
 * @returns {string | null}
 */
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }

  return null;
}

/**
 * Süresi geçmiş oturumları eler.
 */
export function pruneSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of sessions) {
    if (now >= expiresAt) sessions.delete(token);
  }
}

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function authenticated(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return false;

  const expiresAt = sessions.get(token);
  if (expiresAt === undefined) return false;

  if (Date.now() >= expiresAt) {
    sessions.delete(token);
    return false;
  }

  return true;
}

/**
 * @param {string} password
 * @returns {boolean}
 */
export function passwordMatches(password) {
  return Boolean(password) && safeEqual(password, PASSWORD);
}

/**
 * @param {number} sessionHours
 * @returns {{ token: string, maxAge: number }}
 */
export function createSession(sessionHours) {
  pruneSessions();
  const token = crypto.randomBytes(32).toString("base64url");
  const maxAge = Math.round(sessionHours * 3600);
  sessions.set(token, Date.now() + maxAge * 1000);
  return { token, maxAge };
}

/**
 * @param {import('express').Request} req
 */
export function destroySession(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (token) sessions.delete(token);
}

/**
 * @param {string} basePath
 * @param {string} token
 * @param {number} maxAge
 * @returns {string}
 */
export function sessionCookie(basePath, token, maxAge) {
  return [
    `${COOKIE_NAME}=${token}`,
    `Path=${basePath}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(process.env.NODE_ENV === "development" ? [] : ["Secure"]),
  ].join("; ");
}

/**
 * @param {string} basePath
 * @returns {string}
 */
export function clearSessionCookie(basePath) {
  return `${COOKIE_NAME}=; Path=${basePath}; Max-Age=0`;
}
