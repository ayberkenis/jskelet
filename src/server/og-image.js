/**
 * Dinamik Open Graph görselleri — Next.js `ImageResponse` /
 * `opengraph-image.tsx` karşılığı.
 *
 * JSX yok: ya hazır kart alanları (`title`, `description`, `siteName`) ya da
 * ham `svg` verilir. sharp (opsiyonel peer) varsa PNG üretilir; yoksa SVG
 * döner. Sosyal kazıyıcıların çoğu PNG beklediği için prod'da sharp önerilir.
 *
 * Domain bilgisi taşınmaz — metin, renk ve SVG uygulama tarafındandır.
 */
import { tryImportFromApp } from "../build/resolve-peer.mjs";
import { getConfig } from "../config/index.js";
import { isNotFoundError } from "../http/control-flow.js";

/** @type {((input: Buffer, opts?: object) => import('sharp').Sharp) | null | undefined} */
let sharpModule;

/** Sosyal kartlar için yaygın boyut (Facebook / X / LinkedIn). */
export const OG_SIZE = Object.freeze({ width: 1200, height: 630 });

const DEFAULT_CACHE =
  "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";

/**
 * @typedef {object} OgCardOptions
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [siteName]
 * @property {string} [background] Düz SVG rengi (`#0f172a`)
 * @property {string} [color] Ana metin rengi
 * @property {string} [mutedColor] Açıklama / site adı
 * @property {string} [accent] Sol şerit rengi
 */

/**
 * @typedef {OgCardOptions & {
 *   svg?: string,
 *   width?: number,
 *   height?: number,
 *   format?: 'png' | 'svg',
 *   cacheControl?: string,
 * }} OgImageOptions
 */

/**
 * @typedef {object} OgImageResult
 * @property {Buffer} body
 * @property {string} contentType
 * @property {number} width
 * @property {number} height
 */

/**
 * XML metin kaçışı — kullanıcı başlığı SVG'ye gömülür.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Kelime sınırında satır kır. Uzun kelime kesilir; taşan içerik son satırda `…`.
 * @param {string} text
 * @param {number} maxChars
 * @param {number} maxLines
 * @returns {string[]}
 */
