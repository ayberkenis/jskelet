/**
 * Metin içeriği ve attribute değerleri için kaçış.
 * @param {unknown} value
 * @returns {string}
 */
export declare function esc(value: unknown): string;
/**
 * `<script type="application/ld+json">` gövdesi için güvenli JSON.
 * `</script`, `<!--` ve U+2028/2029 kaçırılır.
 * @param {unknown} value
 * @returns {string}
 */
export declare function jsonScript(value: unknown): string;
/**
 * Attribute nesnesini string'e çevirir. `false`/`null`/`undefined` atlanır,
 * `true` boolean attribute olarak yazılır.
 * @param {Record<string, unknown>} attrs
 * @returns {string}
 */
export declare function attrs(attrs: Record<string, unknown>): string;
/**
 * `clsx` karşılığı — koşullu sınıf birleştirme, çakışma çözümü yok.
 * @param {...unknown} inputs
 * @returns {string}
 */
export declare function cx(...inputs: unknown[]): string;
/**
 * `lib/ui/cn.js` ile aynı davranış: birleştir, sonra Tailwind çakışmalarını çöz.
 *
 * `tailwind-merge` çalışma zamanı bağımlılığı olarak korunur çünkü sınıf
 * hesabı **yalnızca sunucuda** yapılır — client bundle'a hiç girmez, dolayısıyla
 * sayfa ağırlığına etkisi yoktur. Elle yazılmış bir grup tablosu ise
 * `border-2` + `border-transparent` gibi genişlik/renk çiftlerini birbirine
 * karıştırıp sınıf düşürdüğü için görsel regresyon üretiyordu.
 *
 * @param {...unknown} inputs
 * @returns {string}
 */
export declare function cn(...inputs: unknown[]): string;
