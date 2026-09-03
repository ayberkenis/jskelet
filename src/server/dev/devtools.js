/**
 * Dev overlay'in sunucu tarafı: istek/render ölçümleri, hata günlüğü ve
 * overlay modülünün servisi.
 *
 * Yalnızca `NODE_ENV=development` iken `create-app.js` tarafından mount
 * edilir; build çıktısına hiçbir şey eklemez (overlay dosyası esbuild
 * entry'si değil, doğrudan diskten servis edilir).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import express from "express";
import * as log from "../../log.mjs";
import { FRAMEWORK_ROOT, getConfig } from "../../config/index.js";
import { getRequestContext } from "../../http/request-context.js";
import { prewarm, prewarmProgress } from "../prewarm.js";
import { clearHtmlCache } from "../html-cache.js";
import {
  buildReport,
  clearPageReports,
  recordPageReport,
  trackServerFetch,
} from "./report.js";
import { startVersionCheck, versionStatus } from "./version-check.mjs";
import { broadcastSocket, socketCount, upgradeToSocket } from "./socket.js";

/** Overlay dosyaları framework paketinden servis edilir, uygulamadan değil. */
const DEVTOOLS_DIR = path.join(FRAMEWORK_ROOT, "src", "client", "devtools");
const OVERLAY_FILE = path.join(DEVTOOLS_DIR, "overlay.js");
const LOGO_FILE = path.join(FRAMEWORK_ROOT, "src", "logo.png");

/** @type {ReturnType<typeof getConfig>["brand"]} */
let brand;

/** Her sürecin kendine özgü kimliği; overlay restart'ı buradan anlar. */
const BOOT_ID = `${Date.now()}-${process.pid}`;

const MAX_ENTRIES = 50;

// Kayıtlar süreç belleğinde durursa `node --watch` her yeniden başlatmada
// geçmişi siler ve overlay boşalır. Bu dosya restart'lar arasında istek/hata
// geçmişini taşır.
//
// Proje ağacına yazılmaz: her yazma `node --watch`'u tetikleyip sunucuyu
// yeniden başlatıyordu ve bu kendini besleyen bir döngü kuruyordu
// (restart → açılış uyarısı → yazma → restart).
const STATE_FILE = path.join(
  os.tmpdir(),
  `jskelet-devtools-${createHash("sha1")
    .update(getConfig().root)
    .digest("hex")
    .slice(0, 10)}.json`,
);

/** @type {{ id: number, method: string, url: string, status: number, ms: number, cache: string | null, at: number }[]} */
let requests = [];

/**
 * @typedef {{
 *   id: number,
 *   level: string,
 *   message: string,
 *   stack: string | null,
 *   url: string | null,
 *   page: string | null,
 *   island: string | null,
 *   details: unknown,
 *   at: number,
 * }} ServerError
 */

/** @type {ServerError[]} */
let errors = [];

let nextId = 1;

/** Süreç başlarken önceki turun kayıtlarını geri yükler. */
function restore() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    requests = saved.requests ?? [];
    errors = saved.errors ?? [];
    nextId =
      Math.max(0, ...requests.map((item) => item.id), ...errors.map((item) => item.id)) + 1;
  } catch {
    // İlk çalıştırma ya da bozuk dosya: temiz başla.
  }
}

/** @type {NodeJS.Timeout | null} */
let saveTimer = null;

/** Yazma her istekte değil, kısa bir sessizlikten sonra yapılır. */
function persist() {
  if (saveTimer) return;

  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify({ requests, errors }));
    } catch {
      // Günlük kalıcılığı en iyi çaba; başarısızlık dev akışını durdurmamalı.
    }
  }, 300);

  saveTimer.unref?.();
}

/**
 * @param {unknown[]} list
 */
function trim(list) {
  while (list.length > MAX_ENTRIES) list.shift();
}

/**
 * @param {string} level
 * @param {string} message
 * @param {{
 *   stack?: string | null,
 *   url?: string | null,
 *   page?: string | null,
 *   island?: string | null,
 *   details?: unknown,
 * }} [extra]
 */