export function wrapText(text, maxChars, maxLines) {
  const words = String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || maxLines < 1 || maxChars < 1) return [];

  /** @type {string[]} */
  const lines = [];
  let current = "";
  let overflow = false;

  const pushCurrent = () => {
    if (!current) return;
    lines.push(current);
    current = "";
  };

  for (const word of words) {
    if (lines.length >= maxLines) {
      overflow = true;
      break;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    pushCurrent();
    if (lines.length >= maxLines) {
      overflow = true;
      break;
    }

    if (word.length <= maxChars) {
      current = word;
      continue;
    }

    let rest = word;
    while (rest.length > maxChars) {
      if (lines.length >= maxLines) {
        overflow = true;
        rest = "";
        break;
      }
      lines.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    current = rest;
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  } else if (current) {
    overflow = true;
  }

  if (overflow && lines.length) {
    const last = lines[lines.length - 1];
    const base = last.endsWith("…") ? last.slice(0, -1) : last;
    const trimmed = base.slice(0, Math.max(1, maxChars - 1));
    lines[lines.length - 1] = `${trimmed}…`;
  }

  return lines;
}

/**
 * Hazır kart SVG'si. Uygulama kendi SVG'sini vermek isterse `svg` kullanır.
 * @param {OgCardOptions & { width?: number, height?: number }} options
 * @returns {string}
 */
export function buildOgSvg(options = {}) {
  const width = options.width ?? OG_SIZE.width;
  const height = options.height ?? OG_SIZE.height;
  const background = options.background ?? "#0f172a";
  const color = options.color ?? "#f8fafc";
  const muted = options.mutedColor ?? "#94a3b8";
  const accent = options.accent ?? "#38bdf8";

  const titleLines = wrapText(options.title ?? "", 28, 3);
  const descLines = wrapText(options.description ?? "", 52, 2);
  const siteName = options.siteName ? escapeXml(options.siteName) : "";

  const titleTs = titleLines
    .map((line, i) => {
      const dy = i === 0 ? 0 : 72;
      return `<tspan x="80" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  const descTs = descLines
    .map((line, i) => {
      const dy = i === 0 ? 0 : 40;
      return `<tspan x="80" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  const titleY = 200;
  const descY = titleY + Math.max(titleLines.length, 1) * 72 + 36;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="${escapeXml(background)}"/>` +
    `<rect x="0" y="0" width="14" height="${height}" fill="${escapeXml(accent)}"/>` +
    (titleTs
      ? `<text x="80" y="${titleY}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="64" font-weight="700" fill="${escapeXml(color)}">${titleTs}</text>`
      : "") +
    (descTs
      ? `<text x="80" y="${descY}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="30" font-weight="400" fill="${escapeXml(muted)}">${descTs}</text>`
      : "") +
    (siteName
      ? `<text x="80" y="${height - 64}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="24" font-weight="600" fill="${escapeXml(muted)}">${siteName}</text>`
      : "") +
    `</svg>`
  );
}

/**
 * @returns {Promise<((input: Buffer, opts?: object) => import('sharp').Sharp) | null>}
 */
async function loadSharp() {
  if (sharpModule !== undefined) return sharpModule;

  /** @type {any} */
  let mod = null;
  try {
    mod = await tryImportFromApp(getConfig().root, "sharp");
  } catch {
    // Config yoksa (birim test) doğrudan çözümle.
    try {
      mod = await import("sharp");
    } catch {
      mod = null;
    }
  }

  sharpModule = mod?.default ?? mod ?? null;
  return sharpModule;
}

/**
 * SVG veya kart alanlarından PNG/SVG gövde üretir.
 * @param {OgImageOptions} [options]
 * @returns {Promise<OgImageResult>}
 */
export async function ogImage(options = {}) {
  const width = options.width ?? OG_SIZE.width;
  const height = options.height ?? OG_SIZE.height;
  const svg =
    typeof options.svg === "string" && options.svg.trim()
      ? options.svg
      : buildOgSvg({ ...options, width, height });

  const preferSvg = options.format === "svg";
  const sharp = preferSvg ? null : await loadSharp();

  if (!sharp) {
    return {
      body: Buffer.from(svg, "utf8"),
      contentType: "image/svg+xml; charset=utf-8",
      width,
      height,
    };
  }

  const body = await sharp(Buffer.from(svg, "utf8"))
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();

  return {
    body,
    contentType: "image/png",
    width,
    height,
  };
}

/**
 * Express yanıtına OG görseli basar.
 * @param {import('express').Response} res
 * @param {OgImageOptions} [options]
 * @returns {Promise<OgImageResult>}
 */
export async function sendOgImage(res, options = {}) {
  const result = await ogImage(options);
  const cacheControl = options.cacheControl ?? DEFAULT_CACHE;

  res.status(200);
  res.setHeader("Content-Type", result.contentType);
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Content-Length", String(result.body.length));
  // Kazıyıcılar ve CDN'ler için boyut ipucu (meta ile de verilir).
  res.setHeader("X-Og-Width", String(result.width));
  res.setHeader("X-Og-Height", String(result.height));
  res.end(result.body);
  return result;
}

/**
 * Next `opengraph-image` route handler'ına yakın Express sarmalayıcı.
 *
 * Factory `null` dönerse veya `notFound()` fırlatırsa 404.
 *
 * @param {(ctx: { params: Record<string, string>, query: import('express').Request['query'], req: import('express').Request }) =>
 *   OgImageOptions | null | Promise<OgImageOptions | null>} factory
 * @param {OgImageOptions} [defaults] Her istekte birleşen varsayılanlar
 * @returns {import('express').RequestHandler}
 */
export function ogHandler(factory, defaults = {}) {
  return async (req, res, next) => {
    try {
      const result = await factory({
        params: req.params ?? {},
        query: req.query,
        req,
      });
      if (result == null) {
        res.status(404).end();
        return;
      }
      await sendOgImage(res, { ...defaults, ...result });
    } catch (error) {
      if (isNotFoundError(error)) {
        res.status(404).end();
        return;
      }
      next(error);
    }
  };
}

/**
 * Next.js `new ImageResponse(...)` DX'si. JSX yok — ilk argüman SVG string
 * veya kart alanları nesnesi.
 *
 * @example
 * ```js
 * return new ImageResponse(
 *   { title: post.title, description: post.excerpt, siteName: "Blog" },
 *   { width: 1200, height: 630 },
 * );
 * // handler içinde: await image.send(res)
 * ```
 */
export class ImageResponse {
  /** @type {OgImageOptions} */
  #options;

  /**
   * @param {string | OgCardOptions} element
   * @param {Omit<OgImageOptions, keyof OgCardOptions | 'svg'> & { width?: number, height?: number }} [init]
   */
  constructor(element, init = {}) {
    if (typeof element === "string") {
      this.#options = { ...init, svg: element };
    } else {
      this.#options = { ...element, ...init };
    }
  }

  /** @returns {OgImageOptions} */
  get options() {
    return this.#options;
  }

  /** @returns {Promise<OgImageResult>} */
  async buffer() {
    return ogImage(this.#options);
  }

  /**
   * @param {import('express').Response} res
   * @returns {Promise<OgImageResult>}
   */
  async send(res) {
    return sendOgImage(res, this.#options);
  }
}
