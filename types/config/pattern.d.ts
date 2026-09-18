/**
 * `next.config` `source`/`destination` sözdiziminin küçük bir derleyicisi.
 *
 * Desteklenen biçimler:
 *   `/haber/:slug`      → tek segment yakalar
 *   `/:path*`           → sıfır veya daha fazla segment yakalar
 *   `/:path*.svg`       → joker + sabit son ek (uzantı kuralları böyle yazılır)
 *   `/etiket-:slug`     → segment ortasında parametre
 *
 * Yakalanan değerler `destination` içindeki aynı adlı `:param`'lara yazılır.
 * Next'in tam `path-to-regexp` yüzeyi değil; config'te fiilen kullanılan alt
 * küme bilinçli olarak seçildi ve tanınmayan bir sözdizimi sessizce literal
 * kabul edilmez, uyarı üretir.
 */
export type CompiledPattern = {
    regex: RegExp;
    keys: string[];
    source: string;
};
/**
 * @param {string} source
 * @returns {CompiledPattern | null}
 */
export declare function compilePattern(source: string): CompiledPattern | null;
/**
 * @param {CompiledPattern} compiled
 * @param {string} pathname
 * @returns {Record<string, string> | null}
 */
export declare function matchPattern(compiled: CompiledPattern, pathname: string): Record<string, string> | null;
/**
 * `destination` içindeki `:param` yer tutucularını doldurur.
 *
 * @param {string} destination
 * @param {Record<string, string>} params
 * @returns {string}
 */
export declare function fillDestination(destination: string, params: Record<string, string>): string;
