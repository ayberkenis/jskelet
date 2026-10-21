/**
 * İçeriği bir kez sıkıştırıp saklamak isteyen çağıranlar için (HTML cache).
 *
 * @param {string | undefined} acceptEncoding
 * @returns {"br" | "gzip" | null}
 */
export declare function negotiateEncoding(acceptEncoding: string | undefined): "br" | "gzip" | null;
/**
 * @param {string} text
 * @param {"br" | "gzip"} encoding
 * @param {{ stored?: boolean }} [options] `stored: false` → gövde saklanmayacak,
 *   istek başına daha ucuz brotli kalitesi kullanılır. Varsayılan saklanan.
 * @returns {Promise<Buffer>}
 */
export declare function encodeText(text: string, encoding: "br" | "gzip", options?: {
    stored?: boolean;
}): Promise<Buffer>;
/**
 * @returns {import('express').RequestHandler}
 */
export declare function compression(): import('express').RequestHandler;
