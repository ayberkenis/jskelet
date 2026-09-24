/**
 * Framework varsayılanları.
 *
 * Buradaki hiçbir değer domain bilgisi taşımaz: uygulamaya özel her şey
 * `jskelet.config.mjs` üzerinden gelir. Varsayılanların ayrı dosyada olması,
 * "framework ne yapıyor, uygulama ne ekliyor" ayrımını okunur tutar.
 */
/** Uzun süre cache'lenecek hash'li çıktı dizini. */
export declare const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
/**
 * Proje kökündeki dizin adları. `jskelet.config.mjs` içinde `paths` ile
 * tek tek ezilebilir.
 */
export declare const DEFAULT_DIRS: {
    /** Layout + sayfalar + bileşenler (klasik kök). */
    views: string;
    /** Feature-first dikey dilimler (`features/<name>/{server,views,client}`). */
    features: string;
    /** Özellikler arası paylaşılan server/views/client. */
    shared: string;
    /** Statik dosyalar; build çıktısı da buraya yazılır. */
    public: string;
    /** Island runtime ve entry'ler. */
    client: string;
    /** Route modülleri. */
    routes: string;
    /** Tailwind/PostCSS giriş dosyası. */
    styles: string;
    /** Build ara çıktıları (manifest, metafile, images, templates). */
    generated: string;
};
/**
 * Uzantı ve önek bazlı statik dosya tespiti. Bu listeye uyan yollara
 * `IMMUTABLE_CACHE` yazılır.
 */
export declare const DEFAULT_STATIC: {
    extensions: string[];
    prefixes: string[];
};
/** Dev gate'in hiçbir koşulda kapatmadığı yollar. */
export declare const DEFAULT_DEV_GATE_BYPASS: string[];
/**
 * Klasik (liste tabanlı) prewarm ayarları. `onVisit` modu bunlarla birlikte
 * kullanılamaz — ya açılış/`prewarmPaths` turu, ya ziyaret edilen sayfadaki
 * linkleri ısıtma.
 */
export declare const DEFAULT_PREWARM: {
    enabled: boolean;
    max: number;
    intervalSeconds: number;
    /** Paralel ısıtma isteği; dev'de sunucu tek süreç olduğu için düşürülür. */
    concurrency: number;
    /** İki tur arasında beklenen süre: upstream'e ani yük binmesin. */
    delayMs: number;
    /**
     * Saniyedeki en fazla ısıtma isteği. 0 → sınırsız (yalnızca `concurrency`
     * frenler). Upstream'i kota sınırının altında tutmanın en doğrudan yolu bu:
     * paralellik ne kadar yükselse de tur bu hızın üstüne çıkmaz.
     */
    rps: number;
    /**
     * Tekrar turundan önce beklenen süre. Rate limit pencereleri saniye
     * mertebesinde; hemen tekrar denemek aynı 429'u almak demek.
     */
    retryDelayMs: number;
    /**
     * Liste `max`'tan uzunsa periyodik turlar kaldığı yerden devam eder.
     * Böylece 10.000 yolluk bir site tek turda değil, turlar boyunca ısınır.
     * `priority` eşleşen yollar her turda ısıtıldığı için rotasyon yalnızca
     * kuyruğu dolaşır.
     */
    rotate: boolean;
    /**
     * Isıtma sırasını belirleyen desenler. String (`/haber/:slug`) ya da
     * `RegExp` kabul eder; önce yazılan önce ısınır.
     * @type {(string | RegExp)[]}
     */
    priority: (string | RegExp)[];
    /**
     * Klasik turda ısıtılacak origin listesi. Boşsa `http://127.0.0.1:<port>`.
     * `cache().vary.host` açıkken locale host'ları buraya yazılmazsa yalnızca
     * loopback anahtarı ısınır.
     * @type {string[]}
     */
    origins: string[];
};
/**
 * Ziyaret tabanlı ısıtma. Bir sayfa servis edilince HTML'deki aynı-origin
 * linkler kuyruğa alınır; bir sonraki tıklama (veya başka ziyaretçi) çoğu
 * zaman HIT görür. Klasik `prewarm` alanlarıyla karşılıklı dışlayıcıdır.
 */
