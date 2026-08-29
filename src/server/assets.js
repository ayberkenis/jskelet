/**
 * Build çıktısı manifest'ine erişim: mantıksal isim → hash'li public URL.
 *
 * Build çalışmadıysa uygulama yine ayağa kalkar. `asset()` `/assets/<isim>`
 * döner ve `hasAsset()` false olur; layout stylesheet/script etiketlerini hiç
 * basmaz. Böylece `jskelet build` unutulduğunda hata yerine stilsiz ama
 * çalışan bir sayfa görürsünüz.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { getConfig } from "../config/index.js";

const isDev = process.env.NODE_ENV === "development";

/** @type {{ manifest: Record<string, string> } | null} */
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
      console.warn("[assets] manifest yok — `jskelet build` çalıştırın.");
    }
  }

  return { manifest };
}

function state() {
  // Dev'de her istekte yeniden okunur (watch build hash'leri değiştirir);
  // prod'da bir kez.
  if (isDev || !cached) cached = load();
  return cached;
}

/**
 * @param {string} name Örn. "app.css", "main.js", "sprite.svg"
 * @returns {string}
 */
export function asset(name) {
  return state().manifest[name] ?? `/assets/${name}`;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function hasAsset(name) {
  return Boolean(state().manifest[name]);
}

/**
 * @typedef {{ width: number, height: number,
 *   variants: { width: number, url: string }[] }} OptimizedImage
 */

/** @type {Record<string, OptimizedImage> | null} */
let images = null;

/**
 * `build/tasks/images.mjs` çıktısı: kaynak yolundan webp varyantlarına.
 * Build çalışmadıysa boş kalır ve görseller orijinalleriyle servis edilir.
 *
 * @param {string} [src] Örn. "/hero.png"
 * @returns {OptimizedImage | undefined}
 */
export function optimizedImage(src) {
  if (isDev || !images) {
    try {
      const file = path.join(getConfig().dirs.generated, "images.json");
      images = JSON.parse(fs.readFileSync(file, "utf8")).images ?? {};
    } catch {
      images = {};
    }
  }

  return src ? images[src] : undefined;
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
  const url = asset("sprite.svg");
  if (spriteIds?.url === url) return spriteIds.ids;

  /** @type {Set<string>} */
  const ids = new Set();

  try {
    const file = path.join(getConfig().dirs.public, url.replace(/^\//, ""));
    const svg = fs.readFileSync(file, "utf8");
    for (const match of svg.matchAll(/<symbol id="([^"]+)"/g)) ids.add(match[1]);
  } catch {
    // Sprite okunamazsa uyarı üretilmez; asıl akış etkilenmez.
  }

  spriteIds = { url, ids };
  return ids;
}
