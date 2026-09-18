/**
 * @param {Record<string, any>} body
 * @param {import('express').Request} req
 * @returns {Promise<{ ok: boolean, code?: string,
 *   params?: Record<string, string | number>,
 *   parts?: ({ code: string, params?: Record<string, string | number> } | null)[] }>}
 */
export declare function runAction(body: Record<string, any>, req: import('express').Request): Promise<{
    ok: boolean;
    code?: string;
    params?: Record<string, string | number>;
    parts?: ({
        code: string;
        params?: Record<string, string | number>;
    } | null)[];
}>;
