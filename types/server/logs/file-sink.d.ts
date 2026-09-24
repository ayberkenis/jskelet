export type LogChunk = {
    body: Buffer;
    encoding: "zstd";
    bytes: number;
    lines: number;
    at: number;
};
export type LogSink = {
    write: (entry: Record<string, unknown>) => Promise<void>;
    flush: () => Promise<void>;
    close: () => Promise<void>;
};
export type DrainLog = (chunk: LogChunk) => void | Promise<void>;
/** Diskteki parçaların ömrü. Config yükseltemez. */
export declare const FILE_LOG_RETENTION_MS: number;
/**
 * @param {{ root: string, dir: string, persist?: boolean,
 *   retentionMs?: number, drainLog?: DrainLog | null }} options
 *   `persist: false` diske yazmaz; yalnız `drainLog` çağrılır.
 * @returns {LogSink}
 */
export declare function createFileSink(options: {
    root: string;
    dir: string;
    persist?: boolean;
    retentionMs?: number;
    drainLog?: DrainLog | null;
}): LogSink;
