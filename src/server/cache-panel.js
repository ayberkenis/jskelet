/**
 * Önbellek yönetim paneli: bellek içi kademenin (L1) ve paylaşımlı Redis
 * kademesinin (L2) durumunu gösterir, hedefli invalidation ve ısıtma
 * tetikler.
 *
 * Neden dev araçlarından ayrı: dev overlay yalnızca `NODE_ENV=development`
 * iken mount ediliyor ve asıl soru ("şu sayfa neden bayat", "webhook purge'ü
 * geçti mi") üretimde soruluyor. Bu yüzden panel ortama bakmaz, **config'e**
 * bakar: `cache().panel.enabled` ya da `JSKELET_CACHE_PANEL` verilmedikçe
 * router hiç mount edilmez — kapalıyken yolun kendisi de yoktur.
 *
 * ## Erişim
 *
 * Şifre her süreç başlangıcında yeniden üretilir ve **yalnızca sunucu
 * logunda** görünür. Kalıcı bir sır (config alanı, env) tutmamanın iki
 * sebebi var: sızan bir sır önbelleği boşaltma yetkisi demek, ve her deploy
 * eski erişimi kendiliğinden iptal etmeli. Şifre query string ile de kabul
 * edilmez; erişim logları ve `Referer` başlığı sırrı taşımasın.
 *
 * Başarısız denemeler IP başına sayılır ve sınır aşıldığında IP 24 saat
 * yasaklanır. Yasaklı ve yetkisiz her cevap **404**: 401/403 panelin var
 * olduğunu doğrular, 404 hiç yokmuş gibi davranır.
 *
 * Sayaç ve yasaklar süreç belleğinde durur. Diske yazmak, şifresi zaten her
 * restart'ta değişen bir panel için yanlış takas olurdu.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import express from "express";
import { FRAMEWORK_ROOT, getConfig } from "../config/index.js";
import { safeEqual } from "../http/cookies.js";
import {
  clearHtmlCache,
  dropHtmlCacheKey,
  getHtmlCacheEntries,
  getHtmlCacheSize,
  invalidateHtmlCache,
} from "./html-cache.js";
import {
  clearDataCache,
  dropDataCacheKey,
  getDataCacheEntries,
  getDataCacheSize,
} from "./data-cache.js";
import { getRedisStatus, redisDropMatching } from "./redis.js";
import { getUpstreamLimiterStatus } from "./upstream-limiter.js";
import { prewarm, prewarmProgress } from "./prewarm.js";

/** Panel dosyaları framework paketinden servis edilir, uygulamadan değil. */
const PANEL_DIR = path.join(FRAMEWORK_ROOT, "src", "client", "cache-panel");

const COOKIE_NAME = "jskelet_cache_sid";

/**
 * Aksiyon isteklerinde beklenen başlık. Tarayıcı bu başlığı çapraz site bir
 * formla gönderemez (preflight gerekir), yani panelin kendi CSRF freni.
 * Middleware sırasındaki `csrf()`den bağımsız olması gerekiyor: panel body
 * parser'lardan önce mount ediliyor ve kendi gövdesini kendisi ayrıştırıyor.
 */
const ACTION_HEADER = "x-jskelet-cache-panel";

/** Listelerin üst sınırı: veri önbelleğinde on binlerce anahtar olabiliyor. */
const MAX_LISTED = 500;

const BOOT_ID = `${Date.now()}-${process.pid}`;

/** 32 haneli, süreç ömrü kadar geçerli şifre. */
const PASSWORD = crypto.randomBytes(16).toString("hex");

/** @type {Map<string, number>} token → son kullanma zamanı. */
const sessions = new Map();

/** @type {Map<string, { fails: number, bannedUntil: number }>} */
const offenders = new Map();

