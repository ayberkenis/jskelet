/**
 * Küçük gövde düz `string` döner (çağıran senkron yazabilsin). Büyük gövde
 * brotli bitince çözülen bir Promise.
 *
 * @param {unknown} value
 * @returns {string | Buffer | Promise<string | Buffer> | null}
 */
export declare function encodeCacheValue(value: unknown): string | Buffer | Promise<string | Buffer> | null;
/**
 * Senkron çözücü — küçük test / senkron yollar için. Hot path
 * `decodeCacheValueAsync` kullanır (event loop'u brotli ile bloklamaz).
 *
 * @param {Buffer | string} raw
 * @returns {unknown}
 */
export declare function decodeCacheValue(raw: Buffer | string): unknown;
/**
 * @param {Buffer | string} raw
 * @returns {Promise<unknown>}
 */
export declare function decodeCacheValueAsync(raw: Buffer | string): Promise<unknown>;
