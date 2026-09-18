export declare const COOKIE_NAME = "jskelet_admin_sid";
/**
 * Aksiyon isteklerinde beklenen başlık. Tarayıcı bu başlığı çapraz site bir
 * formla gönderemez (preflight gerekir), yani panelin kendi CSRF freni.
 */
export declare const ACTION_HEADER = "x-jskelet-admin";
/** 32 haneli, süreç ömrü kadar geçerli şifre. */
export declare const PASSWORD: string;
/**
 * @param {import('express').Request} req
 * @param {string} name
 * @returns {string | null}
 */
export declare function readCookie(req: import('express').Request, name: string): string | null;
/**
 * Süresi geçmiş oturumları eler.
 */
export declare function pruneSessions(): void;
/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export declare function authenticated(req: import('express').Request): boolean;
/**
 * @param {string} password
 * @returns {boolean}
 */
export declare function passwordMatches(password: string): boolean;
/**
 * @param {number} sessionHours
 * @returns {{ token: string, maxAge: number }}
 */
export declare function createSession(sessionHours: number): {
    token: string;
    maxAge: number;
};
/**
 * @param {import('express').Request} req
 */
export declare function destroySession(req: import('express').Request): void;
/**
 * @param {string} basePath
 * @param {string} token
 * @param {number} maxAge
 * @returns {string}
 */
export declare function sessionCookie(basePath: string, token: string, maxAge: number): string;
/**
 * @param {string} basePath
 * @returns {string}
 */
export declare function clearSessionCookie(basePath: string): string;
