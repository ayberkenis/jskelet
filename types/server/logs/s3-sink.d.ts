import { putObject } from "./s3-put.js";
export type LogSink = import('./file-sink.js').LogSink;
export type AwsCredentials = import('./s3-put.js').AwsCredentials;
/**
 * @typedef {import('./file-sink.js').LogSink} LogSink
 * @typedef {import('./s3-put.js').AwsCredentials} AwsCredentials
 */
/**
 * @param {{ bucket: string, prefix: string, region: string,
 *   endpoint?: string | null, credentials: AwsCredentials,
 *   flushIntervalMs: number, maxBatch: number,
 *   put?: typeof putObject }} options
 * @returns {LogSink & { pendingCount: () => number }}
 */
export declare function createS3Sink(options: {
    bucket: string;
    prefix: string;
    region: string;
    endpoint?: string | null;
    credentials: AwsCredentials;
    flushIntervalMs: number;
    maxBatch: number;
    put?: typeof putObject;
}): LogSink & {
    pendingCount: () => number;
};