/** @type {typeof import('../config/defaults.js').DEFAULT_CACHE_PANEL} */
let settings;

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
function clientKey(req) {
  // `trust proxy` ayarı `req.ip`e yansıyor; ters proxy arkasında doğru IP,
  // doğrudan internete açık bir sunucuda soket adresi kullanılır.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function banned(req) {
  const record = offenders.get(clientKey(req));
  if (!record) return false;

  if (record.bannedUntil && Date.now() >= record.bannedUntil) {
    offenders.delete(clientKey(req));
    return false;
  }

  return record.bannedUntil > 0;
}

/**
 * Başarısız denemeyi işler. Sınır aşılırsa IP yasaklanır ve bu tek satır
 * loglanır: paneli internete açmış bir kurulumda saldırı denemesinin görünür
 * olması gerekiyor.
 *
 * @param {import('express').Request} req
 * @param {string} reason
 */
function noteFailure(req, reason) {
  const key = clientKey(req);
  const record = offenders.get(key) ?? { fails: 0, bannedUntil: 0 };
  record.fails += 1;

  if (record.fails >= settings.banAttempts) {
    record.bannedUntil = Date.now() + settings.banHours * 3600_000;
    console.warn(
      `[cache-panel] ${key} banned for ${settings.banHours}h after ` +
        `${record.fails} failed attempts (${reason})`,
    );
  }

  offenders.set(key, record);
}

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function authenticated(req) {
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
 * Cookie okuma burada elle yapılıyor: `parseCookies()` isteği "kişiye bağlı"
 * işaretliyor ve o işaret render yolundaki önbellek kararı için — panelin
 * kendi isteklerinde anlamı yok.
 *
 * @param {import('express').Request} req
 * @param {string} name
 * @returns {string | null}
 */
function readCookie(req, name) {
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
 * Süresi geçmiş oturumları eler. Panel uzun süre açık kalabiliyor; harita
 * sessizce büyümesin.
 */
function pruneSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of sessions) {
    if (now >= expiresAt) sessions.delete(token);
  }
}

/**
 * @param {import('express').Response} res
 */
function notFound(res) {
  res.status(404).type("text/plain").send("Not Found");
}

/* ------------------------------------------------------------------ döküm */

/**
 * Panelin gösterdiği her şey tek pakette.
 *
 * HTML gövdesi ve veri değerleri **dönmez**: panelin işi durumu göstermek,
 * içeriği dışa vermek değil. Listeler `MAX_LISTED` ile kesilir ve arama
 * sunucuda uygulanır — on binlik bir anahtar listesini tarayıcıya
 * göndermenin faydası yok.
 *
 * @param {string} query Anahtar filtresi (boş → filtre yok).
 * @returns {object}
 */
function snapshot(query) {
  const term = query.trim().toLowerCase();
  /** @param {{ key: string }} entry */
  const matches = (entry) => !term || entry.key.toLowerCase().includes(term);

  const html = getHtmlCacheEntries();
  const data = getDataCacheEntries();

  const htmlMatched = html.filter(matches);
  const dataMatched = data.filter(matches);
  const usage = process.memoryUsage();

  return {
    boot: BOOT_ID,
    generatedAt: Date.now(),
    process: {
      pid: process.pid,
      node: process.version,
      uptime: process.uptime(),
      env: process.env.NODE_ENV ?? "production",
      memory: { rss: usage.rss, heapUsed: usage.heapUsed },
    },
    html: {
      size: getHtmlCacheSize(),
      maxEntries: getConfig().htmlMaxEntries,
      bytes: html.reduce((total, entry) => total + entry.bytes, 0),
      stale: html.filter((entry) => entry.stale).length,
      matched: htmlMatched.length,
      entries: htmlMatched
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, MAX_LISTED),
    },
    data: {
      size: getDataCacheSize(),
      maxEntries: Number(getConfig().data?.maxEntries) || 0,
      stale: data.filter((entry) => entry.stale).length,
      matched: dataMatched.length,
      entries: dataMatched
        .sort((a, b) => a.expiresIn - b.expiresIn)
        .slice(0, MAX_LISTED),
    },
    redis: getRedisStatus(),
    upstream: getUpstreamLimiterStatus(),
    prewarm: { ...prewarmProgress },
  };
}

