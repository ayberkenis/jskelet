/**
 * Admin paneli cache / host / process dökümü.
 *
 * HTML gövdesi ve veri değerleri dönmez — yalnızca meta.
 * System sayfasındaki çubuklar **bu sürecin** payını gösterir (makine
 * toplamına oranla), host'un genel doluluğunu değil.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { getConfig } from "../../config/index.js";
import {
  FRAMEWORK_HOMEPAGE,
  FRAMEWORK_LICENSE,
  FRAMEWORK_NODE_RANGE,
  FRAMEWORK_VERSION,
} from "../../version.mjs";
import {
  getHtmlCacheEntries,
  getHtmlCacheSize,
} from "../html-cache.js";
import {
  getDataCacheEntries,
  getDataCacheSize,
} from "../data-cache.js";
import { getRedisDetails, getRedisStatus } from "../redis.js";
import { getUpstreamLimiterStatus } from "../upstream-limiter.js";
import { getCloudflareStatus } from "../cloudflare.js";
import { prewarmProgress } from "../prewarm.js";

/** Listelerin üst sınırı: veri önbelleğinde on binlerce anahtar olabiliyor. */
const MAX_LISTED = 500;

/** Disk ölçümünde atlanan dizinler — node_modules her poll'da taranmasın. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "coverage",
  ".turbo",
  ".next",
]);

export const BOOT_ID = `${Date.now()}-${process.pid}`;

/** @type {{ usage: NodeJS.CpuUsage; at: number } | null} */
let cpuSample = null;

/** @type {{ at: number, bytes: number, root: string } | null} */
let diskSample = null;

/**
 * @param {string} query Anahtar filtresi (boş → filtre yok).
 * @returns {Promise<object>}
 */
export async function snapshot(query) {
  const term = query.trim().toLowerCase();
  /** @param {{ key: string }} entry */
  const matches = (entry) => !term || entry.key.toLowerCase().includes(term);

  const html = getHtmlCacheEntries();
  const data = getDataCacheEntries();

  const htmlMatched = html.filter(matches);
  const dataMatched = data.filter(matches);
  const usage = process.memoryUsage();
  const host = await hostStatus();
  const cpuPercent = sampleProcessCpu(host.cpus);
  const appDiskBytes = await sampleAppDisk(getConfig().root);

  return {
    boot: BOOT_ID,
    generatedAt: Date.now(),
    release: {
      version: FRAMEWORK_VERSION,
      license: FRAMEWORK_LICENSE,
      node: FRAMEWORK_NODE_RANGE,
      homepage: FRAMEWORK_HOMEPAGE,
    },
    host,
    process: {
      pid: process.pid,
      node: process.version,
      uptime: process.uptime(),
      env: process.env.NODE_ENV ?? "production",
      memory: { rss: usage.rss, heapUsed: usage.heapUsed },
      /** 0–100: bu sürecin tüm çekirdek kapasitesine oranı. */
      cpuPercent,
      /** Proje kökünün (node_modules hariç) disk boyutu. */
      diskBytes: appDiskBytes,
    },
    html: {
      size: getHtmlCacheSize(),
      maxEntries: getConfig().htmlMaxEntries,
      bytes: html.reduce((total, entry) => total + entry.bytes, 0),
      stale: html.filter((entry) => entry.stale).length,
      matched: htmlMatched.length,
      entries: htmlMatched
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, MAX_LISTED)
        .map((entry) => ({
          ...entry,
          url: entry.key.endsWith("?") ? entry.key.slice(0, -1) : entry.key,
        })),
    },
    data: {
      size: getDataCacheSize(),
      maxEntries: Number(getConfig().data?.maxEntries) || 0,
      stale: data.filter((entry) => entry.stale).length,
      matched: dataMatched.length,
      entries: dataMatched
        .sort((a, b) => a.expiresIn - b.expiresIn)
        .slice(0, MAX_LISTED),
    },
    redis: { ...getRedisStatus(), ...getRedisDetails() },
    cloudflare: getCloudflareStatus(),
    upstream: getUpstreamLimiterStatus(),
    prewarm: { ...prewarmProgress },
  };
}

/**
 * İki örnek arasındaki `process.cpuUsage` farkından süreç CPU yüzdesi.
 * İlk çağrıda örnek alınır ve 0 döner — panelin bir sonraki turunda anlamlı.
 *
 * @param {number} cores
 * @returns {number}
 */
function sampleProcessCpu(cores) {
  const now = Date.now();
  const current = process.cpuUsage();

  if (!cpuSample) {
    cpuSample = { usage: current, at: now };
    return 0;
  }

  const elapsedMs = now - cpuSample.at;
  const delta = process.cpuUsage(cpuSample.usage);
  cpuSample = { usage: current, at: now };

  if (elapsedMs <= 0 || cores <= 0) return 0;

  // user+system mikro-saniye → ms; duvar süresi × çekirdek = kapasite.
  const cpuMs = (delta.user + delta.system) / 1000;
  const capacityMs = elapsedMs * cores;
  return Math.max(0, Math.min(100, (cpuMs / capacityMs) * 100));
}

/**
 * Proje kökünün boyutu (ağır dizinler atlanır). 60 sn önbellek.
 *
 * @param {string} root
 * @returns {Promise<number>}
 */
async function sampleAppDisk(root) {
  if (diskSample && diskSample.root === root && Date.now() - diskSample.at < 60_000) {
    return diskSample.bytes;
  }

  const bytes = await measureDir(root);
  diskSample = { at: Date.now(), bytes, root };
  return bytes;
}

/**
 * @param {string} dir
 * @returns {Promise<number>}
 */
async function measureDir(dir) {
  let total = 0;

  /** @type {string[]} */
  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;

      try {
        const stats = await fs.promises.stat(full);
        total += stats.size;
      } catch {
        // silinmiş / erişilemeyen dosya
      }
    }
  }

  return total;
}

/**
 * @returns {Promise<object>}
 */
async function hostStatus() {
  const total = os.totalmem();
  const free = os.freemem();

  /** @type {{ path: string, total: number, free: number } | null} */
  let disk = null;

  try {
    const root = getConfig().root;
    const stats = await fs.promises.statfs(root);
    disk = {
      path: root,
      total: stats.blocks * stats.bsize,
      free: stats.bavail * stats.bsize,
    };
  } catch {
    disk = null;
  }

  return {
    platform: `${os.platform()} ${os.arch()}`,
    cpus: os.cpus().length,
    load: os.loadavg()[0],
    memory: { total, free, used: total - free },
    disk,
  };
}
