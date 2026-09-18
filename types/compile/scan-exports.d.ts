/**
 * Kaynak metinden named export adlarını çıkarır — modülü çalıştırmadan.
 * Compile-time bilinen bileşen listesi için; `default` yok sayılır.
 */
/**
 * @param {string} source
 * @returns {string[]}
 */
export declare function scanNamedExports(source: string): string[];
