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
 * @returns {Promise<Buffer>}
 */
export declare function encodeText(text: string, encoding: "br" | "gzip"): Promise<Buffer>;
/**
 * @returns {import('express').RequestHandler}
 */
export declare function compression(): import('express').RequestHandler;