export function recordServerError(level, message, extra = {}) {
  errors.push({
    id: nextId++,
    level,
    message,
    stack: extra.stack ?? null,
    url: extra.url ?? null,
    page: extra.page ?? null,
    island: extra.island ?? null,
    details: extra.details ?? null,
    at: Date.now(),
  });
  trim(errors);
  persist();
  pushStats();
}

/**
 * `console.error` / `console.warn` çıktısını da overlay'e taşır: sunucudaki
 * uyarılar terminalde kaybolmasın. Render bağlamındaysa sayfa yolu da yazılır.
 */
function patchConsole() {
  for (const level of /** @type {const} */ (["error", "warn"])) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const error = args.find((arg) => arg instanceof Error);
      const page = currentPage();
      recordServerError(level, args.map(format).join(" "), {
        stack: error?.stack ?? null,
        page,
        url: page,
        details: extractDetails(args),
      });
      original(...args);
    };
  }
}

/** @returns {string | null} */
function currentPage() {
  return getRequestContext()?.pathname ?? null;
}

/**
 * console argümanlarından yapılandırılmış bir `details` alanı ayıklar.
 * Uygulama `console.error("msg", { details: {...} })` yazdığında overlay
 * nesneyi `[object Object]` yerine açılabilir JSON olarak görsün.
 *
 * @param {unknown[]} args
 * @returns {unknown}
 */
function extractDetails(args) {
  for (const arg of args) {
    if (!arg || typeof arg !== "object" || arg instanceof Error) continue;
    const record = /** @type {Record<string, unknown>} */ (arg);
    if ("details" in record) return record.details;
    if ("detail" in record) return record.detail;
    return record;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function format(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value, (_key, nested) => {
      // Döngüsel referanslarda stringify zaten fırlar; burada yalnızca
      // Error örneklerini okunabilir kılmak yeterli.
      if (nested instanceof Error) {
        return { name: nested.name, message: nested.message };
      }
      return nested;
    });
  } catch {
    return String(value);
  }
}

/**
 * Upstream `fetch` başarısızlığını overlay hata listesine yazar.
 *
 * @param {{
 *   url: string,
 *   method: string,
 *   status: number,
 *   ms: number,
 *   bytes: number,
 *   error: string | null,
 *   page: string | null,
 *   details: unknown,
 * }} call
 */
function recordApiFailure(call) {
  // Aynı SSR turunda hem fetch sarmalayıcısı hem uygulama logger'ı aynı
  // hatayı basabiliyor; kısa pencerede tekilleştir.
  const last = errors.at(-1);
  if (
    last &&
    last.url === call.url &&
    last.page === call.page &&
    Date.now() - last.at < 2000
  ) {
    // İlk kayıtta details yoksa sonrakinin gövdesini birleştir.
    if (last.details == null && call.details != null) {
      last.details = call.details;
      if (call.error && !last.message.includes(call.error)) {
        last.message = `${call.method} ${shortApiPath(call.url)} → ${call.error}`;
      }
      persist();
      pushStats();
    }
    return;
  }

  recordServerError("error", `${call.method} ${shortApiPath(call.url)} → ${call.error ?? call.status}`, {
    url: call.url,
    page: call.page,
    details: call.details,
    stack: null,
  });
}

