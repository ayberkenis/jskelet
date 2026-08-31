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
  /**
   * Saniyedeki en fazla ısıtma isteği. 0 → sınırsız (yalnızca `concurrency`
   * frenler). Upstream'i kota sınırının altında tutmanın en doğrudan yolu bu:
   * paralellik ne kadar yükselse de tur bu hızın üstüne çıkmaz.
   */
  rps: 0,
  /**
   * Tekrar turundan önce beklenen süre. Rate limit pencereleri saniye
   * mertebesinde; hemen tekrar denemek aynı 429'u almak demek.
   */
  retryDelayMs: 2000,
  /**
   * Liste `max`'tan uzunsa periyodik turlar kaldığı yerden devam eder.
   * Böylece 10.000 yolluk bir site tek turda değil, turlar boyunca ısınır.
   * `priority` eşleşen yollar her turda ısıtıldığı için rotasyon yalnızca
   * kuyruğu dolaşır.
   */
  rotate: true,
  /**
   * Isıtma sırasını belirleyen desenler. String (`/haber/:slug`) ya da
   * `RegExp` kabul eder; önce yazılan önce ısınır.
   * @type {(string | RegExp)[]}
   */
  priority: [],
};

/**
 * HTML önbelleğinin girdi sınırı. 500 girdi ortalama bir sayfa boyutunda
 * yaklaşık 100-200 MB tutar; uzun kuyruklu siteler bunu yükseltmek yerine
 * veri önbelleğine yaslanmalı (bkz. `DEFAULT_DATA_CACHE`).
 */
export const DEFAULT_HTML_CACHE_MAX_ENTRIES = 500;

/**
 * `notFound()` geçici bir upstream hatasına denk geldiğinde sayfanın kaç kez
 * daha denenmesi gerektiği.
 *
 * Varsayılan tek deneme: maliyeti upstream'e binen ikinci bir istek turu, ama
 * alternatifi var olan bir sayfayı 404 olarak servis etmek — arama motoru için
 * geçici bir rate limit'in kalıcı kayba dönüşmesi. `attempts: 0` tekrarı
 * kapatır ve doğrudan önbelleğe girmeyen 503'e düşer.
 */
export const DEFAULT_TRANSIENT_RETRY = {
  attempts: 1,
  delayMs: 300,
};

/**
 * Upstream veri önbelleği.
 *
 * HTML önbelleğinden bilinçli olarak çok daha büyük: JSON, aynı sayfanın
 * HTML'ine göre onlarca kat küçük. Uzun kuyruğu (on binlerce haber/etiket)
 * HTML olarak tutmak imkânsız, verisini tutmak ise ucuz — ve API kotasını
 * koruyan katman burası.
 */
export const DEFAULT_DATA_CACHE = {
  maxEntries: 10000,
  /**
   * TTL dolduktan sonra girdinin kaç TTL boyunca daha kullanılabileceği.
   * HTML'deki 1 katsayısından yüksek: bayat veri, eksik sayfadan iyidir ve
   * upstream düştüğünde tek elde kalan şey budur.
   */
  staleFactor: 10,
};

/**
 * Upstream API'ye giden isteklerin host başına hız freni.
 *
 * Varsayılan **kapalı** (`rate: 0`): fren, kotasını bilen bir uygulamanın
 * bilinçli kararı. Açıldığında `rate` bir tavan olur ve gerçek hız 429
 * cevaplarına göre kendini aşağı çeker (bkz. `src/server/upstream-limiter.js`).
 *
 * `hosts` ile tek tek uçlar ayrılabilir; API'lerin kotası aynı olmak zorunda
 * değil:
 *
 *   upstream: { rate: 10, hosts: { "api.example.com": { rate: 3 } } }
 */
