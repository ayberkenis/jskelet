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
     * Yazılacak bölge; varsayılan `"body"`.
     */
    root?: string;
};
export type StartOptions = {
    /**
     * Görünürlük gözlemcisinin önden yükleme
     * mesafesi; `IntersectionObserver` sözdizimi. Varsayılan `"200px 0px"`.
     * Yüzdeler viewport'a göredir: `"100% 0px"` island'ı bir ekran kala indirir.
     */
    rootMargin?: string;
    /**
     * Stimulus/Turbo tarzı
     * belge ziyareti. `true` → `body`. `data-permanent` + `id` host'lar sökülmez.
     */
    drive?: true | DriveStartOptions | string;
};
/**
 * @typedef {object} DriveStartOptions
 * @property {string} [root] Yazılacak bölge; varsayılan `"body"`.
 */
/**
 * @typedef {object} StartOptions
 * @property {string} [rootMargin] Görünürlük gözlemcisinin önden yükleme
 *   mesafesi; `IntersectionObserver` sözdizimi. Varsayılan `"200px 0px"`.
 *   Yüzdeler viewport'a göredir: `"100% 0px"` island'ı bir ekran kala indirir.
 * @property {true | DriveStartOptions | string} [drive] Stimulus/Turbo tarzı
 *   belge ziyareti. `true` → `body`. `data-permanent` + `id` host'lar sökülmez.
 */
/** @param {StartOptions} [options] */
export declare function start(options?: StartOptions): void;
