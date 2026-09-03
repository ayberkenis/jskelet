/**
 * Runtime uzak görsel proxy: allowlist'teki host'lardan çeker, sharp ile
 * webp'ye çevirir, diske yazar ve uzun Cache-Control ile servis eder.
 *
 * Next.js `/_next/image` karşılığı. Build zamanı `images.mjs` yalnızca
 * `public/` altındaki yerel dosyaları kapsar; CMS / CDN kapakları için bu uç
 * gerekir. Kapalıyken (allowHosts yok) router hiç mount edilmez.
 *
 * sharp yoksa 302 ile orijinale yönlendirilir — sayfa bozulmaz, tasarruf
 * olmaz. Deployment notu: remote açıksa sharp runtime bağımlılığıdır.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { tryImportFromApp } from "../build/resolve-peer.mjs";
import { getConfig } from "../config/index.js";

/** @type {typeof import('sharp') | null | undefined} */
let sharpModule;

/** @type {string | null} */
let cacheDir = null;

/**
 * @returns {import('../config/index.js').ImagesRemoteConfig | null}
 */
export function getRemoteImages() {
  const images = getConfig().images;
  if (!images || images === false || !images.remote || !images.remote.enabled) {
    return null;
  }
  return images.remote;
}

/**
 * Mutlak http(s) URL mi ve allowHosts'ta mı.
 * @param {string} src
 * @returns {URL | null}
 */
export function parseAllowedRemoteUrl(src) {
  const remote = getRemoteImages();
  if (!remote || typeof src !== "string") return null;

  let url;
  try {
    url = new URL(src);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!isHostAllowed(url.hostname, remote.allowHosts)) return null;
  if (isBlockedAddress(url.hostname)) return null;

  return url;
}

/**
 * @param {string} hostname
 * @param {string[]} allowHosts
 * @returns {boolean}
 */
export function isHostAllowed(hostname, allowHosts) {
  const host = hostname.toLowerCase();
  return allowHosts.some((entry) => {
    const pattern = entry.toLowerCase();
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // ".example.com"
      return host.endsWith(suffix) || host === pattern.slice(2);
    }
    return host === pattern;
  });
}

/**
 * Literal private / link-local / loopback host'ları reddet (SSRF).
 * Allowlist asıl koruma; bu ek bir savunma katmanı.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isBlockedAddress(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "0.0.0.0" || host.endsWith(".localhost")) {
    return true;
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;

  // IPv4
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return true;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // Ham IPv6 private / ULA — basit önek kontrolü
  if (host.includes(":")) {
    if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
      return true;
    }
  }

  return false;
}

/**
 * Optimizer URL'si üret. `image()` ve elle URL kuran uygulamalar için.
 * @param {string} src Uzak görsel URL'si
 * @param {{ width: number, quality?: number }} options
 * @returns {string | null} Allowlist dışıysa null
 */
export function remoteImageUrl(src, options) {
  const remote = getRemoteImages();
  const allowed = parseAllowedRemoteUrl(src);
  if (!remote || !allowed) return null;

  const images = getConfig().images;
  const quality =
    options.quality ??
    (images && images !== false ? images.quality : 78) ??
    78;
  const width = clampWidth(options.width, remote.maxWidth);

  const params = new URLSearchParams({
    url: allowed.href,
    w: String(width),
    q: String(quality),
  });
  return `${remote.path}?${params}`;
}

/**
 * @param {number} width
 * @param {number} maxWidth
 * @returns {number}
 */
export function clampWidth(width, maxWidth) {
  const n = Math.round(Number(width));
  if (!Number.isFinite(n) || n < 1) return Math.min(640, maxWidth);
  return Math.min(n, maxWidth);
}

/**
 * Görüntülenen genişliğe göre srcset adayları (1x + 2x + config widths).
 * @param {number} displayWidth
 * @param {number[]} widths
 * @param {number} maxWidth
 * @returns {number[]}
 */
export function srcsetWidths(displayWidth, widths, maxWidth) {
  const base = Math.max(1, Math.round(displayWidth));
  const candidates = new Set([
    base,
    Math.min(base * 2, maxWidth),
    ...widths.filter((w) => w >= base && w <= maxWidth),
  ]);
  return [...candidates].sort((a, b) => a - b);
}

