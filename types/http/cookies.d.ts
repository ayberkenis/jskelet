/**
 * Sabit zamanlı karşılaştırma: imza doğrulamasında erken çıkış, saldırganın
 * baytları tek tek tahmin etmesine kapı aralar.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export declare function safeEqual(a: string, b: string): boolean;
/**
 * `Cookie` başlığını ayrıştırır.
 *
 * Okuma çıktının kullanıcıya bağlı olduğunu bildirir: bu sayfa artık public
 * HTML cache'ine yazılamaz.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Record<string, string>}
 */
export declare function parseCookies(req: import('http').IncomingMessage): Record<string, string>;
export type CookieOptions = {
    /**
     * Varsayılan `/`.
     */
    path?: string;
    domain?: string;
    /**
     * Saniye.
     */
    maxAge?: number;
    expires?: Date;
    /**
     * Varsayılan `true`.
     */
    httpOnly?: boolean;
    /**
     * Varsayılan: development dışında `true`.
     * `writeSharedCookie` protokole bakarak ezer (`https` → Secure).
     */
    secure?: boolean;
    /**
     * Varsayılan `Lax`.
     */
    sameSite?: "Strict" | "Lax" | "None";
};
/**
 * @typedef {object} CookieOptions
 * @property {string} [path] Varsayılan `/`.
 * @property {string} [domain]
 * @property {number} [maxAge] Saniye.
 * @property {Date} [expires]
 * @property {boolean} [httpOnly] Varsayılan `true`.
 * @property {boolean} [secure] Varsayılan: development dışında `true`.
 *   `writeSharedCookie` protokole bakarak ezer (`https` → Secure).
 * @property {"Strict" | "Lax" | "None"} [sameSite] Varsayılan `Lax`.
 */
/**
 * RFC 6265 cookie-name (token). `;`, boşluk, CRLF gibi karakterler
 * Set-Cookie enjeksiyonuna yol açardı — reddedilir.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export declare function isValidCookieName(name: unknown): boolean;
/**
 * Varsayılanlar bilinçli olarak kısıtlayıcı: `HttpOnly` ile JS okuyamaz,
 * `SameSite=Lax` ile çapraz site POST'larında gönderilmez (CSRF'nin büyük
 * kısmını kapatan tek satır), `Secure` üretimde açık.
 *
 * @param {string} name
 * @param {string} value
 * @param {CookieOptions} [options]
 * @returns {string}
 */
export declare function serializeCookie(name: string, value: string, options?: CookieOptions): string;
/**
 * @param {import('http').ServerResponse} res
 * @param {string} name
 * @param {string} value
 * @param {CookieOptions} [options]
 */
export declare function setCookie(res: import('http').ServerResponse, name: string, value: string, options?: CookieOptions): void;
/**
 * @param {import('http').ServerResponse} res
 * @param {string} name
 * @param {CookieOptions} [options]
 */
export declare function clearCookie(res: import('http').ServerResponse, name: string, options?: CookieOptions): void;
/**
 * İmzalı cookie yazar. Değer okunabilir kalır (şifreleme değil, imza);
 * gizli kalması gereken veriyi cookie'ye koymayın, kimliğini koyun.
 *
 * @param {import('http').ServerResponse} res
 * @param {string} name
 * @param {string} value
 * @param {CookieOptions} [options]
 */
export declare function setSignedCookie(res: import('http').ServerResponse, name: string, value: string, options?: CookieOptions): void;
/**
 * İmzalı cookie okur. İmza uymuyorsa `null` — bozuk imza, yok sayılmalı,
 * "belki geçerlidir" diye kullanılmamalı.
 *
 * @param {import('http').IncomingMessage} req
 * @param {string} name
 * @returns {string | null}
 */
export declare function getSignedCookie(req: import('http').IncomingMessage, name: string): string | null;
/**
 * Kriptografik rastgele token. CSRF token'ı ve oturum kimliği için.
 *
 * @param {number} [bytes]
 * @returns {string}
 */
export declare function randomToken(bytes?: number): string;
