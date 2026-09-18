/**
 * Bu yola trailing slash dayatılmamalı mı.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export declare function skipTrailingSlash(pathname: string): boolean;
/**
 * @returns {import('express').RequestHandler}
 */
export declare function trailingSlash(): import('express').RequestHandler;