/**
 * @param {import('express').Express} app
 * @returns {Promise<void>}
 */
export async function mountImageOptimizer(app) {
  const remote = getRemoteImages();
  if (!remote) return;

  const config = getConfig();
  cacheDir = path.join(config.dirs.generated, "image-cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  sharpModule = await tryImportFromApp(config.root, "sharp");
  if (!sharpModule) {
    console.warn(
      "[images.remote] sharp not installed; optimizer will redirect to the source URL",
    );
  }

  app.get(remote.path, (req, res) => {
    void handleOptimize(req, res, remote);
  });
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('../config/index.js').ImagesRemoteConfig} remote
 */
async function handleOptimize(req, res, remote) {
  const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
  const allowed = parseAllowedRemoteUrl(rawUrl);
  if (!allowed) {
    res.status(400).type("text").send("Invalid or disallowed image url");
    return;
  }

  const images = getConfig().images;
  const defaultQ = images && images !== false ? images.quality : 78;
  const quality = clampQuality(
    typeof req.query.q === "string" ? req.query.q : defaultQ,
    defaultQ,
  );
  const width = clampWidth(
    typeof req.query.w === "string" ? req.query.w : 640,
    remote.maxWidth,
  );

  if (!sharpModule) {
    res.redirect(302, allowed.href);
    return;
  }

  const key = cacheKey(allowed.href, width, quality);
  const filePath = path.join(/** @type {string} */ (cacheDir), `${key}.webp`);

  try {
    if (fs.existsSync(filePath)) {
      sendCached(res, filePath, remote.cacheMaxAge);
      return;
    }

    const upstream = await fetchUpstream(allowed.href, remote);
    if (!upstream.ok) {
      res.status(502).type("text").send("Upstream image fetch failed");
      return;
    }

    const sharp = sharpModule.default;
    const buffer = await sharp(upstream.buffer, { failOn: "none" })
      .rotate()
      .resize({
        width,
        withoutEnlargement: true,
        fit: "inside",
      })
      .webp({ quality, effort: 4 })
      .toBuffer();

    // Atomik yaz: yarım dosya immutable cache'e düşmesin.
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, buffer);
    await fs.promises.rename(tmp, filePath);

    sendCached(res, filePath, remote.cacheMaxAge);
  } catch (error) {
    console.warn("[images.remote] optimize failed:", error);
    // Bozuk kaynakta sayfa boş kalmasın: orijinale düş.
    if (!res.headersSent) res.redirect(302, allowed.href);
  }
}

/**
 * @param {string} href
 * @param {import('../config/index.js').ImagesRemoteConfig} remote
 * @returns {Promise<{ ok: true, buffer: Buffer } | { ok: false }>}
 */
async function fetchUpstream(href, remote) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remote.fetchTimeoutMs);

  try {
    const response = await fetch(href, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Bazı CDN'ler bot UA reddeder; tarayıcıya yakın tut.
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        "User-Agent": "jskelet-image-optimizer/1",
      },
    });

    if (!response.ok) return { ok: false };

    const type = response.headers.get("content-type") ?? "";
    if (type && !type.startsWith("image/") && !type.includes("octet-stream")) {
      return { ok: false };
    }

    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > remote.maxBytes) return { ok: false };

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > remote.maxBytes) return { ok: false };

    return { ok: true, buffer };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {import('express').Response} res
 * @param {string} filePath
 * @param {number} maxAge
 */
function sendCached(res, filePath, maxAge) {
  res.setHeader("Content-Type", "image/webp");
  res.setHeader(
    "Cache-Control",
    `public, max-age=${maxAge}, stale-while-revalidate=${Math.min(maxAge, 86400)}`,
  );
  res.setHeader("Vary", "Accept");
  // Cache dir is under .jskelet/; Express send ignores dotfiles by default.
  res.sendFile(path.resolve(filePath), { dotfiles: "allow" });
}

/**
 * @param {string} href
 * @param {number} width
 * @param {number} quality
 * @returns {string}
 */
function cacheKey(href, width, quality) {
  return crypto
    .createHash("sha256")
    .update(`webp-q${quality}-e4:${width}:${href}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function clampQuality(value, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, n));
}
