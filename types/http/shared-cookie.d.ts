export { SHARED_COOKIE_WARN_BYTES, resolveSharedCookieDomain, stripHostPort, } from "../shared/cookie-domain.js";
/**
 * @param {{ secure?: boolean, protocol?: string,
 *   headers?: Record<string, unknown>, get?: (name: string) => string | undefined }} [req]
 * @returns {boolean}
 */
export declare function requestIsHttps(req?: {
    secure?: boolean;
    protocol?: string;
    headers?: Record<string, unknown>;
    get?: (name: string) => string | undefined;
}): boolean;
export type CookieOptions = import('./cookies.js').CookieOptions;
export type SharedCookieResult = {
    /**
     * Domain seçildi ve Set-Cookie yazıldı.
     */
    ok: boolean;
    /**
     * Yazılan Domain ya da null.
     */
    domain: string | null;
    /**
     * ok değilse çağıran handoff denemeli.
     */
    handoff: boolean;
    /**
     * Teşhis.
     */
    reason?: string;
};
/**
 * @typedef {import('./cookies.js').CookieOptions} CookieOptions
 *
 * @typedef {object} SharedCookieResult
 * @property {boolean} ok Domain seçildi ve Set-Cookie yazıldı.
 * @property {string | null} domain Yazılan Domain ya da null.
 * @property {boolean} handoff ok değilse çağıran handoff denemeli.
 * @property {string} [reason] Teşhis.
 */
/**
 * Paylaşımlı Domain ile cookie yazar.
 *
 * @param {import('http').ServerResponse & { req?: import('http').IncomingMessage }} res
 * @param {string} name
 * @param {string} value Kısa session id — JWT değil.
 * @param {CookieOptions & { req?: import('http').IncomingMessage, roots?: string[],
 *   host?: string }} [options]
 * @returns {SharedCookieResult}
 */
export declare function writeSharedCookie(res: import('http').ServerResponse & {
    req?: import('http').IncomingMessage;
}, name: string, value: string, options?: CookieOptions & {
    req?: import('http').IncomingMessage;
    roots?: string[];
    host?: string;
}): SharedCookieResult;
/**
 * Aynı Domain ile cookie siler.
 *
 * @param {import('http').ServerResponse & { req?: import('http').IncomingMessage }} res
 * @param {string} name
 * @param {CookieOptions & { req?: import('http').IncomingMessage, roots?: string[],
 *   host?: string }} [options]
 * @returns {SharedCookieResult}
 */
export declare function clearSharedCookie(res: import('http').ServerResponse & {
    req?: import('http').IncomingMessage;
}, name: string, options?: CookieOptions & {
    req?: import('http').IncomingMessage;
    roots?: string[];
    host?: string;
}): SharedCookieResult;
