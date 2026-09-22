import { DEFAULT_ADMIN, DEFAULT_CLOUDFLARE, DEFAULT_UPSTREAM_LIMIT } from "./defaults.js";
/** Framework paketinin kökü — kendi şablonlarına ve varlıklarına erişir. */
export declare const FRAMEWORK_ROOT: string;
export type Eagerness = "conservative" | "moderate" | "eager";
export type NavigationConfig = {
    prefetch: false | Eagerness;
    prerender: false | Eagerness;
    viewTransition: boolean;
    /**
     * Spekülasyon dışı bırakılan href desenleri.
     */
    exclude: string[];
};
export type RedisConfig = {
    enabled: boolean;
    url: string | null;
    namespace: string;
    keyPrefix: string;
    /**
     * HTML gövdeleri paylaşılsın mı.
     */
    html: boolean;
    /**
     * Veri önbelleği paylaşılsın mı.
     */
    data: boolean;
    /**
     * Sıkıştırılmış gövdeler de paylaşılsın mı.
     */
    storeEncoded: boolean;
    /**
     * pub/sub invalidation yayını.
     */
    events: boolean;
    commandTimeoutMs: number;
};
export type LogKind = "http" | "event" | "error";
export type LogsConfig = {
    /**
     * Runtime http/event/error satırları stdout'a
     * basılsın mı (banner/build satırları etkilenmez).
     */
    console: boolean;
    /**
     * Sink'lere giden kayıt türleri.
     */
    kinds: LogKind[];
    file: {
        enabled: boolean;
        dir: string;
        rotate: "daily";
    };
    s3: {
        enabled: boolean;
        bucket: string | null;
        prefix: string;
        region: string | null;
        endpoint: string | null;
        flushIntervalMs: number;
        maxBatch: number;
    };
};
export type CompiledPattern = import('./pattern.js').CompiledPattern;
export type ResolvedConfig = {
    /**
     * Proje kökü (mutlak).
     */
    root: string;
    /**
     * Config dosyası okundu mu.
     */
    loaded: boolean;
    /**
     * Mutlak dizin yolları.
     */
    dirs: Record<string, string>;
    headers: {
        pattern: CompiledPattern;
        headers: {
            key: string;
            value: string;
        }[];
    }[];
    redirects: {
        pattern: CompiledPattern;
        destination: string;
        statusCode: number;
    }[];
    rewrites: {
        phase: "beforeFiles" | "afterFiles";
        pattern: CompiledPattern;
        destination: string;
    }[];
    html: {
        pattern: CompiledPattern;
        seconds: number;
    }[];
    /**
     *   Yol deseni başına, HTML cache anahtarına girmesine izin verilen query
     *   parametreleri. Eşleşen kural yoksa query'li istek cache'lenmez.
     */
    cacheQuery: {
        pattern: CompiledPattern;
        allow: true | string[];
    }[];
    /**
     *   Anahtara eklenen sabit parçalar (query allowlist'ten bağımsız). Host'tan
     *   locale üreten sitelerde `host: true` zorunlu.
     */
    cacheVary: {
        host: boolean;
        headers: string[];
        fn: ((req: import('express').Request) => string | null | undefined) | null;
    };
    /**
     * HTML önbelleğinin girdi sınırı.
     */
    htmlMaxEntries: number;
    /**
     * Upstream veri önbelleği ayarları.
     */
    data: Record<string, unknown>;
    /**
     * `fetch` sarılıp geçici hatalar otomatik bildirilsin mi.
     */
    trackUpstream: boolean;
    /**
     * Render'ın okuduğu veri anahtarları kaydedilsin mi.
     */
    trackDependencies: boolean;
    transientRetry: {
        attempts: number;
        delayMs: number;
    };
    /**
     * Opsiyonel Redis ikinci kademesi.
     */
    redis: RedisConfig;
    /**
     * Upstream hız freni.
     */
    upstream: typeof DEFAULT_UPSTREAM_LIMIT;
    /**
     * Kalıcı log sink'leri (dosya + S3).
     */
    logs: LogsConfig;
    /**
     * Framework yönetim paneli.
     */
    admin: typeof DEFAULT_ADMIN;
    /**
     * Cloudflare cache yüzeyi.
     */
    cloudflare: typeof DEFAULT_CLOUDFLARE;
    prewarm: Record<string, unknown>;
    prewarmPriority: {
        source: string;
        test: (pathname: string) => boolean;
    }[];
    brand: Record<string, unknown>;
    auth: {
        crossSubdomainHandoff: boolean | Record<string, unknown>;
    };
    hooks: Record<string, Function>;
    /**
     * Layout `.ejs` dosyasının mutlak yolu.
     */
    layout: string;
    /**
     * Açık route modülü listesi.
     */
    routes: string[] | null;
    /**
     * URL'ler `/` ile bitsin mi (Next `trailingSlash`).
     */
    trailingSlash: boolean;
    static: {
        extensions: Set<string>;
        prefixes: string[];
    };
    /**
     * `DEV_TOKEN` tek başına siteyi kilitlemez; gate
     * ancak bu bayrak veya `DEV_GATE=1` ile açılır.
     */
    devGate: boolean;
    devGateBypass: string[];
    preconnect: string[];
    navigation: NavigationConfig;
    security: SecurityConfig;
    prewarmSkip: string[];
    /**
     * Dev sunucusunun izlediği ek dizinler.
     */
    watch: string[];
    fonts: {
        family: string;
        slug?: string;
        weights: number[];
    }[];
    icons: {
        scan?: string[];
        dir: string;
    } | false;
    images: ImagesConfig | false;
    /**
     * Client bundle'a gömülecek env anahtarları.
     */
    clientEnv: string[];
};
export type ImagesRemoteConfig = {
    enabled: boolean;
    allowHosts: string[];
    path: string;
    maxWidth: number;
    cacheMaxAge: number;
    fetchTimeoutMs: number;
    maxBytes: number;
};
export type ImagesConfig = {
    widths: number[];
    quality: number;
    skip: string[];
    remote: ImagesRemoteConfig | false;
};
/**
 * `bucket`, `JSKELET_LOG_BUCKET` veya `JSKELET_S3_BUCKET` değeri
 * `ayberkenis/jskelet/logs` gibi bir yol olabilir: ilk segment bucket adı,
 * kalanı nesne öneki. Böylece tek env ile hem kova hem klasör verilmiş olur.
 *
 * @param {string | null} value
 * @returns {{ bucket: string | null, prefix: string | null }}
 *   `prefix` null → yol öneki taşımıyor; config/varsayılan kalsın.
 */
