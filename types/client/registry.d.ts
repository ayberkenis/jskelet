/**
 * Island registry.
 *
 * Sunucu HTML'i tamdır; JS yalnızca davranış ekler. Bir element
 * `data-island="ad"` taşıdığında ilgili modül dinamik import edilir ve
 * `mount(element, props)` çağrılır.
 *
 * Hidrasyon **varsayılan olarak görünürlüğe bağlıdır**: her island bir
 * IntersectionObserver'a verilir, ekranda olanlar zaten ilk gözlemde tetiklenir,
 * ekran dışındakiler kaydırılana kadar hiç indirilmez. Ana sayfadaki grafik
 * kütüphanesi gibi ağır modüller böylece ilk yükten tamamen çıkar.
 *
 * `data-island-eager` görünürlükten bağımsız, hemen bağlanmayı zorlar
 * (header, çerez bandı gibi global davranışlar için).
 *
 * `data-island-idle` görünür olsa bile sayfa sakinleşene (load + boş zaman)
 * kadar bekletir. İlk ekranda görünen ama kritik olmayan ağır modüller
 * (ör. grafik kütüphanesi çeken mini grafik) LCP ile yarışmasın diye.
 *
 * `data-island-props` JSON ise parse edilip props olarak geçer.
 */
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
export declare function start(): void;
