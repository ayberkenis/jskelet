/**
 * Cache hot-path A/B. `node scripts/compare-cache-bench.mjs [label]`
 */
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate as setImm } from "node:timers/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const label = process.argv[2] ?? path.basename(ROOT);

const htmlMod = await import(pathToFileURL(path.join(ROOT, "src/server/html-cache.js")).href);
const {
  withHtmlCache,
  clearHtmlCache,
  rememberHtmlEncoding,
  noteHtmlCacheGrowth,
  setHtmlCacheByteBudget,
} = htmlMod;

const dataMod = await import(pathToFileURL(path.join(ROOT, "src/server/data-cache.js")).href);
const { withDataCache, clearDataCache } = dataMod;

const blob = await import(pathToFileURL(path.join(ROOT, "src/server/cache-blob.js")).href);
const { decodeCacheValue, encodeCacheValue } = blob;
const decodeCacheValueAsync =
  typeof blob.decodeCacheValueAsync === "function" ? blob.decodeCacheValueAsync : null;

const { cache, withRequestCache } = await import(
  pathToFileURL(path.join(ROOT, "src/http/request-cache.js")).href
);

clearHtmlCache();
clearDataCache();
setHtmlCacheByteBudget(null);

/** @param {() => void | Promise<void>} fn @param {number} n */
async function avgMs(fn, n) {
  for (let i = 0; i < Math.min(15, n); i += 1) await fn();
  const t0 = performance.now();
  for (let i = 0; i < n; i += 1) await fn();
  return (performance.now() - t0) / n;
}

const htmlBody = `<!doctype html><html><body>${"x".repeat(12_000)}</body></html>`;

// 1) Saf MISS (encode bitmesini beklemeden) — her turda yeni key
clearHtmlCache();
const missMs = await avgMs(async () => {
  const key = `/m${Math.random()}?`;
  await withHtmlCache(key, 60, async () => ({ html: htmlBody, status: 200 }));
}, 30);
// Arka plan encode'ların sönmesini bekle (sonraki ölçümleri kirletmesin)
await new Promise((r) => setTimeout(r, 80));
clearHtmlCache();

// 2) Yaz → br hazır olana kadar süre
async function timeUntilBr() {
  clearHtmlCache();
  const key = `/enc${Math.random()}?`;
  await withHtmlCache(key, 60, async () => ({ html: htmlBody, status: 200 }));
  const t0 = performance.now();
  for (let i = 0; i < 200; i += 1) {
    const hit = await withHtmlCache(key, 60, async () => {
      throw new Error("hit");
    });
    if (hit.encoded?.has("br")) return performance.now() - t0;
    await setImm();
  }
  return null;
}

/** @type {number[]} */
const brTimes = [];
for (let i = 0; i < 8; i += 1) {
  const ms = await timeUntilBr();
  if (ms != null) brTimes.push(ms);
}
const brReadyMs =
  brTimes.length > 0 ? brTimes.reduce((a, b) => a + b, 0) / brTimes.length : null;

// 3) HIT (encode hazır)
clearHtmlCache();
await withHtmlCache("/hit?", 60, async () => ({ html: htmlBody, status: 200 }));
await new Promise((r) => setTimeout(r, 40));
const hitMs = await avgMs(async () => {
  await withHtmlCache("/hit?", 60, async () => {
    throw new Error("hit");
  });
}, 300);

// 4) 200 girdilik store'da rememberEncoding
clearHtmlCache();
setHtmlCacheByteBudget(50 * 1024 * 1024);
for (let i = 0; i < 200; i += 1) {
  await withHtmlCache(`/p${i}?`, 60, async () => ({
    html: `page-${i}-${"y".repeat(400)}`,
    status: 200,
  }));
}
await new Promise((r) => setTimeout(r, 50));
const sample = await withHtmlCache("/p0?", 60, async () => {
  throw new Error("hit");
});
const buf = Buffer.alloc(500);
const rounds = 3_000;
const tRem = performance.now();
for (let i = 0; i < rounds; i += 1) rememberHtmlEncoding(sample.encoded, "br", buf);
const rememberUs = ((performance.now() - tRem) / rounds) * 1000;

const tRec = performance.now();
for (let i = 0; i < rounds; i += 1) noteHtmlCacheGrowth();
const recountUs = ((performance.now() - tRec) / rounds) * 1000;

// 5) Data early refresh
clearDataCache();
let produced = 0;
await withDataCache("early:k", 1, async () => {
  produced += 1;
  return { ok: true };
});
await new Promise((r) => setTimeout(r, 700));
await withDataCache("early:k", 1, async () => {
  produced += 1;
  return { ok: true, n: 2 };
});
await new Promise((r) => setTimeout(r, 50));
const dataEarlyRefresh = produced >= 2;

// 6) Decode: wall + event-loop lag (sync bloklar)
const fatValue = {
  html: "z".repeat(40_000),
  status: 200,
  expiresAt: Date.now() + 60_000,
  deps: [],
};
const encoded = await Promise.resolve(encodeCacheValue(fatValue));
const packed = Buffer.isBuffer(encoded)
  ? encoded
  : Buffer.from(/** @type {string} */ (encoded));

async function eventLoopLagDuring(work) {
  let maxLag = 0;
  let running = true;
  const probe = (async () => {
    let last = performance.now();
    while (running) {
      await setImm();
      const now = performance.now();
      maxLag = Math.max(maxLag, now - last - 1);
      last = now;
    }
  })();
  await work();
  running = false;
  await probe;
  return maxLag;
}

const syncLag = await eventLoopLagDuring(async () => {
  for (let i = 0; i < 40; i += 1) decodeCacheValue(packed);
});

let asyncLag = null;
let decodeAsyncMs = null;
if (decodeCacheValueAsync) {
  decodeAsyncMs = await avgMs(async () => {
    await decodeCacheValueAsync(packed);
  }, 40);
  asyncLag = await eventLoopLagDuring(async () => {
    await Promise.all(Array.from({ length: 40 }, () => decodeCacheValueAsync(packed)));
  });
}

const decodeSyncMs = await avgMs(() => {
  decodeCacheValue(packed);
}, 40);

// 7) request-cache
const fn = cache((id) => id);
const keyMs = await avgMs(() => {
  withRequestCache(() => {
    for (let i = 0; i < 200; i += 1) fn("user-42");
  });
}, 300);

console.log(
  JSON.stringify({
    label,
    htmlMissMs: Number(missMs.toFixed(3)),
    htmlHitMs: Number(hitMs.toFixed(4)),
    brReadyMs: brReadyMs == null ? null : Number(brReadyMs.toFixed(2)),
    rememberEncodingUs: Number(rememberUs.toFixed(2)),
    noteGrowthRecountUs: Number(recountUs.toFixed(2)),
    dataEarlyRefresh,
    decodeSyncMs: Number(decodeSyncMs.toFixed(3)),
    decodeAsyncMs: decodeAsyncMs == null ? null : Number(decodeAsyncMs.toFixed(3)),
    eventLoopLagSyncMs: Number(syncLag.toFixed(2)),
    eventLoopLagAsyncMs: asyncLag == null ? null : Number(asyncLag.toFixed(2)),
    requestCacheKeyMs: Number(keyMs.toFixed(4)),
  }),
);

clearHtmlCache();
clearDataCache();
setHtmlCacheByteBudget(null);
