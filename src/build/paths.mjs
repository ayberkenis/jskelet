/**
 * Build çıktısı yolları ve hash'li varlık yazımı.
 *
 * Yollar `jskelet.config.mjs`'den gelir; `initBuildPaths()` çağrılmadan
 * kullanılamazlar. Tek bir mutasyon noktası olması bilinçli: framework
 * `node_modules/` içine girdiğinde `../..` sayarak kök bulmaya çalışan her
 * dosya bozulur.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * @type {{ root: string, generated: string, public: string, assets: string,
 *   fonts: string, client: string, views: string, routes: string, styles: string }}
 */
export const paths = {
  root: "",
  generated: "",
  public: "",
  assets: "",
  fonts: "",
  client: "",
  views: "",
  routes: "",
  styles: "",
};

/**
 * @param {import('../config/index.js').ResolvedConfig} config
 * @returns {void}
 */
export function initBuildPaths(config) {
  Object.assign(paths, config.dirs, { root: config.root });

  fs.mkdirSync(paths.generated, { recursive: true });
  fs.mkdirSync(paths.assets, { recursive: true });
}

/**
 * İçeriğe göre kısa hash. 10 hex karakter çakışma için fazlasıyla yeterli ve
 * dosya adlarını okunur tutuyor.
 *
 * @param {string | Buffer} content
 * @returns {string}
 */
export function hash(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 10);
}

/**
 * Hash'li dosyayı `public/assets` altına yazar ve public yolunu döner.
 *
 * @param {string} name Örn. "app.css"
 * @param {string | Buffer} content
 * @returns {string}
 */
export function writeAsset(name, content) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  const fileName = `${base}.${hash(content)}${ext}`;

  fs.mkdirSync(paths.assets, { recursive: true });
  fs.writeFileSync(path.join(paths.assets, fileName), content);

  return `/assets/${fileName}`;
}

/** @returns {string} */
function manifestFile() {
  return path.join(paths.generated, "manifest.json");
}

/** @param {Record<string, string>} manifest */
export function writeManifest(manifest) {
  fs.mkdirSync(paths.generated, { recursive: true });
  fs.writeFileSync(manifestFile(), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Tek bir girdiyi günceller, diğerlerini korur.
 *
 * Watch modunda yeniden derlenen varlık yeni bir hash'e yazılıp eskisi
 * silindiği için manifest de güncellenmek zorunda: aksi hâlde HTML silinmiş
 * dosyayı isteyip 404 alır ve sayfa dev oturumunun kalanında stilsiz/JS'siz
 * kalır.
 *
 * @param {string} key
 * @param {string} url
 */
export function patchManifest(key, url) {
  /** @type {Record<string, string>} */
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(manifestFile(), "utf8"));
  } catch {
    // Manifest henüz yoksa ilk yazımda oluşur.
  }

  if (current[key] === url) return;

  current[key] = url;
  writeManifest(current);
}

/**
 * Eski hash'li çıktıları temizler.
 *
 * @param {string[]} prefixes
 */
export function pruneAssets(prefixes) {
  if (!fs.existsSync(paths.assets)) return;
  for (const file of fs.readdirSync(paths.assets)) {
    if (prefixes.some((prefix) => file.startsWith(prefix))) {
      fs.rmSync(path.join(paths.assets, file), { force: true });
    }
  }
}
