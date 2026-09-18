/**
 * @param {import('express').Request} req
 * @returns {string}
 */
export declare function clientKey(req: import('express').Request): string;
/**
 * @param {string} ua
 * @returns {boolean}
 */
export declare function looksLikeBot(ua: string): boolean;
/**
 * Exact IP veya CIDR (`10.0.0.0/8`). IPv6 için yalnızca exact eşleşme.
 *
 * @param {string} ip
 * @param {string[]} allowIps
 * @returns {boolean}
 */
export declare function ipAllowed(ip: string, allowIps: string[]): boolean;
/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export declare function banned(req: import('express').Request): boolean;
/**
 * @param {import('express').Request} req
 * @param {string} reason
 * @param {{ banAttempts: number, banHours: number }} settings
 */
export declare function noteFailure(req: import('express').Request, reason: string, settings: {
    banAttempts: number;
    banHours: number;
}): void;
/**
 * @param {import('express').Request} req
 */
export declare function clearOffender(req: import('express').Request): void;
/**
 * Kapı middleware'i: ban → IP → bot. Hepsi 404.
 *
 * @param {() => typeof import('../../config/defaults.js').DEFAULT_ADMIN} getSettings
 * @returns {import('express').RequestHandler}
 */
export declare function gateMiddleware(getSettings: () => typeof import('../../config/defaults.js').DEFAULT_ADMIN): import('express').RequestHandler;
