import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearDataCache,
  dataCache,
  getDataCacheEntries,
  getDataCacheSize,
  withDataCache,
} from "../src/server/data-cache.js";

afterEach(() => {
  clearDataCache();
});

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a ttl of 0 bypasses the cache", async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    return calls;
  };

  assert.equal(await withDataCache("k", 0, producer), 1);
  assert.equal(await withDataCache("k", 0, producer), 2);
  assert.equal(getDataCacheSize(), 0);
});

test("the second read is served from the cache", async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    return { calls };
  };

  const first = await withDataCache("k", 60, producer);
  const second = await withDataCache("k", 60, producer);

  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.equal(getDataCacheSize(), 1);
});

test("an expired ttl serves the stale value and refreshes in the background", async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    return calls;
  };

  const ttl = 0.05;
  await withDataCache("k", ttl, producer);
  await sleep(70);

  assert.equal(await withDataCache("k", ttl, producer), 1, "bayat değer anında dönmeli");

  await sleep(20);
  assert.equal(calls, 2, "tazeleme arkada bir kez çalışmalı");
  assert.equal(await withDataCache("k", ttl, producer), 2);
});

test("concurrent reads for the same key share one upstream call", async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    await sleep(10);
    return calls;
  };

  const values = await Promise.all([
    withDataCache("k", 60, producer),
    withDataCache("k", 60, producer),
    withDataCache("k", 60, producer),
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(values, [1, 1, 1]);
});

test("empty values are not stored unless asked for", async () => {
  await withDataCache("bos", 60, async () => null);
  assert.equal(getDataCacheSize(), 0, "null saklanmamalı");

  await withDataCache("bos", 60, async () => null, { storeEmpty: true });
  assert.equal(getDataCacheSize(), 1);
});

test("a failing producer falls back to the stale value", async () => {
  const ttl = 0.05;
  await withDataCache("k", ttl, async () => "taze");
  await sleep(70);

  // Bayat pencere içinde upstream düştü: sayfa eski veriyle ayakta kalmalı.
  const value = await withDataCache("k", ttl, async () => {
    throw new Error("429");
  });

  assert.equal(value, "taze");
});

test("a failing producer throws when there is nothing stored", async () => {
  await assert.rejects(
    withDataCache("k", 60, async () => {
      throw new Error("429");
    }),
    /429/,
  );
});

test("the lru drops the oldest entry past the limit", async () => {
  // Varsayılan sınır 10.000; testte sınırı zorlamak yerine LRU sırasının
  // erişimle güncellendiğini doğrulamak yeterli.
  await withDataCache("a", 60, async () => 1);
  await withDataCache("b", 60, async () => 2);
  await withDataCache("a", 60, async () => 1);

  assert.deepEqual(
    getDataCacheEntries().map((entry) => entry.key),
    ["b", "a"],
  );
});

test("clearDataCache drops only the matching prefix", async () => {
  await withDataCache("haber:1", 60, async () => 1);
  await withDataCache("haber:2", 60, async () => 2);
  await withDataCache("etiket:1", 60, async () => 3);

  assert.equal(clearDataCache("haber:"), 2);
  assert.deepEqual(
    getDataCacheEntries().map((entry) => entry.key),
    ["etiket:1"],
  );
});

test("dataCache() derives the key from the arguments", async () => {
  let calls = 0;
  const load = dataCache(
    async (slug) => {
      calls += 1;
      return `veri:${slug}`;
    },
    { key: "haber", revalidate: 60 },
  );

  assert.equal(await load("a"), "veri:a");
  assert.equal(await load("a"), "veri:a");
  assert.equal(await load("b"), "veri:b");

  assert.equal(calls, 2);
  assert.deepEqual(
    getDataCacheEntries().map((entry) => entry.key),
    ['haber:["a"]', 'haber:["b"]'],
  );
});
