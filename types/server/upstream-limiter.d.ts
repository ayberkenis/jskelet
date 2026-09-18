export type HostState = {
    host: string;
    /**
     * Config'te verilen tavan; AIMD bunun üstüne çıkmaz.
     */
    maxRate: number;
    /**
     * Azalmanın dibi; 0'a inip tamamen kilitlenmesin.
     */
    minRate: number;
    /**
     * Saniyedeki izin — AIMD bunu oynatır.
     */
    rate: number;
    /**
     * Kovanın boyu: kısa patlamalara verilen tolerans.
     */
    burst: number;
    /**
     * Aynı anda uçabilecek çağrı sayısı.
     */
    concurrency: number;
    tokens: number;
    refilledAt: number;
    /**
     * Uçuştaki çağrı.
     */
    active: number;
    /**
     * Boş yuva bekleyenler.
     */
    waiters: (() => void)[];
    /**
     * Admission sırası (FIFO).
     */
    chain: Promise<void>;
    /**
     * `Retry-After` boyunca kova tamamen durur.
     */
    blockedUntil: number;
    consecutiveFailures: number;
    /**
     * Devre kesicinin açık kaldığı an.
     */
    bypassUntil: number;
    /**
     * Son AIMD kararının zamanı.
     */
    adjustedAt: number;
    /**
     * Kaç kez 429/503 görüldü (teşhis için).
     */
    throttled: number;
    /**
     * Devre kesici kaç çağrıyı hiç göndermedi.
     */
    rejected: number;
};
/**
 * `createApp()` config yüklendikten sonra bir kez çağırır. Ayar değiştiğinde
 * host durumları sıfırlanır: eski `maxRate`'e göre ayarlanmış bir `rate`
 * yeni tavanın üstünde kalabilir.
 *
 * @param {Record<string, unknown> | undefined} config `cache().upstream`
 * @returns {void}
 */
export declare function configureUpstreamLimiter(config: Record<string, unknown> | undefined): void;
/**
 * Çağrı için izin alır. `null` dönerse fren kapalı ya da host çözülemedi;
 * `blocked` dönerse devre kesici açık ve çağrı hiç yapılmamalı.
 *
 * @param {string} url
 * @returns {Promise<{ blocked: boolean, host: string, release: () => void } | null>}
 */
export declare function limitUpstream(url: string): Promise<{
    blocked: boolean;
    host: string;
    release: () => void;
} | null>;
/**
 * Yanıtın hıza etkisini işler. 429/503 hızı yarıya indirir ve `Retry-After`
 * varsa kovayı o süre boyunca tamamen durdurur; başarı sayaçları sıfırlar.
 *
 * @param {string} host
 * @param {number} status `0` → ağ hatası (yanıt gelmedi).
 * @param {string | null} [retryAfter] `Retry-After` başlığı.
 * @returns {void}
 */
export declare function noteUpstreamResponse(host: string, status: number, retryAfter?: string | null): void;
/**
 * Dev paneli ve teşhis için host başına durum. Fren kapalıysa boş dizi.
 *
 * @returns {{ host: string, rate: number, maxRate: number, concurrency: number,
 *   active: number, throttled: number, rejected: number, bypassed: boolean,
 *   blockedMs: number, bypassedMs: number }[]}
 */
export declare function getUpstreamLimiterStatus(): {
    host: string;
    rate: number;
    maxRate: number;
    concurrency: number;
    active: number;
    throttled: number;
    rejected: number;
    bypassed: boolean;
    blockedMs: number;
    bypassedMs: number;
}[];
/**
 * Freni bekleten en uzun süre. Isıtma turunun tekrar denemesi bunu kullanıyor:
 * sabit bir bekleme, kesici 10 saniye açıkken 2 saniye sonra tekrar denemek
 * demekti — yani aynı 429'u peşin peşin almak.
 *
 * @returns {number} ms; fren kapalıysa ya da bekleyen bir şey yoksa 0.
 */
export declare function upstreamCooldownMs(): number;
/**
 * Testler için: ayarları verip tüm host durumlarını sıfırlar.
 *
 * @param {Record<string, unknown>} [config]
 * @returns {void}
 */
export declare function resetUpstreamLimiterForTests(config?: Record<string, unknown>): void;
