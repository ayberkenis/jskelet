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
 * Site içi gezinme ipuçları (Speculation Rules + view transition).
 *
 * Varsayılan bilinçli olarak ölçülü: `prefetch` açık, çünkü yalnızca belgeyi
 * indirir ve sayfanın JS'ini çalıştırmaz — yanlış tahmin edilse bile tek
 * maliyeti bir istektir. `prerender` kapalı, çünkü hedef sayfanın script'leri
 * gerçekten çalışır; ölçüm kodunu `prerenderingchange` olayına bağlamayan bir
 * uygulamada ziyaret sayıları şişer. `viewTransition` kapalı, çünkü uygulamanın
 * kendi geçiş animasyonlarıyla çakışabilir.
 */
export const DEFAULT_NAVIGATION = {
  /** `false` ya da eagerness: "conservative" | "moderate" | "eager". */
  prefetch: /** @type {false | "conservative" | "moderate" | "eager"} */ ("moderate"),
  /** @type {false | "conservative" | "moderate" | "eager"} */
  prerender: false,
  /** `@view-transition { navigation: auto }` basılsın mı. */
  viewTransition: false,
};

/**
 * Hiçbir koşulda önden getirilmeyecek yollar. Yan etkisi olan ya da gezinme
 * hedefi olmayan uçların spekülatif istekle tetiklenmesi gerçek bir hata
 * kaynağı; uygulama kendi listesini `navigation.exclude` ile ekler.
 */
export const DEFAULT_NAVIGATION_EXCLUDE = ["/api/*", "/_fragment/*"];

/**
 * Güvenlik ayarları.
 *
 * `trustProxy` varsayılan olarak açık, çünkü JSkelet uygulamaları neredeyse
 * her zaman bir ters proxy arkasında koşuyor ve doğru protokol/IP buna bağlı.
 * Ama doğrudan internete açık bir sunucuda bu, istemcinin `X-Forwarded-For`
 * uydurabilmesi demek — rate limit ve audit log girdiğinde kapatılmalı.
 *
 * `csrf.enabled` açık: framework gövdeyi kendisi ayrıştırdığı için bu yüzey
 * onun sorumluluğu. Kontrol yalnızca **çapraz site olduğu belli** istekleri
 * reddeder (`Origin` uyuşmuyor ya da `Sec-Fetch-Site: cross-site`); başlık
 * hiç yoksa geçer, böylece webhook ve sunucudan sunucuya çağrılar bozulmaz.
 *
 * `csrf.token` kapalı: çift gönderim token'ı `Origin` göndermeyen eski
 * tarayıcılar için ikinci katman ve formlara `csrfField()` eklenmesini
 * gerektiriyor, yani açılması bilinçli bir karar olmalı.
 */
export const DEFAULT_SECURITY = {
  trustProxy: true,
  /** @type {string | null} */
  cookieSecret: null,
  csrf: {
    enabled: true,
    token: false,
    /** Ek olarak kabul edilen origin'ler (ör. ayrı bir admin alan adı). */
    allowedOrigins: /** @type {string[]} */ ([]),
    /** Kontrolden muaf yollar — webhook uçları buraya yazılır. */
    exclude: /** @type {string[]} */ ([]),
    cookieName: "csrf_token",
    fieldName: "_csrf",
    headerName: "x-csrf-token",
  },
};

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
