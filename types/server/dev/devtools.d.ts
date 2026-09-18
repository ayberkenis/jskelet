export type ServerError = {
    id: number;
    level: string;
    message: string;
    stack: string | null;
    url: string | null;
    page: string | null;
    island: string | null;
    details: unknown;
    at: number;
};
/**
 * @param {string} level
 * @param {string} message
 * @param {{
 *   stack?: string | null,
 *   url?: string | null,
 *   page?: string | null,
 *   island?: string | null,
 *   details?: unknown,
 * }} [extra]
 */
export declare function recordServerError(level: string, message: string, extra?: {
    stack?: string | null;
    url?: string | null;
    page?: string | null;
    island?: string | null;
    details?: unknown;
}): void;
/**
 * Dev araçlarını uygulamaya bağlar.
 * @param {import('express').Express} app
 */
export declare function mountDevtools(app: import('express').Express): void;
/**
 * Canlı kanalı HTTP sunucusuna bağlar.
 *
 * Express uygulamasına takılamıyor: WebSocket el sıkışması `upgrade` olayında
 * geçiyor ve o olay middleware zincirine hiç uğramıyor. Bu yüzden `listen`
 * sonrası ayrı bir adım.
 *
 * @param {import('node:http').Server} server
 */
export declare function attachDevSocket(server: import('node:http').Server): void;
