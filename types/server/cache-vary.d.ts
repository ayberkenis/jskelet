/**
 * Public Host: `x-forwarded-host` (ilk değer) yoksa `Host`. Lowercase, portsuz.
 * IPv6 (`[::1]:3000`) köşeli parantezleri korur.
 *
 * @param {{ headers?: Record<string, unknown>, get?: (name: string) => string | undefined }} req
 * @returns {string}
 */
export declare function publicHost(req: {
    headers?: Record<string, unknown>;
    get?: (name: string) => string | undefined;
}): string;
/**
 * Anahtarın başına eklenen önek: `h=tr.example.com|` veya
 * `h=…&x-locale=tr|`. Vary yoksa boş string.
 *
 * @param {{ headers?: Record<string, unknown>, get?: (name: string) => string | undefined }} [req]
 * @returns {string}
 */
export declare function buildVaryPrefix(req?: {
    headers?: Record<string, unknown>;
    get?: (name: string) => string | undefined;
}): string;
/**
 * Anahtardan yol kısmını çıkarır (`[vary|]yol?query` → `yol`).
 * Invalidation hedefleri `/…` ile başlar; vary öneki eşleşmeye karışmamalı.
 *
 * @param {string} key
 * @returns {string}
 */
export declare function pathOfCacheKey(key: string): string;
