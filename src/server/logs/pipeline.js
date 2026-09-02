/**
 * Structured log pipeline: `log.subscribe` → kinds filtresi → file / S3.
 *
 * Sink yokken abone olunmaz: `emitLog` boş Set üzerinde döner ve stdout
 * yoluna maliyet eklemez. Credential eksikse S3 açılmaz, site ayağa kalkar.
 */
import process from "node:process";
import * as log from "../../log.mjs";
import { createFileSink } from "./file-sink.js";
import { createS3Sink } from "./s3-sink.js";

/**
 * @typedef {import('../../config/index.js').LogsConfig} LogsConfig
 * @typedef {import('../../config/index.js').ResolvedConfig} ResolvedConfig
 * @typedef {import('./file-sink.js').LogSink} LogSink
 */

/** @type {(() => void) | null} */
let unsubscribe = null;
/** @type {LogSink[]} */
let sinks = [];
/** @type {Set<string>} */
let kindSet = new Set();
let accessMounted = false;

/**
 * @returns {import('./s3-put.js').AwsCredentials | null}
 */
function readCredentials() {
  const accessKeyId = process.env.JSKELET_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.JSKELET_S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.JSKELET_S3_SESSION_TOKEN || null,
  };
}

/**
 * Access middleware mount edilmeli mi?
 *
 * Dev'de yalnızca console isteniyorsa mount edilmez — HTML satırlarını
 * zaten devtools basıyor; çift kayıt olmasın. Sink açıksa ya da production
 * console access log istiyorsa mount edilir.
 *
 * @param {LogsConfig} logs
 * @returns {boolean}
 */
export function shouldMountAccessLog(logs) {
  if (!logs.kinds.includes("http")) return false;
  if (logs.file.enabled || logs.s3.enabled) return true;
  return logs.console && process.env.NODE_ENV !== "development";
}

/**
 * @param {ResolvedConfig} config
 * @returns {Promise<{ accessLog: boolean }>}
 */
export async function configureLogs(config) {
  await closeLogs();

  const logs = config.logs;
  kindSet = new Set(logs.kinds);
  accessMounted = shouldMountAccessLog(logs);

  log.configureLog({
    console: logs.console,
    // Access middleware HTTP'yi kendisi pipeline'a yazar; log.http yalnızca
    // stdout için kalsın — aksi hâlde HTML istekleri (devtools) çiftlenir.
    emitHttp: !accessMounted,
  });

  /** @type {LogSink[]} */
  const next = [];

  if (logs.file.enabled) {
    next.push(createFileSink({ root: config.root, dir: logs.file.dir }));
  }

  if (logs.s3.enabled) {
    const credentials = readCredentials();
    if (!logs.s3.bucket) {
      console.warn(
        "[logs] s3.enabled but no bucket (set JSKELET_LOG_BUCKET or logs.s3.bucket)",
      );
    } else if (!logs.s3.region) {
      console.warn(
        "[logs] s3.enabled but no region (set JSKELET_S3_REGION or logs.s3.region)",
      );
    } else if (!credentials) {
      console.warn(
        "[logs] s3.enabled but JSKELET_S3_ACCESS_KEY_ID / JSKELET_S3_SECRET_ACCESS_KEY missing — S3 sink disabled",
      );
    } else {
      next.push(
        createS3Sink({
          bucket: logs.s3.bucket,
          prefix: logs.s3.prefix,
          region: logs.s3.region,
          endpoint: logs.s3.endpoint,
          credentials,
          flushIntervalMs: logs.s3.flushIntervalMs,
          maxBatch: logs.s3.maxBatch,
        }),
      );
    }
  }

  sinks = next;

  if (sinks.length) {
    unsubscribe = log.subscribe((raw) => {
      acceptLogEntry(raw);
    });
  }

  return { accessLog: accessMounted };
}

/**
 * Access middleware ve `log.subscribe` ortak giriş noktası.
 *
 * @param {Record<string, unknown>} raw
 */
export function acceptLogEntry(raw) {
  if (!sinks.length) return;

  const kind = typeof raw.kind === "string" ? raw.kind : "event";
  if (!kindSet.has(kind)) return;

  const entry = {
    ...raw,
    kind,
    at: typeof raw.at === "number" ? raw.at : Date.now(),
  };

  for (const sink of sinks) {
    void sink.write(entry).catch((error) => {
      console.warn("[logs] sink write failed", error);
    });
  }
}

/**
 * Kapanışta buffer'ları boşaltır.
 *
 * @returns {Promise<void>}
 */
export async function flushLogs() {
  await Promise.all(sinks.map((sink) => sink.flush()));
}

/**
 * @returns {Promise<void>}
 */
export async function closeLogs() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  const closing = sinks;
  sinks = [];
  await Promise.all(closing.map((sink) => sink.close()));
  kindSet = new Set();
  accessMounted = false;
  log.configureLog({ console: true, emitHttp: true });
}