/* --------------------------------------------------------------- aksiyonlar */

/**
 * Panelden gelen işlemi uygular ve kullanıcıya gösterilecek özeti döner.
 *
 * Her işlem yerel kademeyi düşürüp paylaşımlı kademeye de yayılıyor (bkz.
 * `html-cache.js`, `data-cache.js`): tek node'un önbelleğini boşaltmak,
 * kümede çalışan bir kurulumda "temizledim ama hâlâ eski" sorusunu üretir.
 *
 * @param {Record<string, any>} body
 * @param {import('express').Request} req
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
async function runAction(body, req) {
  const type = String(body?.type ?? "");

  switch (type) {
    case "html:clear": {
      const size = getHtmlCacheSize();
      clearHtmlCache();
      return { ok: true, message: `HTML cache cleared (${size} entries)` };
    }

    case "data:clear": {
      const prefix = typeof body.prefix === "string" && body.prefix ? body.prefix : undefined;
      const removed = clearDataCache(prefix);
      return {
        ok: true,
        message: prefix
          ? `${removed} data entries dropped under \`${prefix}\``
          : `Data cache cleared (${removed} entries)`,
      };
    }

    case "html:invalidate": {
      const target = String(body.target ?? "");
      if (!target.startsWith("/")) {
        return { ok: false, message: "Target must start with `/`" };
      }

      const hard = body.hard === true;
      const count = invalidateHtmlCache(target, { hard });
      return {
        ok: true,
        message: `${count} entries ${hard ? "dropped" : "marked stale"} for \`${target}\``,
      };
    }

    case "html:drop": {
      const key = String(body.key ?? "");
      if (!key) return { ok: false, message: "Missing key" };
      const existed = dropHtmlCacheKey(key);
      return {
        ok: true,
        message: existed ? `Dropped \`${key}\`` : `\`${key}\` was not cached`,
      };
    }

    case "data:drop": {
      const key = String(body.key ?? "");
      if (!key) return { ok: false, message: "Missing key" };
      const existed = dropDataCacheKey(key);
      return {
        ok: true,
        message: existed ? `Dropped \`${key}\`` : `\`${key}\` was not cached`,
      };
    }

    case "redis:drop": {
      const kind = body.kind === "data" ? "data" : "html";
      const status = getRedisStatus();
      if (!status.connected) {
        return { ok: false, message: "Redis is not connected" };
      }

      const dropped = await redisDropMatching(kind);
      return { ok: true, message: `${dropped} shared ${kind} keys dropped` };
    }

    case "prewarm": {
      if (prewarmProgress.active) {
        return { ok: false, message: "A prewarm round is already running" };
      }

      const requested = Array.isArray(body.paths) ? body.paths : [];
      const paths = requested.filter(
        (/** @type {unknown} */ value) =>
          typeof value === "string" && value.startsWith("/"),
      );

      // Isıtma beklenmez: yüzlerce yolu tarayan bir tur dakikalar sürebiliyor
      // ve panel ilerlemeyi zaten dökümden okuyor.
      prewarm({
        origin: `${req.protocol}://${req.get("host")}`,
        paths: paths.length ? paths : undefined,
      }).catch((error) => {
        console.error("[cache-panel] prewarm failed", error);
      });

      return {
        ok: true,
        message: paths.length ? `Prewarming ${paths.length} paths` : "Prewarming all paths",
      };
    }

    default:
      return { ok: false, message: `Unknown action: ${type}` };
  }
}

/* ------------------------------------------------------------------ router */

/**
 * @returns {import('express').Router}
 */
