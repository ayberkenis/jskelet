/**
 * Express router stack'ini dolaşır. İç API kırılgan; yalnızca gözlem için.
 *
 * @param {import('express').Express} app
 * @returns {{ method: string, path: string }[]}
 */
export declare function listExpressRoutes(app: import('express').Express): {
    method: string;
    path: string;
}[];
/**
 * `routes/` altındaki (veya config.routes listesindeki) modül dosyaları.
 *
 * @returns {{ file: string, relative: string }[]}
 */
export declare function listRouteModules(): {
    file: string;
    relative: string;
}[];
/**
 * `views/` altındaki şablon ve bileşen dosyaları.
 *
 * @returns {{ relative: string, kind: "ejs" | "js" | "other" }[]}
 */
export declare function listViews(): {
    relative: string;
    kind: "ejs" | "js" | "other";
}[];
/**
 * Son HTTP log'larından path başına özet.
 *
 * @returns {Record<string, { status: number, ms: number, cache: string | null, at: number, count: number }>}
 */
export declare function routeActivity(): Record<string, {
    status: number;
    ms: number;
    cache: string | null;
    at: number;
    count: number;
}>;