/** @param {string} url */
function shortApiPath(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

/** Her HTML isteğinin süresini ve cache durumunu kaydeder. */
function timing() {
  /** @type {import('express').RequestHandler} */
  return (req, res, next) => {
    if (req.path.startsWith(brand.devBasePath)) return next();

    // Önbellek ısıtması yüzlerce istek atıyor; terminali ve panelin istek
    // listesini doldurmasın. İlerlemesi baloncuğun yanındaki rozette görünür.
    if (req.headers["user-agent"] === brand.prewarmUserAgent) return next();

    const started = process.hrtime.bigint();

    res.on("finish", () => {
      const type = res.getHeader("Content-Type");
      if (!String(type ?? "").includes("text/html")) return;

      const entry = {
        id: nextId++,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms: Number(process.hrtime.bigint() - started) / 1e6,
        cache: /** @type {string | null} */ (res.getHeader(brand.cacheHeader) ?? null),
        at: Date.now(),
      };

      requests.push(entry);
      trim(requests);
      persist();
      pushStats();
      // Terminalde canlı istek satırı.
      log.http(entry);
    });

    next();
  };
}

/* ----------------------------------------------------------- istatistikler */

/**
 * Overlay'in gösterdiği her şey tek pakette. `GET /stats` ve WebSocket aynı
 * gövdeyi kullanır ki panel hangi yoldan beslenirse beslensin aynı şeyi
 * görsün.
 *
 * @returns {object}
 */
function statsPayload() {
  const usage = process.memoryUsage();

  return {
    type: "stats",
    pid: process.pid,
    // Overlay yeniden başlatmayı bu kimlikten anlar; kendi durumunu
    // sıfırlamadan yalnızca "restarted" bilgisini gösterir.
    boot: BOOT_ID,
    uptime: process.uptime(),
    node: process.version,
    version: versionStatus(),
    memory: { rss: usage.rss, heapUsed: usage.heapUsed },
    prewarm: { ...prewarmProgress },
    requests: requests.slice(-25).reverse(),
    errors: errors.slice(-25).reverse(),
  };
}

/** @type {NodeJS.Timeout | null} */
let statsTimer = null;

/**
 * Değişiklikleri panele iter. Bir sayfa yüklemesi arka arkaya birçok kayıt
 * üretiyor (istek + uyarılar); paket başına bir çerçeve yerine kısa bir
 * sessizlikten sonra tek çerçeve gönderilir.
 */
function pushStats() {
  if (statsTimer || !socketCount()) return;

  statsTimer = setTimeout(() => {
    statsTimer = null;
    broadcastSocket(statsPayload());
  }, 120);

  statsTimer.unref?.();
}

/**
 * Zamana bağlı alanlar (uptime, bellek, ısıtma sayacı) bir olay üretmiyor;
 * onlar için sabit bir kalp atışı var. Bilinçli olarak ısıtmadan bağımsız:
 * kanalın temposu bir arka plan işine göre değişirse panel de o işin ritmine
 * bağlanmış olur.
 *
 * Bağlı panel yokken hiçbir şey hesaplanmaz.
 */
function startHeartbeat() {
  const timer = setInterval(() => {
    if (!socketCount()) return;
    broadcastSocket(statsPayload());
  }, 2000);

  timer.unref?.();
}

/* ------------------------------------------------------------ live reload */

/** @type {Set<import('express').Response>} */
const clients = new Set();

/**
 * @param {import('express').Response} res
 * @param {object} payload
 */
function send(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Canlı yenileme olayları. Panel normalde WebSocket üzerinden dinler; SSE
 * yalnızca soket kurulamadığında devreye giren yedek yol.
 *
 * @param {object} payload
 */
function broadcast(payload) {
  broadcastSocket(payload);
  for (const client of clients) send(client, payload);
}

/**
 * Build watch'ı manifest'i her turda yeniden yazar. CSS değiştiyse sayfa
 * yenilenmeden stylesheet takas edilir (durum ve kaydırma korunur); JS ya da
 * başka bir varlık değiştiyse tam yenileme gerekir.
 */
function watchManifest() {
  const file = path.join(getConfig().dirs.generated, "manifest.json");

  /** @returns {Record<string, string>} */
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };

  let previous = read();
  /** @type {NodeJS.Timeout | null} */
  let timer = null;

  try {
    fs.watch(path.dirname(file), (event, name) => {
      if (name !== "manifest.json") return;

      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = read();
        const changed = Object.keys(next).filter((key) => next[key] !== previous[key]);
        previous = next;

        if (!changed.length) return;

        // Önbellekteki HTML eski hash'li varlık URL'lerini taşıyor; temizlenmezse
        // sayfa silinmiş dosyayı istemeye devam eder.
        clearHtmlCache();

        if (changed.length === 1 && changed[0] === "app.css") {
          broadcast({ type: "css", href: next["app.css"] });
          return;
        }

        broadcast({ type: "reload" });
      }, 120);
    });
  } catch {
    // Watch desteklenmiyorsa live reload devre dışı kalır; gerisi çalışır.
  }
}

