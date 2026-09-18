export type PageReport = {
    url: string;
    title: string | null;
    at: number;
    visits: number;
    metrics: Record<string, number | null>;
    resources: {
        count: number;
        bytes: number;
        byType: Record<string, {
            count: number;
            bytes: number;
        }>;
    };
    islands: {
        total: number;
        ready: number;
        names: string[];
    };
    api: {
        url: string;
        ms: number;
        status: number;
        bytes: number;
        initiator: string;
    }[];
    html: {
        bytes: number | null;
        cache: string | null;
        ms: number | null;
    };
};
/** Tarayıcıdan gelen ölçüm paketini saklar. En yeni paket öncekini ezer. */
export declare function recordPageReport(payload: any): void;
/** Ölçümler tarayıcı sekmesinde değil sunucuda durur; sıfırlama da buradan. */
export declare function clearPageReports(): void;
export type ServerApiCall = {
    url: string;
    host: string;
    method: string;
    status: number;
    ms: number;
    bytes: number;
    at: number;
    error: string | null;
    page: string | null;
    details: unknown;
};
export type ApiFailure = {
    url: string;
    method: string;
    status: number;
    ms: number;
    bytes: number;
    error: string | null;
    page: string | null;
    details: unknown;
};
/**
 * @typedef {{
 *   url: string,
 *   method: string,
 *   status: number,
 *   ms: number,
 *   bytes: number,
 *   error: string | null,
 *   page: string | null,
 *   details: unknown,
 * }} ApiFailure
 */
/**
 * SSR sırasında yapılan dış çağrıları ölçer. `globalThis.fetch` sarılır;
 * yalnızca dev'de çağrıldığı için üretim yolu dokunulmaz kalır.
 *
 * Başarısız cevaplar (4xx/5xx ya da ağ) isteğe bağlı `onFailure` ile
 * overlay hata günlüğüne de düşer — uygulama kendi logger'ıyla stderr'e
 * yazsa bile panel "hangi sayfa hangi API" bilgisini görsün.
 *
 * @param {{ onFailure?: (call: ApiFailure) => void }} [options]
 */
export declare function trackServerFetch(options?: {
    onFailure?: (call: ApiFailure) => void;
}): void;
/**
 * Rapor sayfasının tek veri kaynağı.
 * @param {{ requests: object[], errors: object[] }} devtools
 */
export declare function buildReport(devtools: {
    requests: object[];
    errors: object[];
}): {
    generatedAt: number;
    process: {
        pid: number;
        node: string;
        uptime: number;
        memory: {
            rss: number;
            heapUsed: number;
        };
        env: string;
    };
    pages: {
        url: string;
        title: string | null;
        at: number;
        visits: number;
        metrics: Record<string, number | null>;
        resources: {
            count: number;
            bytes: number;
            byType: Record<string, {
                count: number;
                bytes: number;
            }>;
        };
        islands: {
            total: number;
            ready: number;
            names: string[];
        };
        api: {
            url: string;
            ms: number;
            status: number;
            bytes: number;
            initiator: string;
        }[];
        html: {
            bytes: number | null;
            cache: string | null;
            ms: number | null;
        };
    }[];
    serverApi: ServerApiCall[];
    build: {
        available: boolean;
        outputs: {
            file: string;
            entry: any;
            isChunk: boolean;
            bytes: any;
            gzip: number | null;
            brotli: number | null;
            imports: any;
            inputs: {
                source: string;
                bytes: any;
            }[];
            inputCount: number;
        }[];
        groups: {
            name: string;
            bytes: number;
        }[];
        assets: {
            name: string;
            url: string;
            kind: string;
            bytes: number | null;
            gzip: number | null;
            brotli: number | null;
        }[];
    };
    cache: {
        size: number;
        entries: {
            key: string;
            bytes: number;
            status: number;
            stale: boolean;
            expiresIn: number;
            encodings: string[];
            deps: number;
        }[];
        data: number;
        dataStats: {
            hits: number;
            stale: number;
            misses: number;
            coalesced: number;
            shared: number;
            produced: number;
            bypassed: number;
        } & {
            reads: number;
            hitRatio: number;
        };
        redis: {
            enabled: boolean;
            connected: boolean;
            keyPrefix: string;
            buildId: string;
            errors: number;
            bypassed: boolean;
        };
    };
    upstream: {
        host: string;
        rate: number;
        maxRate: number;
        concurrency: number;
        active: number;
        throttled: number;
        rejected: number;
        bypassed: boolean;
        blockedMs: number;
        bypassedMs: number;
    }[];
    prewarm: {
        active: boolean;
        done: number;
        total: number;
        ok: number;
        failed: number;
        startedAt: number | null;
        finishedAt: number | null;
        entries: {
            path: string;
            status: number;
            ms: number;
            bytes: number;
            cache: string | null;
            error: string | null;
        }[];
    };
    requests: object[];
    errors: object[];
};
