export type UpstreamFailure = {
    status: number;
    path: string;
};
/**
 * @param {UpstreamFailure} failure
 * @returns {void}
 */
export declare function reportUpstreamFailure(failure: UpstreamFailure): void;
/**
 * @param {number} status
 * @returns {boolean}
 */
export declare function isTransientStatus(status: number): boolean;
/**
 * `globalThis.fetch`i sarıp **geçici** upstream hatalarını kendiliğinden
 * bildirir.
 *
 * Gerekçesi pratik: `reportUpstreamFailure()` sözleşmesi uygulamanın HTTP
 * istemcisine bir satır eklemeyi gerektiriyor ve o satır yazılmadığında
 * framework rate limit'i hiç göremiyor — veri gelmediği için `notFound()`
 * çağıran sayfa 404 olarak servis ediliyordu. Otomatik izleme bu bilgiyi
 * varsayılan hâle getirir; elle çağrı hâlâ geçerli ve tekilleştirilir.
 *
 * Yalnızca geçici durumlar bildirilir. `404`/`403` gibi deterministik
 * cevaplar birçok API'de "böyle bir kayıt yok" anlamına geliyor ve onları
 * otomatik olarak "eksik veri" saymak her sayfada yanlış uyarı üretirdi.
 *
 * Kendi sunucumuza yapılan istekler atlanır: ısıtma turu ve sağlık kontrolü
 * upstream değil.
 *
 * @returns {void}
 */
export declare function trackUpstreamFetch(): void;
/**
 * @param {() => T} run
 * @returns {T}
 * @template T
 */
export declare function withUpstreamTracking<T>(run: () => T): T;
/** @returns {UpstreamFailure[]} */
export declare function getUpstreamFailures(): UpstreamFailure[];
