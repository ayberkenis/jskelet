export { SHARED_COOKIE_WARN_BYTES, resolveSharedCookieDomain, stripHostPort, } from "../shared/cookie-domain.js";
/**
 * @param {string} name
 * @returns {string | null}
 */
export declare function readCookie(name: string): string | null;
export type ClientSharedCookieResult = {
    ok: boolean;
    domain: string | null;
    handoff: boolean;
    reason?: string;
};
/**
 * @typedef {object} ClientSharedCookieResult
 * @property {boolean} ok
 * @property {string | null} domain
 * @property {boolean} handoff
 * @property {string} [reason]
 */
/**
 * @param {string} name
 * @param {string} value
 * @param {{ roots?: string[], maxAge?: number, path?: string, sameSite?: string,
 *   secure?: boolean }} [options]
 * @returns {ClientSharedCookieResult}
 */
export declare function writeSharedCookie(name: string, value: string, options?: {
    roots?: string[];
    maxAge?: number;
    path?: string;
    sameSite?: string;
    secure?: boolean;
}): ClientSharedCookieResult;
/**
 * @param {string} name
 * @param {{ roots?: string[], path?: string, secure?: boolean, sameSite?: string }} [options]
 * @returns {ClientSharedCookieResult}
 */
export declare function clearSharedCookie(name: string, options?: {
    roots?: string[];
    path?: string;
    secure?: boolean;
    sameSite?: string;
}): ClientSharedCookieResult;
/**
 * Handoff bileti ister; dönen URL'ye gidilir (`?handoff=` taşır).
 *
 * @param {{ name: string, value: string, next: string }} body
 * @param {{ path?: string }} [options]
 * @returns {Promise<string | null>}
 */
export declare function createHandoffUrl(body: {
    name: string;
    value: string;
    next: string;
}, options?: {
    path?: string;
}): Promise<string | null>;
/**
 * first-party `window.name` köprüsü — cookie Domain reddedilince yedek.
 * Kaynak sayfada hedefe gitmeden önce çağırın; hedefte
 * `consumeWindowNameHandoff` okur.
 *
 * @param {string} targetUrl
 * @param {{ name: string, value: string, maxAge?: number }} cookie
 * @returns {void}
 */
export declare function handoffViaWindowName(targetUrl: string, cookie: {
    name: string;
    value: string;
    maxAge?: number;
}): void;
/**
 * Hedef host'ta `window.name` içindeki handoff'u host-only cookie olarak yazar.
 *
 * @param {{ write?: typeof writeSharedCookie }} [options]
 *   Varsayılan: Domain denemeden host-only `document.cookie`.
 * @returns {boolean} Bir şey yazıldı mı.
 */
export declare function consumeWindowNameHandoff(options?: {
    write?: typeof writeSharedCookie;
}): boolean;