/**
 * Overlay script'i + istatistik uçları.
 * @returns {import('express').Router}
 */
function router() {
  const api = express.Router();

  api.get("/overlay.js", (req, res) => {
    res.type("application/javascript");
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(OVERLAY_FILE).pipe(res);
  });

  // Overlay'in SEO taraması; native ESM import ile yüklenir.
  api.get("/seo.js", (req, res) => {
    res.type("application/javascript");
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(path.join(DEVTOOLS_DIR, "seo.js")).pipe(res);
  });

  api.get("/logo.png", (req, res) => {
    res.type("image/png");
    // Logo geliştirme sırasında değişmiyor; her gezinmede yeniden indirmesin.
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(LOGO_FILE).pipe(res);
  });

  api.get("/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });

    send(res, { type: "hello", boot: BOOT_ID });
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });

  // WebSocket kurulamadığında panelin düştüğü yedek uç.
  api.get("/stats", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(statsPayload());
  });

  // Detaylı rapor: kendi sayfası, script'i ve veri ucu.
  api.get("/report", (req, res) => {
    res.type("html");
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(path.join(DEVTOOLS_DIR, "report.html")).pipe(res);
  });

  api.get("/report.js", (req, res) => {
    res.type("application/javascript");
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(path.join(DEVTOOLS_DIR, "report.js")).pipe(res);
  });

  api.get("/report/data", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(
      buildReport({
        requests: requests.slice().reverse(),
        errors: errors.slice().reverse(),
      }),
    );
  });

  // Overlay her sayfadan ölçüm paketi gönderir; rapor bunları biriktirir.
  api.post("/vitals", express.json({ limit: "512kb" }), (req, res) => {
    recordPageReport(req.body);
    res.status(204).end();
  });

  api.post("/report/clear", (req, res) => {
    clearPageReports();
    res.json({ ok: true });
  });

  // Panelden ısıtmayı elle tetikleme. Gövdede `paths` gelirse yalnızca o
  // yollar denenir; boşsa sitemap'in tamamı baştan taranır.
  api.post("/prewarm", express.json({ limit: "256kb" }), (req, res) => {
    if (prewarmProgress.active) {
      res.status(409).json({ ok: false, reason: "active" });
      return;
    }

    const requested = Array.isArray(req.body?.paths) ? req.body.paths : [];
    const paths = requested.filter(
      (value) => typeof value === "string" && value.startsWith("/"),
    );

    prewarm({
      origin: `${req.protocol}://${req.get("host")}`,
      paths: paths.length ? paths : undefined,
    }).catch((error) => {
      console.error("[prewarm] manual trigger failed", error);
    });

    res.json({ ok: true, scope: paths.length || "all" });
  });

  api.post("/clear", express.json({ limit: "8kb" }), (req, res) => {
    errors.length = 0;
    requests.length = 0;
    persist();
    pushStats();
    res.json({ ok: true });
  });

  return api;
}

/**
 * Dev araçlarını uygulamaya bağlar.
 * @param {import('express').Express} app
 */
export function mountDevtools(app) {
  brand = getConfig().brand;

  restore();
  patchConsole();
  trackServerFetch({ onFailure: recordApiFailure });
  watchManifest();
  startVersionCheck();
  startHeartbeat();
  app.use(timing());
  app.use(brand.devBasePath, router());
}

/**
 * Canlı kanalı HTTP sunucusuna bağlar.
 *
 * Express uygulamasına takılamıyor: WebSocket el sıkışması `upgrade` olayında
 * geçiyor ve o olay middleware zincirine hiç uğramıyor. Bu yüzden `listen`
 * sonrası ayrı bir adım.
 *
 * @param {import('node:http').Server} server
 */
export function attachDevSocket(server) {
  const endpoint = `${getConfig().brand.devBasePath}/ws`;

  server.on("upgrade", (req, socket, head) => {
    // Uygulamanın kendi WebSocket uçları olabilir; yalnızca bizimkini alırız.
    if ((req.url ?? "").split("?")[0] !== endpoint) return;

    upgradeToSocket(req, socket, head, (send) => {
      send({ type: "hello", boot: BOOT_ID });
      send(statsPayload());
    });
  });
}
