/**
 * `jskelet.config.mjs` → `preconnect: ["https://cdn.example.com"]`.
 * Üçüncü taraf kaynaklar (görsel CDN'i, API origin'i, font host'u) buraya
 * yazılır. Boş liste geçerli bir yapılandırmadır.
 *
 * @returns {string}
 */
export declare function preconnectHints(): string;
/**
 * Speculation Rules gövdesini üretir. `getConfig()`ten ayrı tutulmasının
 * sebebi test edilebilirlik: kural üretimi saf bir dönüşüm.
 *
 * @param {import('../config/index.js').NavigationConfig} navigation
 * @returns {object | null} Hiç kural yoksa `null`.
 */
export declare function buildSpeculationRules(navigation: import('../config/index.js').NavigationConfig): object | null;
/**
 * Site içi gezinme ipuçları: Speculation Rules + cross-document view
 * transition. İkisi de her sayfada aynı olduğu için bir kez hesaplanır.
 *
 * Bunlar bilinçli olarak client runtime'ı değil: tarayıcı bağlantı üzerinde
 * duraksamayı, önceliklendirmeyi ve iptali kendisi yönetiyor. Aynı davranışı
 * JS ile yazmak hem daha fazla bayt hem daha kötü bir tahmin demek.
 *
 * @returns {string}
 */
export declare function navigationHints(): string;
/**
 * İlk ekrandaki görselin preload'ı. Preconnect'leri layout zaten her sayfaya
 * bastığı için burada tekrarlanmaz.
 *
 * @param {{ href?: string | null, imageSrcSet?: string,
 *   imageSizes?: string }} [lcpImage]
 * @returns {string}
 */
export declare function headHints(lcpImage?: {
    href?: string | null;
    imageSrcSet?: string;
    imageSizes?: string;
}): string;