export const DEFAULT_UPSTREAM_LIMIT = {
  /** Saniyedeki en fazla çağrı. 0 → fren tamamen kapalı. */
  rate: 0,
  /** Kova boyu; verilmezse bir saniyelik bütçe kadar patlamaya izin verilir. */
  burst: 0,
  /** Aynı anda uçabilecek çağrı. Ortalama hızdan bağımsız: anlık baskıyı bağlar. */
  concurrency: 8,
  /** Azalmanın dibi: hız buranın altına inmez, yoksa site tamamen durur. */
  minRate: 0.5,
  /** Toplamsal artışın adımı (çağrı/saniye) ve periyodu. */
  increaseStep: 1,
  increaseIntervalMs: 5000,
  /**
   * İki azalma arasındaki en kısa süre. Aynı anda uçan on çağrının hepsi 429
   * dönerse hız on kez yarılanıp dibe vurmasın.
   */
  decreaseIntervalMs: 1000,
  /** Devre kesici: art arda kaç 429'dan sonra host'a hiç gidilmeyeceği. */
  breakerFailures: 5,
  breakerCooldownMs: 10_000,
  /** @type {Record<string, Record<string, number>>} */
  hosts: {},
};

/**
 * Opsiyonel Redis ikinci kademesi (L2).
 *
 * Redis **birincil store değil**: bellek içi önbellek (L1) aynen kalır, Redis
 * iki iş yapar — L1'de bulunmayan bir sayfa için render'ı atlatmak ve
 * invalidation'ı bütün node'lara yaymak. Tek instance çalışan bir kurulumda
 * kazanç neredeyse yok; bu yüzden `enabled` varsayılan olarak kapalı.
 *
 * `storeEncoded` kapalı, çünkü sıkıştırılmış gövdeleri de paylaşmak girdi
 * başına boyutu iki-üç katına çıkarır ve brotli'yi yeniden üretmek Redis'ten
 * indirmekten çoğu zaman daha ucuz.
 */
export const DEFAULT_REDIS = {
  enabled: false,
  /** `redis://` ya da `rediss://`. Boşsa ioredis varsayılanı (localhost:6379). */
  url: /** @type {string | null} */ (null),
  /** Aynı Redis'i paylaşan birden fazla uygulamayı ayırır. */
  namespace: "default",
  keyPrefix: "_jskelet",
  /** HTML gövdeleri paylaşılsın mı. */
  html: true,
  /** Veri önbelleği paylaşılsın mı. */
  data: true,
  /** Brotli/gzip gövdeleri de paylaşılsın mı. */
  storeEncoded: false,
  /** pub/sub üzerinden invalidation yayını. */
  events: true,
  /**
   * Tek bir komutun en fazla bekletebileceği süre. Önbellek okuması isteği
   * bloklayan bir adım: Redis takıldığında render'a düşmek, ağı beklemekten
   * iyidir.
   */
  commandTimeoutMs: 200,
};

/**
 * Önbellek yönetim paneli.
 *
 * `enabled` varsayılan olarak **kapalı** ve ortama bakmaz: panel açıldığında
 * production'da da çalışır, ama açılması bilinçli bir karar olmalı. Kapalıyken
 * router hiç mount edilmez — yolun kendisi de yok, yani 404 dönen bir uç bile
 * ortaya çıkmaz.
 *
 * Şifre her süreç başlangıcında yeniden üretilir (bkz.
 * `src/server/cache-panel.js`): panelin ömrü sürecin ömrü kadardır ve bir
 * deploy eski erişimi otomatik olarak iptal eder. Bu yüzden config'te şifre
 * alanı yok.
 */
export const DEFAULT_CACHE_PANEL = {
  enabled: false,
  basePath: "/_jskelet/cache",
  /** Kaç başarısız denemeden sonra IP yasaklanır. */
  banAttempts: 3,
  /** Yasağın süresi. */
  banHours: 24,
  /** Oturumun ömrü; süreç yeniden başladığında zaten sıfırlanır. */
  sessionHours: 12,
};

/** Oturuma bağlı sayfalar ısıtılmaz; uygulama kendi listesini verebilir. */
export const DEFAULT_PREWARM_SKIP = [
  "/api/",
  "/_fragment/",
  "/__jskelet/",
  "/_jskelet/",
];

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
export const DEFAULT_NAVIGATION_EXCLUDE = ["/api/*", "/_fragment/*", "/_jskelet/*"];

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
