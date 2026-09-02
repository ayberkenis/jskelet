/**
 * Admin paneli cache / host / process dökümü.
 *
 * HTML gövdesi ve veri değerleri dönmez — yalnızca meta.
 */
import fs from "node:fs";
import os from "node:os";
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

export const BOOT_ID = `${Date.now()}-${process.pid}`;

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

  return {
    boot: BOOT_ID,
    generatedAt: Date.now(),
    release: {
      version: FRAMEWORK_VERSION,
      license: FRAMEWORK_LICENSE,
      node: FRAMEWORK_NODE_RANGE,
      homepage: FRAMEWORK_HOMEPAGE,
    },
    host: await hostStatus(),
    process: {
      pid: process.pid,
      node: process.version,
      uptime: process.uptime(),
      env: process.env.NODE_ENV ?? "production",
      memory: { rss: usage.rss, heapUsed: usage.heapUsed },
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
