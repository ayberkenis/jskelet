/** @returns {boolean} */
export declare function cloudflareConfigured(): boolean;
/**
 * Panelin gösterdiği kurulum özeti. Token'ın kendisi değil, **nereden
 * geldiği** döner.
 *
 * @returns {{ configured: boolean, enabled: boolean, zoneId: string | null,
 *   tokenSource: "env" | "config" | null, hostname: string | null }}
 */
export declare function getCloudflareStatus(): {
    configured: boolean;
    enabled: boolean;
    zoneId: string | null;
    tokenSource: "env" | "config" | null;
    hostname: string | null;
};
/**
 * Zone künyesi + cache ile ilgili ayarlar.
 *
 * Ayarlar tek tek değil, tek `GET /settings` turuyla okunur ve ilgili olanlar
 * ayıklanır. Tiered Cache ve Cache Reserve ayrı uçlarda yaşıyor; ikisi de
 * planla sınırlı olduğu için hataları **yok sayılır**, yalnızca `null` olurlar
 * — Free bir zone'da panel yine açılmalı.
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<object>}
 */
export declare function fetchCloudflareOverview(options?: {
    force?: boolean;
}): Promise<object>;
/**
 * Zone'un cache durumu kırılımı: `hit`, `miss`, `dynamic`, `expired`… her biri
 * için istek sayısı ve edge'den giden bayt.
 *
 * `httpRequestsAdaptiveGroups` bilinçli seçildi: `cacheStatus` boyutu eski
 * `httpRequests1hGroups` veri kümesinde yok ve pek çok hesapta hata veriyor.
 * Adaptive küme örnekleme kullanıyor, yani sayılar **tahmindir** — oranlar
 * doğru, mutlak değerler yaklaşık.
 *
 * @param {{ hours?: number }} [options]
 * @returns {Promise<{ ok: boolean, hours: number, sampled: boolean,
 *   rows: { status: string, requests: number, bytes: number }[],
 *   error?: string }>}
 */
export declare function fetchCacheAnalytics(options?: {
    hours?: number;
}): Promise<{
    ok: boolean;
    hours: number;
    sampled: boolean;
    rows: {
        status: string;
        requests: number;
        bytes: number;
    }[];
    error?: string;
}>;
/**
 * Bir yolun **kolo bazında** cache kırılımı.
 *
 * Bu, "kaç edge'de bu sayfanın kopyası var" sorusunun API'nin verdiği en yakın
 * cevabı: son `hours` saatte hangi Cloudflare şehri o yolu kaç kez cache'ten
 * (`hit`) ya da origin'den (`miss`, `expired`, `dynamic`) servis etti. Envanter
 * değil, gözlem — hiç istek almamış bir edge listede görünmez, kopyası olsa da.
 *
 * @param {{ path: string, hours?: number }} options
 * @returns {Promise<{ ok: boolean, path: string, hours: number,
 *   colos: { colo: string, hits: number, misses: number }[],
 *   hits: number, misses: number, error?: string }>}
 */
export declare function fetchPathEdges({ path, hours }: {
    path: string;
    hours?: number;
}): Promise<{
    ok: boolean;
    path: string;
    hours: number;
    colos: {
        colo: string;
        hits: number;
        misses: number;
    }[];
    hits: number;
    misses: number;
    error?: string;
}>;
/**
 * Cloudflare önbelleğini düşürür.
 *
 * Dört hedefleme biçimi de API'nin verdiği hâliyle: `files` (tam URL),
 * `prefixes`, `hosts`, `tags`. Hepsi artık her planda çalışıyor ama istek
 * başına en fazla 100 anahtar kabul ediliyor; uzun listeler burada parçalanır
 * ve **sırayla** gönderilir — paralel göndermek Free planda dakikada beş
 * istekle sınırlı olan hız freni yüzünden yarısı reddedilen bir tur demek.
 *
 * @param {{ everything?: boolean, files?: string[], prefixes?: string[],
 *   hosts?: string[], tags?: string[] }} target
 * @returns {Promise<{ ok: boolean, purged: number, batches: number,
 *   error?: string }>}
 */
export declare function purgeCloudflare(target: {
    everything?: boolean;
    files?: string[];
    prefixes?: string[];
    hosts?: string[];
    tags?: string[];
}): Promise<{
    ok: boolean;
    purged: number;
    batches: number;
    error?: string;
}>;
/**
 * Yolları tam URL'e çevirir. Cloudflare `files` purge'ü şemayı da içeren tam
 * URL istiyor; panel elinde yol (`/haber/abc`) tutuyor.
 *
 * @param {string[]} paths
 * @param {string} [fallbackOrigin] `cloudflare.hostname` verilmediğinde
 *   kullanılacak kök (panelin açıldığı origin).
 * @returns {string[]}
 */
export declare function toCloudflareUrls(paths: string[], fallbackOrigin?: string): string[];
/**
 * Cache ile ilgili bir zone ayarını değiştirir.
 *
 * Yalnızca beyaz listedeki ayarlar: panelin işi cache, ve bir teşhis
 * arayüzünden zone'un tamamını yeniden yapılandırılabilir yapmak gereksiz bir
 * yüzey.
 *
 * @param {"development_mode" | "cache_level" | "browser_cache_ttl" |
 *   "always_online" | "sort_query_string_for_cache"} id
 * @param {string | number} value
 * @returns {Promise<{ ok: boolean, value?: unknown, error?: string }>}
 */
export declare function setCloudflareSetting(id: "development_mode" | "cache_level" | "browser_cache_ttl" | "always_online" | "sort_query_string_for_cache", value: string | number): Promise<{
    ok: boolean;
    value?: unknown;
    error?: string;
}>;
/**
 * Tiered Cache ya da Cache Reserve'ü açar/kapatır. İkisi de ayrı uçlarda ve
 * planla sınırlı; kapalı bir planda Cloudflare açıklayıcı bir hata döner ve
 * panel onu gösterir.
 *
 * @param {"tiered_caching" | "cache_reserve" | "regional_tiered_cache"} feature
 * @param {"on" | "off"} value
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export declare function setCloudflareFeature(feature: "tiered_caching" | "cache_reserve" | "regional_tiered_cache", value: "on" | "off"): Promise<{
    ok: boolean;
    error?: string;
}>;
/**
 * Cache Reserve'ü (R2'deki kalıcı kopya) boşaltır. Purge'den ayrı bir işlem:
 * `purge_everything` edge önbelleklerini düşürüyor, Cache Reserve'deki kopya
 * kalıyor.
 *
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export declare function clearCloudflareCacheReserve(): Promise<{
    ok: boolean;
    error?: string;
}>;
