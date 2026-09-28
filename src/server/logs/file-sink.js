/**
 * Kısa ömürlü dosya logu.
 *
 * Satırlar ~1 sn veya 32 satırda bir zstd NDJSON parçası olur. Diskte en
 * fazla 5 dakika kalır; süresi dolan en eski parça silinir. `drainLog`
 * her mühürlenen parçayı alır — hook hata verse de site düşmez, dosya
 * süresi dolana kadar durur.
 *
 * Yol `path.resolve(root, dir)` ile bulunur. `getConfig().dirs` şişirilmez;
 * log dizini opsiyoneldir ve çoğu kurulumda hiç açılmaz.
 */
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

/**
 * @typedef {{ body: Buffer, encoding: "zstd", bytes: number, lines: number,
 *   at: number }} LogChunk
 * @typedef {{ write: (entry: Record<string, unknown>) => Promise<void>,
 *   flush: () => Promise<void>, close: () => Promise<void> }} LogSink
 * @typedef {(chunk: LogChunk) => void | Promise<void>} DrainLog
 */

/** Satır satır yazmak yerine kısa tampon. */
const FLUSH_INTERVAL_MS = 1000;
const FLUSH_MAX_LINES = 32;

/** Diskteki parçaların ömrü. Config yükseltemez. */
export const FILE_LOG_RETENTION_MS = 5 * 60 * 1000;

/**
 * @param {{ root: string, dir: string, persist?: boolean,
 *   retentionMs?: number, drainLog?: DrainLog | null }} options
 *   `persist: false` diske yazmaz; yalnız `drainLog` çağrılır.
 * @returns {LogSink}
 */
export function createFileSink(options) {
  const persist = options.persist !== false;
  const retentionMs = options.retentionMs ?? FILE_LOG_RETENTION_MS;
  const drainLog = typeof options.drainLog === "function" ? options.drainLog : null;
  const baseDir = path.resolve(options.root, options.dir);
  /** @type {string[]} */
  let pending = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @type {Promise<void>} */
  let chain = Promise.resolve();
  let seq = 0;
  let ready = false;
  let drainWarned = false;

  /**
   * @param {string} message
   * @param {unknown} [error]
   */
  function warnDrain(message, error) {
    if (drainWarned) return;
    drainWarned = true;
    console.warn(`[logs] ${message}`, error ?? "");
  }

  /**
   * @returns {Promise<void>}
   */
  async function ensureDir() {
    if (ready) return;
    await fs.mkdir(baseDir, { recursive: true });
    ready = true;
  }

  /**
   * Süresi dolmuş `jskelet-*` parçalarını eskiden yeniye siler. Başka
   * dosyalara dokunulmaz. Eski günlük `.log` dosyaları da bu ada uyar.
   *
   * @returns {Promise<void>}
   */
  async function prune() {
    if (!persist) return;
    let names;
    try {
      names = await fs.readdir(baseDir);
    } catch {
      return;
    }

    const now = Date.now();
    /** @type {{ file: string, mtimeMs: number }[]} */
    const doomed = [];

    for (const name of names) {
      if (!name.startsWith("jskelet-")) continue;
      const file = path.join(baseDir, name);
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile()) continue;
        if (now - stat.mtimeMs < retentionMs) continue;
        doomed.push({ file, mtimeMs: stat.mtimeMs });
      } catch {
        // Silinmiş veya okunamayan girdi turu bozmasın.
      }
    }

    doomed.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const item of doomed) {
      await fs.rm(item.file, { force: true });
    }
  }

  /**
   * @param {string} text
   * @param {number} lines
   * @returns {Promise<void>}
   */
  async function seal(text, lines) {
    const body = zlib.zstdCompressSync(Buffer.from(text, "utf8"));
    const at = Date.now();

    if (persist) {
      await ensureDir();
      seq += 1;
      const file = path.join(baseDir, `jskelet-${at}-${seq}.ndjson.zst`);
      await fs.writeFile(file, body);
      await prune();
    }

    if (!drainLog) return;

    try {
      await drainLog({
        body,
        encoding: "zstd",
        bytes: body.length,
        lines,
        at,
      });
    } catch (error) {
      warnDrain(
        persist
          ? "drainLog failed; the chunk stays on disk until it expires"
          : "drainLog failed; the chunk was not stored",
        error,
      );
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async function flushPending() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending.length) return;

    const lines = pending;
    pending = [];
    await seal(lines.join(""), lines.length);
  }

  /** @returns {void} */
  function schedule() {
    if (timer || !pending.length) return;
    timer = setTimeout(() => {
      timer = null;
      chain = chain.then(() => flushPending());
    }, FLUSH_INTERVAL_MS);
    timer.unref?.();
  }

  return {
    async write(entry) {
      pending.push(`${JSON.stringify(entry)}\n`);

      if (pending.length >= FLUSH_MAX_LINES) {
        chain = chain.then(() => flushPending());
        await chain;
        return;
      }

      schedule();
    },
    async flush() {
      chain = chain.then(() => flushPending());
      await chain;
    },
    async close() {
      chain = chain.then(() => flushPending());
      await chain;
      if (persist) await prune();
    },
  };
}