export declare function splitS3BucketPath(value: string | null): {
    bucket: string | null;
    prefix: string | null;
};
/**
 * @returns {{ accessKeyId: string, secretAccessKey: string,
 *   sessionToken: string | null } | null}
 */
export declare function readS3CredentialsFromEnv(): {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string | null;
} | null;
/**
 * Kalıcı log sink'leri. Bozuk bir `kinds` listesi siteyi düşürmemeli —
 * bilinmeyen girdiler atılır; hiç geçerli tür kalmazsa varsayılana dönülür.
 *
 * @param {unknown} raw
 * @returns {LogsConfig}
 */
export declare function normalizeLogs(raw: unknown): LogsConfig;
export type SecurityConfig = {
    trustProxy: boolean;
    cookieSecret: string | null;
    csrf: {
        enabled: boolean;
        token: boolean;
        allowedOrigins: string[];
        exclude: CompiledPattern[];
        cookieName: string;
        fieldName: string;
        headerName: string;
    };
};
/**
 * Config'i okur, normalize eder ve modül durumuna yazar. Sunucu ve build
 * süreçleri açılışta bir kez çağırır.
 *
 * Aynı süreçte ikinci çağrı önbelleğe düşer: `jskelet start` hem
 * `ensure-build` hem `createApp` üzerinden çağırıyor ve config'i iki kez
 * okuyup iki kez loglamanın hiçbir faydası yok. Yeniden okumak gerekiyorsa
 * `force: true`.
 *
 * @param {{ root?: string, configFile?: string, force?: boolean }} [options]
 * @returns {Promise<ResolvedConfig>}
 */
export declare function loadConfig(options?: {
    root?: string;
    configFile?: string;
    force?: boolean;
}): Promise<ResolvedConfig>;
/**
 * Çözümlenmiş config. `loadConfig()` çağrılmadan erişilirse boş bir proje
 * kökü varsayımıyla çalışmak yerine hata verir: sessiz yanlış yol,
 * "stylesheet neden yok" gibi teşhisi zor sorunlara dönüşüyor.
 *
 * @returns {ResolvedConfig}
 */
export declare function getConfig(): ResolvedConfig;
/**
 * Uygulamanın tanımladığı hook'u çalıştırır; yoksa `fallback` döner.
 * Hook'un hata vermesi sayfayı düşürmemeli — framework kendi varsayılanına
 * geri döner ve uyarır.
 *
 * @template T
 * @param {string} name
 * @param {T} fallback
 * @param {unknown[]} args
 * @returns {Promise<T>}
 */
export declare function hook<T>(name: string, fallback: T, ...args: unknown[]): Promise<T>;
