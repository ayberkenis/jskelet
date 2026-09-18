/**
 * Dinlenecek port doluysa başlamadan önce net bir hata verilir; `--murder`
 * verilmişse o porttaki dinleyici süreçler öldürülüp bağlama denenir.
 *
 * Windows: `netstat` + `taskkill`. Unix: `lsof` (yoksa `ss`) + `process.kill`.
 * Bu süreçlerin PID'lerini okumak için yerleşik bir Node API'si yok.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";

const execFileAsync = promisify(execFile);

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `netstat -ano -p tcp` çıktısından LISTENING PID'lerini çıkarır.
 * `3000` ile `30001` karışmasın diye porttan sonra rakam olmamalı.
 *
 * @param {string} stdout
 * @param {number} port
 * @returns {number[]}
 */
export function parseWindowsNetstat(stdout, port) {
  const re = new RegExp(
    String.raw`TCP\s+\S*:${port}(?!\d)\s+\S+\s+LISTENING\s+(\d+)`,
    "gi",
  );
  /** @type {number[]} */
  const pids = [];
  for (const match of stdout.matchAll(re)) {
    pids.push(Number(match[1]));
  }
  return pids;
}

/**
 * `lsof -t` çıktısı: satır başına bir PID.
 *
 * @param {string} stdout
 * @returns {number[]}
 */
export function parseLsofPids(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/**
 * `ss -H -lptn` satırlarından `pid=` değerlerini alır.
 *
 * @param {string} stdout
 * @returns {number[]}
 */
export function parseSsPids(stdout) {
  /** @type {number[]} */
  const pids = [];
  for (const match of stdout.matchAll(/pid=(\d+)/g)) {
    pids.push(Number(match[1]));
  }
  return pids;
}

/**
 * Bu süreç ve ebeveyni öldürülmesin: `--murder` yenilemede kendi CLI'sını
 * ya da henüz dinlemeyen kendisini vurmasın.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function isSafeToKill(pid) {
  return pid > 0 && pid !== process.pid && pid !== process.ppid;
}

/**
 * @param {number} port
 * @returns {Promise<number[]>}
 */
async function listWindows(port) {
  const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseWindowsNetstat(stdout, port);
}

/**
 * @param {number} port
 * @returns {Promise<number[]>}
 */
async function listUnix(port) {
  try {
    const { stdout } = await execFileAsync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { maxBuffer: 1024 * 1024 },
    );
    return parseLsofPids(stdout);
  } catch (error) {
    // lsof yoksa (exit 1 = dinleyen yok; ENOENT = komut yok) ss'e düş.
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return listUnixSs(port);
    }
    const status = /** @type {{ status?: number | null }} */ (error).status;
    if (status === 1) return [];
    throw error;
  }
}

/**
 * @param {number} port
 * @returns {Promise<number[]>}
 */
async function listUnixSs(port) {
  try {
    const { stdout } = await execFileAsync(
      "ss",
      ["-H", "-lptn", `sport = :${port}`],
      { maxBuffer: 1024 * 1024 },
    );
    return parseSsPids(stdout);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return [];
    }
    const status = /** @type {{ status?: number | null }} */ (error).status;
    if (status === 1) return [];
    throw error;
  }
}

/**
 * Portu dinleyen yabancı süreçlerin PID listesi.
 *
 * @param {number} port
 * @returns {Promise<number[]>}
 */
export async function listListeningPids(port) {
  const raw =
    process.platform === "win32"
      ? await listWindows(port)
      : await listUnix(port);
  return [...new Set(raw)].filter(isSafeToKill);
}

/**
 * @param {number} pid
 * @returns {Promise<void>}
 */
async function killPid(pid) {
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/PID", String(pid), "/F"], {
        windowsHide: true,
      });
    } catch (error) {
      // Süreç zaten gitmiş olabilir.
      const status = /** @type {{ status?: number | null }} */ (error).status;
      if (status === 128 || status === 1) return;
      throw error;
    }
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH") return;
    throw error;
  }

  await sleep(200);
  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGKILL");
  } catch {
    // ESRCH: SIGTERM yetmiş.
  }
}

/**
 * Porttaki dinleyicileri öldürür ve soketin boşalmasını kısa süre bekler.
 *
 * @param {number} port
 * @returns {Promise<number[]>} öldürülen PID'ler
 */
export async function murderPort(port) {
  const pids = await listListeningPids(port);
  for (const pid of pids) {
    await killPid(pid);
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const still = await listListeningPids(port);
    if (still.length === 0) return pids;
    await sleep(50);
  }

  return pids;
}

/**
 * Port doluysa ya net hata fırlatır ya da `--murder` ile temizler.
 *
 * Dinleyici listesi alınamazsa (araç yok / yetki) sessizce geçer; asıl bağlama
 * `EADDRINUSE` ile yine düşer.
 *
 * @param {number} port
 * @param {{ murder?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function ensurePortFree(port, options = {}) {
  const murder = options.murder === true;

  /** @type {number[]} */
  let pids;
  try {
    pids = await listListeningPids(port);
  } catch {
    return;
  }

  if (pids.length === 0) return;

  if (!murder) {
    const error = new Error(
      `port ${port} is already in use (pid ${pids.join(", ")}). ` +
        `Pass --murder to kill it and start, or set PORT to another value.`,
    );
    /** @type {NodeJS.ErrnoException} */ (error).code = "EADDRINUSE";
    throw error;
  }

  console.error(
    `[jskelet] port ${port} in use by pid ${pids.join(", ")} — killing (--murder)`,
  );
  await murderPort(port);

  const still = await listListeningPids(port);
  if (still.length > 0) {
    const error = new Error(
      `port ${port} still in use after --murder (pid ${still.join(", ")})`,
    );
    /** @type {NodeJS.ErrnoException} */ (error).code = "EADDRINUSE";
    throw error;
  }
}
