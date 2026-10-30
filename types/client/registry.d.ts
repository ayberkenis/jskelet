export type MountFn = (element: HTMLElement, props: object) => void | (() => void);
/**
 * @param {string} name
 * @param {() => Promise<{ mount: MountFn }>} loader
 */
export declare function register(name: string, loader: () => Promise<{
    mount: MountFn;
}>): void;
/** @param {Record<string, () => Promise<{ mount: MountFn }>>} entries */
export declare function registerAll(entries: Record<string, () => Promise<{
    mount: MountFn;
}>>): void;
/**
 * Bir alt ağaçtaki island'ları söker.
 *
 * Fragment takasında çağrılması zorunlu: `innerHTML` ile değiştirilen bir
 * bölgenin island'ları DOM'dan çıkar ama `document`/`window` üzerine
 * kurdukları dinleyiciler ve `setInterval`'ları yaşamaya devam eder. Birkaç
 * takastan sonra aynı olay birden fazla kez işlenmeye başlar.
 *
 * Sökülen element yeniden bağlanabilir hâle gelir: `mounted` kaydı da
 * temizlenir, böylece aynı düğüm tekrar DOM'a girerse `hydrate()` onu
 * yeniden görür.
 *
 * @param {ParentNode} [root] Kökün kendisi de island olabilir.
 */
export declare function unmount(root?: ParentNode): void;
/** @param {ParentNode} [root] */
export declare function hydrate(root?: ParentNode): void;
/** Sonradan DOM'a eklenen island'ları da yakalar (infinite scroll, portal). */
export declare function observeDocument(): MutationObserver;
export type DriveStartOptions = {
    /**
     * Takas edilecek bölge; CSS seçici (`#page-content`).
     */
    root: string;
};
export type StartOptions = {
    /**
     * Görünürlük gözlemcisinin önden yükleme
     * mesafesi; `IntersectionObserver` sözdizimi. Varsayılan `"200px 0px"`.
     * Yüzdeler viewport'a göredir: `"100% 0px"` island'ı bir ekran kala indirir.
     */
    rootMargin?: string;
    /**
     * Layout yerinde kalsın diye
     * aynı origin gezinmeyi `root` bölgesine sürer. `{ root: "#page-content" }`
     * ya da `"#page-content"`.
     */
    drive?: DriveStartOptions | string;
};
/**
 * @typedef {object} DriveStartOptions
 * @property {string} root Takas edilecek bölge; CSS seçici (`#page-content`).
 */
/**
 * @typedef {object} StartOptions
 * @property {string} [rootMargin] Görünürlük gözlemcisinin önden yükleme
 *   mesafesi; `IntersectionObserver` sözdizimi. Varsayılan `"200px 0px"`.
 *   Yüzdeler viewport'a göredir: `"100% 0px"` island'ı bir ekran kala indirir.
 * @property {DriveStartOptions | string} [drive] Layout yerinde kalsın diye
 *   aynı origin gezinmeyi `root` bölgesine sürer. `{ root: "#page-content" }`
 *   ya da `"#page-content"`.
 */
/** @param {StartOptions} [options] */
export declare function start(options?: StartOptions): void;
