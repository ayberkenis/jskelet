/**
 * Günlük rotasyonlu NDJSON dosya sink'i.
 *
 * Yol `path.resolve(root, dir)` ile bulunur — `getConfig().dirs` şişirilmez;
 * log dizini opsiyonel bir yüzey ve çoğu kurulumda hiç açılmaz.
 */
import fs from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {{ write: (entry: Record<string, unknown>) => Promise<void>,
 *   flush: () => Promise<void>, close: () => Promise<void> }} LogSink
 */

/**
 * @param {{ root: string, dir: string }} options
 * @returns {LogSink}
 */
export function createFileSink(options) {
  const baseDir = path.resolve(options.root, options.dir);
  /** @type {string | null} */
  let currentDay = null;
  /** @type {string | null} */
  let currentPath = null;
  let ready = false;

  /** @returns {string} */
  function dayStamp(date = new Date()) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  /**
   * @param {string} day
   * @returns {Promise<string>}
   */
  async function ensureFile(day) {
    if (!ready) {
      await fs.mkdir(baseDir, { recursive: true });
      ready = true;
    }
    if (currentDay === day && currentPath) return currentPath;
    currentDay = day;
    currentPath = path.join(baseDir, `jskelet-${day}.log`);
    return currentPath;
  }

  return {
    async write(entry) {
      const day = dayStamp(
        typeof entry.at === "number" ? new Date(entry.at) : new Date(),
      );
      const file = await ensureFile(day);
      await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
    },
    async flush() {
      // appendFile senkron flush eder; ekstra iş yok.
    },
    async close() {
      currentDay = null;
      currentPath = null;
    },
  };
}
