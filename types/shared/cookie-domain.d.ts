/**
 * Paylaşımlı cookie Domain seçimi — sunucu ve istemci aynı kuralları kullanır.
 *
 * `brand.sharedCookieRoots` örn. `[".investvio.com", ".localhost"]`.
 * Host bu köklerden birine uyuyorsa Domain olarak o kök yazılır.
 */
/**
 * @param {string} host Host veya Host:port.
 * @returns {string} Lowercase, portsuz.
 */
export declare function stripHostPort(host: string): string;
/**
 * Kökü `Domain=` biçimine getirir (başında nokta).
 *
 * @param {unknown} root
 * @returns {string | null}
 */
export declare function normalizeCookieRoot(root: unknown): string | null;
/**
 * @param {string} hostname Portsuz hostname.
 * @param {Iterable<string>} roots `brand.sharedCookieRoots`.
 * @returns {string | null} `Domain` değeri (başında nokta) ya da eşleşme yoksa null.
 */
export declare function resolveSharedCookieDomain(hostname: string, roots: Iterable<string>): string | null;
/**
 * Paylaşımlı cookie için önerilen üst sınır. JWT / büyük token buraya
 * sığmaz — kısa session id koyun; aksi halde handoff veya host-only cookie.
 */
export declare const SHARED_COOKIE_WARN_BYTES = 512;