export declare const DEFAULT_PREWARM_ON_VISIT: {
    enabled: boolean;
    /** Sayfa başına üstten alta en fazla kaç link kuyruğa alınır. */
    perPage: number;
    /**
     * Paralel işçi. `null` yalnızca kapalı modda durur; açıkken tavan
     * (`ON_VISIT_CONCURRENCY_CEILING`) uygulanır. Klasik prewarm'daki
     * prod 4 burada geçerli değil — onVisit sürekli çalışır.
     * @type {number | null}
     */
    concurrency: number | null;
    /**
     * Saniyedeki istek tavanı. `null` yalnızca kapalı modda durur; açıkken
     * `0` (sınırsız) dahil her şey `ON_VISIT_RPS_CEILING` ile kesilir.
     * @type {number | null}
     */
    rps: number | null;
};
/**
 * onVisit sürekli tur olduğu için klasik prewarm'daki "sınırsız" burada yok.
 * Config daha yükseğini yazsa da çözümlenen değer bu tavanları geçemez.
 */
export declare const ON_VISIT_PER_PAGE_CEILING = 20;
export declare const ON_VISIT_RPS_CEILING = 2;
export declare const ON_VISIT_CONCURRENCY_CEILING = 2;
/**
 * Bekleyen onVisit yolları. Bir sayfa düzinelerce link basınca kuyruk
 * birikmesin; taşan link bu turda alınmaz.
 */
export declare const ON_VISIT_QUEUE_MAX = 64;
/** `onVisit` açıkken `cache().prewarm` kökünde yasak olan klasik alanlar. */
export declare const CLASSIC_PREWARM_KEYS: string[];
/**
 * HTML önbelleğinin girdi sınırı. 500 girdi ortalama bir sayfa boyutunda
 * yaklaşık 100-200 MB tutar; uzun kuyruklu siteler bunu yükseltmek yerine
 * veri önbelleğine yaslanmalı (bkz. `DEFAULT_DATA_CACHE`).
 *
 * Config daha yükseğini istese de girdi sayısı `HTML_CACHE_MAX_ENTRIES_CEILING`
 * değerini geçemez. Asıl bellek freni bayt bütçesidir: şişman sayfa ve
 * `vary.host` kopyası sayı tavanının altında da RSS'i şişirir.
 */
export declare const DEFAULT_HTML_CACHE_MAX_ENTRIES = 500;
/** `cache().maxEntries` için sert tavan. Üstü uyarıyla bu değere çekilir. */
export declare const HTML_CACHE_MAX_ENTRIES_CEILING = 800;
/**
 * Süreç içi HTML string + sıkıştırılmış gövde tavanı (256 MB).
 * `install()` bunu uygular; config yükseltemez. Tek sayfa bütçeden büyükse
 * saklanmaz, yanıt yine gider.
 */
export declare const HTML_CACHE_BYTE_BUDGET: number;
/**
 * Süreç içi veri önbelleğinin JSON bayt tavanı (64 MB). Sayı tavanı
 * şişman gövdeleri tutmaz; config yükseltemez. Tek değer bütçeden büyükse
 * saklanmaz, çağıran sonucu yine alır.
 */
export declare const DATA_CACHE_BYTE_BUDGET: number;
/**
 * Uzak görsel disk önbelleğinin tavanı (256 MB). `.jskelet/image-cache/`
 * bu boyutu aşınca en eski dosya düşer. Config yükseltemez.
 */
export declare const IMAGE_CACHE_BYTE_BUDGET: number;
/** `cache().data.maxEntries` için sert tavan. Uzun kuyruk burada durur, HTML'de değil. */
export declare const DATA_CACHE_MAX_ENTRIES_CEILING = 20000;
/**
 * `notFound()` geçici bir upstream hatasına denk geldiğinde sayfanın kaç kez
 * daha denenmesi gerektiği.
 *
 * Varsayılan tek deneme: maliyeti upstream'e binen ikinci bir istek turu, ama
 * alternatifi var olan bir sayfayı 404 olarak servis etmek — arama motoru için
 * geçici bir rate limit'in kalıcı kayba dönüşmesi. `attempts: 0` tekrarı
 * kapatır ve doğrudan önbelleğe girmeyen 503'e düşer.
 */
