export type LogEntry = {
    kind: string;
    id: number;
    at: number;
    [key: string]: unknown;
};
/**
 * @param {{ basePath: string, logSize: number, prewarmUserAgent?: string }} options
 */
export declare function configureEventLog(options: {
    basePath: string;
    logSize: number;
    prewarmUserAgent?: string;
}): void;
/**
 * @param {Omit<LogEntry, "id" | "at"> & { kind: string }} partial
 * @returns {LogEntry}
 */
export declare function push(partial: Omit<LogEntry, "id" | "at"> & {
    kind: string;
}): LogEntry;
/**
 * @param {number} [afterId]
 * @param {number} [limit]
 * @returns {LogEntry[]}
 */
export declare function list(afterId?: number, limit?: number): LogEntry[];
/**
 * @param {(entry: LogEntry) => void} listener
 * @returns {() => void}
 */
export declare function subscribeLive(listener: (entry: LogEntry) => void): () => void;
/**
 * HTTP yanıt bitiminde ring'e yazar. Admin yolları ve prewarm UA atlanır.
 *
 * @returns {import('express').RequestHandler}
 */
export declare function requestLogMiddleware(): import('express').RequestHandler;
