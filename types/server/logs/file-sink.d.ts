export type LogSink = {
    write: (entry: Record<string, unknown>) => Promise<void>;
    flush: () => Promise<void>;
    close: () => Promise<void>;
};
/**
 * @typedef {{ write: (entry: Record<string, unknown>) => Promise<void>,
 *   flush: () => Promise<void>, close: () => Promise<void> }} LogSink
 */
/**
 * @param {{ root: string, dir: string }} options
 * @returns {LogSink}
 */
export declare function createFileSink(options: {
    root: string;
    dir: string;
}): LogSink;