export declare const DEFAULT_TRANSIENT_RETRY: {
    attempts: number;
    delayMs: number;
};
/**
 * Upstream veri önbelleği.
 *
 * HTML önbelleğinden bilinçli olarak çok daha büyük: JSON, aynı sayfanın
 * HTML'ine göre onlarca kat küçük. Uzun kuyruğu (on binlerce haber/etiket)
 * HTML olarak tutmak imkânsız, verisini tutmak ise ucuz — ve API kotasını
 * koruyan katman burası.
 */
export declare const DEFAULT_DATA_CACHE: {
    maxEntries: number;
    /**
     * TTL dolduktan sonra girdinin kaç TTL boyunca daha kullanılabileceği.
     * HTML'deki 1 katsayısından yüksek: bayat veri, eksik sayfadan iyidir ve
     * upstream düştüğünde tek elde kalan şey budur.
     */
    staleFactor: number;
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
export declare const DEFAULT_UPSTREAM_LIMIT: {
    /** Saniyedeki en fazla çağrı. 0 → fren tamamen kapalı. */
    rate: number;
    /** Kova boyu; verilmezse bir saniyelik bütçe kadar patlamaya izin verilir. */
    burst: number;
    /** Aynı anda uçabilecek çağrı. Ortalama hızdan bağımsız: anlık baskıyı bağlar. */
    concurrency: number;
    /** Azalmanın dibi: hız buranın altına inmez, yoksa site tamamen durur. */
    minRate: number;
    /** Toplamsal artışın adımı (çağrı/saniye) ve periyodu. */
    increaseStep: number;
    increaseIntervalMs: number;
    /**
     * İki azalma arasındaki en kısa süre. Aynı anda uçan on çağrının hepsi 429
     * dönerse hız on kez yarılanıp dibe vurmasın.
     */
    decreaseIntervalMs: number;
    /** Devre kesici: art arda kaç 429'dan sonra host'a hiç gidilmeyeceği. */
    breakerFailures: number;
    breakerCooldownMs: number;
    /** @type {Record<string, Record<string, number>>} */
    hosts: {};
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
export declare const DEFAULT_REDIS: {
    enabled: boolean;
    /** `redis://` ya da `rediss://`. Boşsa ioredis varsayılanı (localhost:6379). */
    url: string | null;
    /** Aynı Redis'i paylaşan birden fazla uygulamayı ayırır. */
    namespace: string;
    keyPrefix: string;
    /** HTML gövdeleri paylaşılsın mı. */
    html: boolean;
    /** Veri önbelleği paylaşılsın mı. */
    data: boolean;
    /** Brotli/gzip gövdeleri de paylaşılsın mı. */
    storeEncoded: boolean;
    /** pub/sub üzerinden invalidation yayını. */
    events: boolean;
    /**
     * Tek bir komutun en fazla bekletebileceği süre. Önbellek okuması isteği
     * bloklayan bir adım: Redis takıldığında render'a düşmek, ağı beklemekten
     * iyidir.
     */
    commandTimeoutMs: number;
};
/**
 * Kalıcı log sink'leri (dosya + S3).
 *
 * Varsayılan her şey kapalı: stdout ve admin ring mevcut davranışını korur.
 * `kinds` hangi structured kayıtların sink'lere gideceğini seçer; `console`
 * runtime `http`/`event`/`error` satırlarının terminalde görünmesini kontrol
 * eder (banner/build satırlarına dokunmaz).
 *
 * S3 credential'ları config'e yazılmaz — `JSKELET_S3_ACCESS_KEY_ID` /
 * `JSKELET_S3_SECRET_ACCESS_KEY` (ve isteğe bağlı `JSKELET_S3_SESSION_TOKEN`).
 * Bucket için `JSKELET_LOG_BUCKET` (veya `JSKELET_S3_BUCKET`) env'i config'i
 * ezer ve `ayberkenis/jskelet/logs` gibi `bucket/prefix` yolunu kabul eder.
 * Uyumlu API adresi `JSKELET_S3_API_URL` (S3-compatible endpoint).
 */
export declare const DEFAULT_LOGS: {
    console: boolean;
    /** @type {Array<"http" | "event" | "error">} */
    kinds: Array<"http" | "event" | "error">;
    file: {
        enabled: boolean;
        /** Proje köküne göre relative. */
        dir: string;
        /**
         * Artık kullanılmıyor. Parçalar en fazla 5 dakika durur; alan çözülen
         * config'te durur ki eski okuyucular kırılmasın.
         */
        rotate: "daily";
    };
    s3: {
        enabled: boolean;
        /** @type {string | null} */
        bucket: string | null;
        prefix: string;
        /** @type {string | null} */
        region: string | null;
        /** MinIO vb. için; null → AWS. */
        /** @type {string | null} */
        endpoint: string | null;
        flushIntervalMs: number;
        maxBatch: number;
    };
};
/**
 * Framework yönetim paneli (`/_jskelet/admin`).
 *
 * `enabled` varsayılan olarak **kapalı** ve ortama bakmaz: panel açıldığında
 * production'da da çalışır, ama açılması bilinçli bir karar olmalı. Kapalıyken
 * router hiç mount edilmez — yolun kendisi de yok, yani 404 dönen bir uç bile
 * ortaya çıkmaz.
 *
 * Şifre her süreç başlangıcında yeniden üretilir (bkz. `src/server/admin/`):
 * panelin ömrü sürecin ömrü kadardır ve bir deploy eski erişimi otomatik
 * olarak iptal eder. Bu yüzden config'te şifre alanı yok.
 */
export declare const DEFAULT_ADMIN: {
    enabled: boolean;
    basePath: string;
    /**
     * Boş dizi = IP kısıtı yok. Exact IP veya CIDR (`10.0.0.0/8`); listede
     * olmayan her istek 404 (login dahil).
     * @type {string[]}
     */
    allowIps: string[];
    /** Bilinen crawler / bot UA'ları 404 ile reddedilsin mi. */
    blockBots: boolean;
    /** Kaç başarısız denemeden sonra IP yasaklanır. */
    banAttempts: number;
    /** Yasağın süresi. */
    banHours: number;
    /** Oturumun ömrü; süreç yeniden başladığında zaten sıfırlanır. */
    sessionHours: number;
    /** Canlı log ring boyutu (HTTP + framework olayları). */
    logSize: number;
};
/**
 * Cloudflare cache yüzeyi.
 *
 * JSkelet'in önbelleği origin önbelleği; ziyaretçinin gördüğü kopya CDN'de.
 * Bu bölüm ikisini aynı panelden yönetilebilir kılar (bkz.
 * `src/server/cloudflare.js`).
 *
 * Token **config'e yazılmamalı**: `JSKELET_CLOUDFLARE_KEY` env'i önceliklidir
 * ve önerilen yol odur. Zone kimliği sır değil, ama o da env'den okunabilir
 * (`JSKELET_CLOUDFLARE_ZONE_ID`).
 *
 * Gereken token izinleri: purge için `Zone.Cache Purge`, ayarlar için
 * `Zone.Zone Settings`, analitik için `Zone.Analytics` (salt okunur).
 */
export declare const DEFAULT_CLOUDFLARE: {
    /** `false` verilirse env'de token olsa bile yüzey kapalı kalır. */
    enabled: boolean;
    /** @type {string | null} */
    zoneId: string | null;
    /** @type {string | null} Env tercih edilir; burada tutmak sırrı repoya sokar. */
    apiToken: string | null;
    /**
     * Purge, tam URL istiyor; panel elinde yalnızca yol tutuyor. Site adı
     * verilmezse purge isteğinin geldiği istek origin'i kullanılır.
     * @type {string | null}
     */
    hostname: string | null;
    /** Analitik penceresi (saat). Cloudflare'in izin verdiği aralıkla sınırlı. */
    analyticsHours: number;
};
/** Oturuma bağlı sayfalar ısıtılmaz; uygulama kendi listesini verebilir. */
export declare const DEFAULT_PREWARM_SKIP: string[];
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
export declare const DEFAULT_NAVIGATION: {
    /** `false` ya da eagerness: "conservative" | "moderate" | "eager". */
    prefetch: false | "conservative" | "moderate" | "eager";
    /** @type {false | "conservative" | "moderate" | "eager"} */
    prerender: false | "conservative" | "moderate" | "eager";
    /** `@view-transition { navigation: auto }` basılsın mı. */
    viewTransition: boolean;
};
/**
 * Hiçbir koşulda önden getirilmeyecek yollar. Yan etkisi olan ya da gezinme
 * hedefi olmayan uçların spekülatif istekle tetiklenmesi gerçek bir hata
 * kaynağı; uygulama kendi listesini `navigation.exclude` ile ekler.
 */
export declare const DEFAULT_NAVIGATION_EXCLUDE: string[];
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
export declare const DEFAULT_SECURITY: {
    trustProxy: boolean;
    /** @type {string | null} */
    cookieSecret: string | null;
    csrf: {
        enabled: boolean;
        token: boolean;
        /** Ek olarak kabul edilen origin'ler (ör. ayrı bir admin alan adı). */
        allowedOrigins: string[];
        /** Kontrolden muaf yollar — webhook uçları buraya yazılır. */
        exclude: string[];
        cookieName: string;
        fieldName: string;
        headerName: string;
    };
};
/**
 * Build-zamanı görsel adımı + opsiyonel runtime uzak görsel proxy.
 *
 * `remote` kapalıyken `image()` uzak URL'leri olduğu gibi basar (eski davranış).
 * Açılınca yalnızca `allowHosts` listesindeki host'lar proxy edilir — boş liste
 * açık proxy / SSRF kapısı olurdu, bu yüzden allowHosts olmadan remote hiç
 * mount edilmez.
 */
export declare const DEFAULT_IMAGES: {
    widths: number[];
    quality: number;
    skip: string[];
    remote: {
        /** @type {string[]} */
        allowHosts: string[];
        path: string;
        /** İzin verilen en büyük `w` (retina üstü israf). */
        maxWidth: number;
        /** Disk önbelleği Cache-Control max-age (saniye). */
        cacheMaxAge: number;
        fetchTimeoutMs: number;
        /** Upstream gövde üst sınırı; aşılırsa 502. */
        maxBytes: number;
    };
};
/**
 * Markalama. Header adı ve dev overlay yolu tek yerden değişsin diye
 * config'ten okunur — fork eden proje kendi adını verebilir.
 */
export declare const DEFAULT_BRAND: {
    name: string;
    /** `<html lang>`; uygulama kendi dilini config'te bildirir. */
    lang: string;
    poweredBy: string;
    cacheHeader: string;
    devBasePath: string;
    prewarmUserAgent: string;
    devTokenCookie: string;
    /**
     * Paylaşımlı cookie Domain kökleri (örn. `.investvio.com`, `.localhost`).
     * `writeSharedCookie` host bunlardan birine uyuyorsa Domain olarak yazar.
     * @type {string[]}
     */
    sharedCookieRoots: string[];
};
/**
 * Kimlik / alt alan handoff. Framework oturum vermez; yalnızca çapraz-subdomain
 * cookie köprüsü opsiyoneldir.
 */
export declare const DEFAULT_AUTH: {
    /**
     * `true` veya `{ allowedCookieNames, ttlSeconds?, path?, maxValueBytes?,
     * maxPendingTickets?, maxMintsPerIpPerMinute? }`.
     * Açıkken `POST /_jskelet/auth/handoff` ve `?handoff=` redeem middleware'i.
     * Mint için `allowedCookieNames` dolu olmalı (aksi halde 400).
     * @type {boolean | {
     *   enabled?: boolean,
     *   allowedCookieNames?: string[],
     *   ttlSeconds?: number,
     *   path?: string,
     *   maxValueBytes?: number,
     *   maxPendingTickets?: number,
     *   maxMintsPerIpPerMinute?: number,
     * }}
     */
    crossSubdomainHandoff: boolean | {
        enabled?: boolean;
        allowedCookieNames?: string[];
        ttlSeconds?: number;
        path?: string;
        maxValueBytes?: number;
        maxPendingTickets?: number;
        maxMintsPerIpPerMinute?: number;
    };
};
