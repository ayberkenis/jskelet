/**
 * S3 batch sink — satırları biriktirir, aralık / maxBatch ile PutObject atar.
 *
 * Başarısız bir yükleme süreci düşürmez: bir kez uyarır, batch'i bırakır.
 * Backpressure için yeniden kuyruk yok — log kaybı, belleğin şişmesinden
 * tercih edilir.
 */
import os from "node:os";
import process from "node:process";
import { putObject } from "./s3-put.js";

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
export function createS3Sink(options) {
  /** @type {string[]} */
  let buffer = [];
  let seq = 0;
  let warned = false;
  /** @type {Promise<void>} */
  let chain = Promise.resolve();
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;

  const put = options.put ?? putObject;
  const host = os.hostname().replace(/[^a-zA-Z0-9._-]/g, "-") || "host";
  const prefix = options.prefix.endsWith("/")
    ? options.prefix
    : `${options.prefix}/`;

  /**
   * @param {Date} [date]
   * @returns {string}
   */
  function objectKey(date = new Date()) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    const iso = date.toISOString().replace(/[:.]/g, "-");
    seq += 1;
    return `${prefix}${y}/${m}/${d}/${host}-${process.pid}-${iso}-${seq}.ndjson`;
  }

  /**
   * @param {string} message
   * @param {unknown} [error]
   */
  function warnOnce(message, error) {
    if (warned) return;
    warned = true;
    console.warn(`[logs] ${message}`, error ?? "");
  }

  async function flushNow() {
    if (!buffer.length) return;
    const lines = buffer;
    buffer = [];
    const body = `${lines.join("\n")}\n`;
    try {
      await put({
        bucket: options.bucket,
        key: objectKey(),
        body,
        region: options.region,
        endpoint: options.endpoint ?? null,
        credentials: options.credentials,
      });
    } catch (error) {
      warnOnce("S3 PutObject failed; dropping batch", error);
    }
  }

  /** Flush'ları sıraya dizer — iki timer çakışmasın. */
  function enqueueFlush() {
    chain = chain.then(flushNow).catch(() => {});
    return chain;
  }

  timer = setInterval(() => {
    void enqueueFlush();
  }, options.flushIntervalMs);
  timer.unref?.();

  return {
    pendingCount() {
      return buffer.length;
    },
    async write(entry) {
      buffer.push(JSON.stringify(entry));
      if (buffer.length >= options.maxBatch) await enqueueFlush();
    },
    async flush() {
      await enqueueFlush();
    },
    async close() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      await enqueueFlush();
    },
  };
}
