/**
 * Build çıktısı manifest'ine erişim: mantıksal isim → hash'li public URL.
 *
 * Build çalışmadıysa uygulama yine ayağa kalkar. `asset()` `/assets/<isim>`
 * döner ve `hasAsset()` false olur; layout stylesheet/script etiketlerini hiç
 * basmaz. Böylece `jskelet build` unutulduğunda hata yerine stilsiz ama
 * çalışan bir sayfa görürsünüz.
 *
 * `build.assets.prefix` doluysa HTML'e basılan URL'lere CDN origin eklenir;
 * manifest diskte göreli kalır. Dosya sistemi okumaları (`getSpriteIds`)
 * göreli yolu kullanır.
 *
 * Bazı varlıklar bilinçli olarak site origin'inde kalır: SVG `<use href>`
 * çapraz origin sprite yüklemez. `asset(name, { origin: "document" })`
 * prefix'i atlar; `icon()` sprite için bunu kullanır. Origin hâlâ
 * `public/assets/` servis eder.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { getConfig } from "../config/index.js";

const isDev = process.env.NODE_ENV === "development";

/** @type {{ manifest: Record<string, string>, generated: string } | null} */
let cached = null;
let warned = false;

function load() {
  const { generated } = getConfig().dirs;

  /** @type {Record<string, string>} */
  let manifest = {};

  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(generated, "manifest.json"), "utf8"),
    );
  } catch {
    if (!warned) {
      warned = true;
      console.warn("[assets] no manifest — run `jskelet build`.");
    }
  }

  return { manifest, generated };
}

function state() {
  // Dev'de her istekte yeniden okunur (watch build hash'leri değiştirir);
  // prod'da bir kez. `generated` yolu değiştiyse (test / başka kök) de
  // yenilenir — aksi hâlde eski manifest takılı kalır.
  const generated = getConfig().dirs.generated;
  if (isDev || !cached || cached.generated !== generated) cached = load();
  return cached;
}

/**
 * CDN prefix + göreli asset yolu. Zaten mutlak (`https:…`) URL'lere dokunmaz.
 *
 * @param {string} prefix Sonunda `/` olmadan (normalize edilmiş).
 * @param {string} url
 * @returns {string}
 */
export function applyAssetPrefix(prefix, url) {
  if (!prefix || !url) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const pathPart = url.startsWith("/") ? url : `/${url}`;
  return `${prefix.replace(/\/+$/, "")}${pathPart}`;
}

/** @returns {string} */
function assetPrefix() {
  try {
    return getConfig().build?.assets?.prefix ?? "";
  } catch {
    return "";
  }
}

/**
 * Manifest'teki göreli yol (prefix yok) — disk okuma için.
 *
 * @param {string} name
 * @returns {string}
 */
function assetPath(name) {
  return state().manifest[name] ?? `/assets/${name}`;
}

/**
 * @typedef {{ origin?: "cdn" | "document" }} AssetOptions
 */

/**
 * Manifest'teki hash'li (veya yedek) URL.
 *
 * @param {string} name Örn. "app.css", "main.js", "sprite.svg"
 * @param {AssetOptions} [options]
 *   `origin: "document"` → `build.assets.prefix` uygulanmaz; site
 *   origin'indeki `/assets/…` yolu döner (varsayılan `"cdn"`).
 * @returns {string}
 */
export function asset(name, options = {}) {
  const relative = assetPath(name);
  if (options.origin === "document") return relative;
  return applyAssetPrefix(assetPrefix(), relative);
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function hasAsset(name) {
  return Boolean(state().manifest[name]);
}

/** @type {string | null} */
let buildId = null;

/**
 * Bu build'i tanımlayan kısa kimlik (`build.json` → `id`).
 *
 * Paylaşımlı önbellek anahtarlarının isim alanı bu: saklanan HTML hash'li
 * varlık yollarını gömdüğü için bir deploy'dan sonra eski HTML **geçersizdir**.
 *
 * Build çalışmadıysa `"dev"` döner — build çıktısı olmadan da ayağa kalkma
 * kuralı burada da geçerli.
 *
 * @returns {string}
 */
export function getBuildId() {
  if (!isDev && buildId) return buildId;

  try {
    const file = path.join(getConfig().dirs.generated, "build.json");
    const id = JSON.parse(fs.readFileSync(file, "utf8")).id;
    buildId = typeof id === "string" && id ? id : "dev";
  } catch {
    buildId = "dev";
  }

  return buildId;
}

/**
 * @typedef {{ width: number, height: number,
 *   variants: { width: number, url: string }[] }} OptimizedImage
 */

/** @type {Record<string, OptimizedImage> | null} */
let images = null;

/** Prefix uygulanmış kopya — her `optimizedImage` çağrısında map/spread yok. */
/** @type {Record<string, OptimizedImage> | null} */
let imagesPrefixed = null;

/** @type {string | null} */
let imagesPrefix = null;

/**
 * `images.json` yükler; CDN prefix varsa varyant URL'lerini bir kez materialize eder.
 * @returns {Record<string, OptimizedImage>}
 */
function loadImages() {
  const prefix = assetPrefix();
  if (!isDev && images && imagesPrefix === prefix) {
    return imagesPrefixed ?? images;
  }

  /** @type {Record<string, OptimizedImage>} */
  let raw = {};
  try {
    const file = path.join(getConfig().dirs.generated, "images.json");
    raw = JSON.parse(fs.readFileSync(file, "utf8")).images ?? {};
  } catch {
    raw = {};
  }

  images = raw;
  imagesPrefix = prefix;

  if (!prefix) {
    imagesPrefixed = raw;
    return raw;
  }

  /** @type {Record<string, OptimizedImage>} */
  const prefixed = {};
  for (const [key, entry] of Object.entries(raw)) {
    prefixed[key] = {
      ...entry,
      variants: entry.variants.map((variant) => ({
        ...variant,
        url: applyAssetPrefix(prefix, variant.url),
      })),
    };
  }
  imagesPrefixed = prefixed;
  return prefixed;
}

/**
 * `build/tasks/images.mjs` çıktısı: kaynak yolundan webp varyantlarına.
 * Build çalışmadıysa boş kalır ve görseller orijinalleriyle servis edilir.
 *
 * @param {string} [src] Örn. "/hero.png"
 * @returns {OptimizedImage | undefined}
 */
export function optimizedImage(src) {
  const table = loadImages();
  if (!src) return undefined;
  return table[src];
}

/** @type {{ url: string, ids: Set<string> } | null} */
let spriteIds = null;

/**
 * Sprite'taki sembol kimlikleri. Sprite yalnızca kaynakta **statik olarak**
 * görülen ikon adlarını içerir; adı çalışma anında hesaplanan bir `icon()`
 * çağrısı eksik sembole işaret ederse ekranda sessizce boşluk kalır. Dev'de
 * `icon()` bu kümeye bakıp uyarır.
 *
 * @returns {Set<string>}
 */
export function getSpriteIds() {
  // Disk yolu göreli olmalı; CDN prefix dosya sisteminde yok.
  const relative = assetPath("sprite.svg");
  if (spriteIds?.url === relative) return spriteIds.ids;

  /** @type {Set<string>} */
  const ids = new Set();

  try {
    const file = path.join(getConfig().dirs.public, relative.replace(/^\//, ""));
    const svg = fs.readFileSync(file, "utf8");
    for (const match of svg.matchAll(/<symbol id="([^"]+)"/g)) ids.add(match[1]);
  } catch {
    // Sprite okunamazsa uyarı üretilmez; asıl akış etkilenmez.
  }

  spriteIds = { url: relative, ids };
  return ids;
}