function router() {
  const api = express.Router();

  // Panelin hiçbir cevabı saklanmamalı ve hiçbir yeri indekslenmemeli:
  // önbellek durumu saniyeler içinde değişiyor ve yol arama motorunda
  // görünmemeli.
  api.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    res.setHeader("Referrer-Policy", "no-referrer");

    if (banned(req)) {
      notFound(res);
      return;
    }

    next();
  });

  // Giriş sayfası. Yetkisiz GET burada **sayaca yazılmaz**: paneli açmak
  // doğal ilk adım ve kullanıcı kendini üç sekme açmakla yasaklamamalı.
  api.get("/", (req, res) => {
    // Sayfa varlıklarını göreli yolla istiyor; sondaki `/` olmadan
    // `panel.js` bir üst dizine düşer.
    if (!req.originalUrl.split("?")[0].endsWith("/")) {
      res.redirect(302, `${settings.basePath}/`);
      return;
    }

    res.type("html");
    sendFile(res, authenticated(req) ? "panel.html" : "login.html");
  });

  // Stil giriş sayfasında da gerekiyor, yani oturumdan önce servis edilir.
  // İçinde durum bilgisi yok.
  api.get("/panel.css", (req, res) => {
    res.type("text/css");
    sendFile(res, "panel.css");
  });

  api.post("/login", express.json({ limit: "4kb" }), (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!password || !safeEqual(password, PASSWORD)) {
      noteFailure(req, password ? "wrong password" : "empty password");
      // Kalan deneme sayısı bilinçli olarak bildirilmez.
      res.status(401).json({ ok: false, message: "Invalid password" });
      return;
    }

    pruneSessions();

    const token = crypto.randomBytes(32).toString("base64url");
    const maxAge = Math.round(settings.sessionHours * 3600);
    sessions.set(token, Date.now() + maxAge * 1000);
    offenders.delete(clientKey(req));

    // `SameSite=Strict`: panel hiçbir çapraz site gezinmesinde oturum
    // taşımamalı. `Secure` üretimde açık, dev'de kapalı (http://localhost).
    res.setHeader(
      "Set-Cookie",
      [
        `${COOKIE_NAME}=${token}`,
        `Path=${settings.basePath}`,
        `Max-Age=${maxAge}`,
        "HttpOnly",
        "SameSite=Strict",
        ...(process.env.NODE_ENV === "development" ? [] : ["Secure"]),
      ].join("; "),
    );

    res.json({ ok: true });
  });

  // Buradan sonrası oturum ister.
  api.use((req, res, next) => {
    if (authenticated(req)) return next();

    noteFailure(req, `unauthenticated ${req.method} ${req.path}`);
    notFound(res);
  });

  api.post("/logout", (req, res) => {
    const token = readCookie(req, COOKIE_NAME);
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=${settings.basePath}; Max-Age=0`);
    res.json({ ok: true });
  });

  api.get("/panel.js", (req, res) => {
    res.type("application/javascript");
    sendFile(res, "panel.js");
  });

  api.get("/data", (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    res.json(snapshot(query));
  });

  api.post("/action", express.json({ limit: "64kb" }), async (req, res) => {
    if (req.get(ACTION_HEADER) !== "1") {
      notFound(res);
      return;
    }

    try {
      res.json(await runAction(req.body ?? {}, req));
    } catch (error) {
      console.error("[cache-panel] action failed", error);
      res.status(500).json({ ok: false, message: "Action failed, see server logs" });
    }
  });

  return api;
}

/**
 * @param {import('express').Response} res
 * @param {string} name
 */
function sendFile(res, name) {
  fs.createReadStream(path.join(PANEL_DIR, name)).pipe(res);
}

/**
 * Paneli uygulamaya bağlar ve şifreyi loglar.
 *
 * @param {import('express').Express} app
 */
export function mountCachePanel(app) {
  settings = getConfig().cachePanel;

  app.use(settings.basePath, router());

  const port = process.env.PORT ?? 3000;
  console.log(
    `[cache-panel] http://localhost:${port}${settings.basePath} — ` +
      `password for this run: ${PASSWORD}`,
  );
}
