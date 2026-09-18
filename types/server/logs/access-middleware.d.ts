/**
 * @param {{ basePath?: string }} [options]
 * @returns {import('express').RequestHandler}
 */
export declare function accessLogMiddleware(options?: {
    basePath?: string;
}): import('express').RequestHandler;
