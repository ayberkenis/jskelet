/**
 * Admin paneli erişim kapısı: IP allowlist, bot UA engeli, ban sayacı.
 *
 * Yasaklı / reddedilen her cevap 404: 401/403 panelin varlığını doğrular.
 */
import net from "node:net";

/** Bilinen crawler / bot imzaları (küçük harf). */
const BOT_MARKERS = [
  "googlebot",
  "bingbot",
  "slurp",
  "duckduckbot",
  "baiduspider",
  "yandexbot",
  "sogou",
  "exabot",
  "facebot",
  "facebookexternalhit",
  "ia_archiver",
  "applebot",
  "semrushbot",
  "ahrefsbot",
  "mj12bot",
  "dotbot",
  "petalbot",
  "bytespider",
  "gptbot",
  "claudebot",
  "ccbot",
  "amazonbot",
  "twitterbot",
  "linkedinbot",
  "embedly",
  "quora link preview",
  "showyoubot",
  "outbrain",
  "pinterest",
  "redditbot",
  "whatsapp",
  "telegrambot",
  "discordbot",
  "crawler",
  "spider",
  "bot/",
  "bot;",
];

/** @type {Map<string, { fails: number, bannedUntil: number }>} */
const offenders = new Map();

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
export function clientKey(req) {
  // `trust proxy` ayarı `req.ip`e yansıyor; ters proxy arkasında doğru IP,
  // doğrudan internete açık bir sunucuda soket adresi kullanılır.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * @param {string} ua
 * @returns {boolean}
 */
export function looksLikeBot(ua) {
  if (!ua) return true;
  const lower = ua.toLowerCase();
  return BOT_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Exact IP veya CIDR (`10.0.0.0/8`). IPv6 için yalnızca exact eşleşme.
 *
 * @param {string} ip
 * @param {string[]} allowIps
 * @returns {boolean}
 */
export function ipAllowed(ip, allowIps) {
  if (!allowIps.length) return true;

  const normalized = normalizeIp(ip);
  if (!normalized) return false;

  for (const entry of allowIps) {
    if (entry.includes("/")) {
      if (matchCidr(normalized, entry)) return true;
      continue;
    }
    if (normalizeIp(entry) === normalized) return true;
  }

  return false;
}

/**
 * @param {string} ip
 * @returns {string | null}
 */
function normalizeIp(ip) {
  if (!ip) return null;
  // Express IPv4-mapped IPv6: `:ffff:127.0.0.1`
  const mapped = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  return mapped;
}

/**
 * @param {string} ip
 * @param {string} cidr
 * @returns {boolean}
 */
function matchCidr(ip, cidr) {
  const [network, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  if (net.isIPv4(ip) && net.isIPv4(network)) {
    const ipNum = ipv4ToInt(ip);
    const netNum = ipv4ToInt(network);
    if (ipNum === null || netNum === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipNum & mask) === (netNum & mask);
  }
  return false;
}

/**
 * @param {string} ip
 * @returns {number | null}
 */
function ipv4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function banned(req) {
  const record = offenders.get(clientKey(req));
  if (!record) return false;

  if (record.bannedUntil && Date.now() >= record.bannedUntil) {
    offenders.delete(clientKey(req));
    return false;
  }

  return record.bannedUntil > 0;
}

/**
 * @param {import('express').Request} req
 * @param {string} reason
 * @param {{ banAttempts: number, banHours: number }} settings
 */
export function noteFailure(req, reason, settings) {
  const key = clientKey(req);
  const record = offenders.get(key) ?? { fails: 0, bannedUntil: 0 };
  record.fails += 1;

  if (record.fails >= settings.banAttempts) {
    record.bannedUntil = Date.now() + settings.banHours * 3600_000;
    console.warn(
      `[admin] ${key} banned for ${settings.banHours}h after ` +
        `${record.fails} failed attempts (${reason})`,
    );
  }

  offenders.set(key, record);
}

/**
 * @param {import('express').Request} req
 */
export function clearOffender(req) {
  offenders.delete(clientKey(req));
}

/**
 * Kapı middleware'i: ban → IP → bot. Hepsi 404.
 *
 * @param {() => typeof import('../../config/defaults.js').DEFAULT_ADMIN} getSettings
 * @returns {import('express').RequestHandler}
 */
export function gateMiddleware(getSettings) {
  return (req, res, next) => {
    if (banned(req)) {
      res.status(404).type("text/plain").send("Not Found");
      return;
    }

    const settings = getSettings();

    if (!ipAllowed(clientKey(req), settings.allowIps)) {
      res.status(404).type("text/plain").send("Not Found");
      return;
    }

    if (settings.blockBots && looksLikeBot(String(req.headers["user-agent"] ?? ""))) {
      res.status(404).type("text/plain").send("Not Found");
      return;
    }

    next();
  };
}
