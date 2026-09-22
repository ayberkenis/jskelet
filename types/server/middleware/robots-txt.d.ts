/**
 * @param {string} [brandName]
 * @returns {string}
 */
export declare function frameworkRobotsNote(brandName?: string): string;
/**
 * `robots.txt`'e yazılacak `Disallow` yolları.
 *
 * Üç önek her zaman vardır. Panel, uzak görsel ve handoff yalnızca
 * gerçekten mount edildiklerinde ve öneklerin dışına taşındıklarında eklenir.
 * Dev araçlarının özel yolu yalnızca development'ta yazılır: production'da
 * o yol uygulamanın kendi sayfası olabilir.
 *
 * @param {object} [config]
 * @param {{ dev?: boolean }} [options]
 * @returns {string[]}
 */
export declare function frameworkDisallowPaths(config?: object, options?: {
    dev?: boolean;
}): string[];
/**
 * @param {string} body
 * @param {{ brandName?: string, paths: string[] }} options
 * @returns {string}
 */
export declare function appendFrameworkRobots(body: string, options: {
    brandName?: string;
    paths: string[];
}): string;
/**
 * @returns {import('express').RequestHandler}
 */
export declare function robotsTxtMiddleware(): import('express').RequestHandler;
