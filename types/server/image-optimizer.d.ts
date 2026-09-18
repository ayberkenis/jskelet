/**
 * @returns {import('../config/index.js').ImagesRemoteConfig | null}
 */
export declare function getRemoteImages(): import('../config/index.js').ImagesRemoteConfig | null;
/**
 * Mutlak http(s) URL mi ve allowHosts'ta mı.
 * @param {string} src
 * @returns {URL | null}
 */
export declare function parseAllowedRemoteUrl(src: string): URL | null;
/**
 * Host allowlist + literal private IP; redirect hop'larında da kullanılır.
 *
 * @param {URL} url
 * @param {string[]} allowHosts
 * @returns {boolean}
 */
export declare function isRemoteUrlShapeAllowed(url: URL, allowHosts: string[]): boolean;
/**
 * Hostname'i çözümleyip private IP'ye düşüyorsa reddet (DNS rebinding
 * savunması; TOCTOU kalır ama check-time private resolve yakalanır).
 *
 * @param {string} hostname
 * @returns {Promise<boolean>} true = güvenli
 */
export declare function assertResolvedHostSafe(hostname: string): Promise<boolean>;
/**
 * @param {string} hostname
 * @param {string[]} allowHosts
 * @returns {boolean}
 */
export declare function isHostAllowed(hostname: string, allowHosts: string[]): boolean;
/**
 * Literal private / link-local / loopback host'ları reddet (SSRF).
 * Allowlist asıl koruma; bu ek bir savunma katmanı.
 * @param {string} hostname
 * @returns {boolean}
 */
export declare function isBlockedAddress(hostname: string): boolean;
/**
 * Optimizer URL'si üret. `image()` ve elle URL kuran uygulamalar için.
 * @param {string} src Uzak görsel URL'si
 * @param {{ width: number, quality?: number }} options
 * @returns {string | null} Allowlist dışıysa null
 */
export declare function remoteImageUrl(src: string, options: {
    width: number;
    quality?: number;
}): string | null;
/**
 * @param {number} width
 * @param {number} maxWidth
 * @returns {number}
 */
export declare function clampWidth(width: number, maxWidth: number): number;
/**
 * Görüntülenen genişliğe göre srcset adayları (1x + 2x + config widths).
 * @param {number} displayWidth
 * @param {number[]} widths
 * @param {number} maxWidth
 * @returns {number[]}
 */
export declare function srcsetWidths(displayWidth: number, widths: number[], maxWidth: number): number[];
/**
 * @param {import('express').Express} app
 * @returns {Promise<void>}
 */
export declare function mountImageOptimizer(app: import('express').Express): Promise<void>;
