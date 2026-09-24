/**
 * Küçük gövde düz `string` döner (çağıran senkron yazabilsin). Büyük gövde
 * brotli bitince çözülen bir Promise.
 *
 * @param {unknown} value
 * @returns {string | Buffer | Promise<string | Buffer> | null}
 */
export declare function encodeCacheValue(value: unknown): string | Buffer | Promise<string | Buffer> | null;
/**
 * @param {Buffer | string} raw
 * @returns {unknown}
 */
export declare function decodeCacheValue(raw: Buffer | string): unknown;
