/**
 * Framework varsayılanları.
 *
 * Buradaki hiçbir değer domain bilgisi taşımaz: uygulamaya özel her şey
 * `jskelet.config.mjs` üzerinden gelir. Varsayılanların ayrı dosyada olması,
 * "framework ne yapıyor, uygulama ne ekliyor" ayrımını okunur tutar.
 */

/** Uzun süre cache'lenecek hash'li çıktı dizini. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/**
 * Proje kökündeki dizin adları. `jskelet.config.mjs` içinde `paths` ile
 * tek tek ezilebilir.
 */
export const DEFAULT_DIRS = {
  /** EJS layout + sayfalar + bileşenler. */
  views: "views",
  /** Statik dosyalar; build çıktısı da buraya yazılır. */
  public: "public",
  /** Island runtime ve entry'ler. */
  client: "client",
  /** Route modülleri. */
  routes: "routes",
  /** Tailwind/PostCSS giriş dosyası. */
  styles: "styles/globals.css",
  /** Build ara çıktıları (manifest, metafile, images). */
  generated: ".jskelet",
};

/**
 * Uzantı ve önek bazlı statik dosya tespiti. Bu listeye uyan yollara
 * `IMMUTABLE_CACHE` yazılır.
 */
export const DEFAULT_STATIC = {
  extensions: [".svg", ".png", ".webp", ".avif", ".ico", ".woff2"],
  prefixes: ["/assets/", "/fonts/"],
};

/** Dev gate'in hiçbir koşulda kapatmadığı yollar. */
export const DEFAULT_DEV_GATE_BYPASS = [
  "/api/healthcheck",
  "/robots.txt",
  "/sitemap.xml",
  "/site.webmanifest",
  "/favicon.ico",
];

/** Prewarm ayarlarının kod içi varsayılanları. */
export const DEFAULT_PREWARM = {
  enabled: true,
  max: 400,
  intervalSeconds: 0,
  /** Paralel ısıtma isteği; dev'de sunucu tek süreç olduğu için düşürülür. */
  concurrency: 4,
  /** İki tur arasında beklenen süre: upstream'e ani yük binmesin. */
  delayMs: 0,
};

/** Oturuma bağlı sayfalar ısıtılmaz; uygulama kendi listesini verebilir. */
export const DEFAULT_PREWARM_SKIP = ["/api/", "/_fragment/", "/__jskelet/"];

/**
 * Markalama. Header adı ve dev overlay yolu tek yerden değişsin diye
 * config'ten okunur — fork eden proje kendi adını verebilir.
 */
export const DEFAULT_BRAND = {
  name: "JSkelet",
  /** `<html lang>`; uygulama kendi dilini config'te bildirir. */
  lang: "en",
  poweredBy: "JSkelet",
  cacheHeader: "X-JSkelet-Cache",
  devBasePath: "/__jskelet/dev",
  prewarmUserAgent: "jskelet-prewarm",
  devTokenCookie: "dev_token",
};
