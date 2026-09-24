/**
 * Redis yokken L2 dosyası. Gerçek bir disk dizini kullanılır; config
 * yüklenmediği için kök testte verilir.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { clearDataCache, getDataCacheSize, withDataCache } from "../src/server/data-cache.js";
import { setDiskCacheRootForTests } from "../src/server/disk-cache.js";
import {
  clearHtmlCache,
  getHtmlCacheSize,
  invalidateHtmlCache,
  withHtmlCache,
} from "../src/server/html-cache.js";
import { setRedisClientForTests } from "../src/server/redis.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {string | null} */
let root = null;

afterEach(async () => {
  setDiskCacheRootForTests(null);
  setRedisClientForTests(null);
  clearHtmlCache();
  clearDataCache();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = null;
});

async function tempRoot() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "jskelet-cache-"));
  setDiskCacheRootForTests(root);
  return root;
}

/**
 * @param {string} kind
 * @returns {Promise<string[]>}
 */
async function files(kind) {
  return fs.readdir(path.join(root, kind)).catch(() => []);
}

test("a page is written to disk and promotes after L1 is cleared", async () => {
  await tempRoot();

  await withHtmlCache("/a?", 60, async () => ({ html: "diskten", status: 200 }));

  let names = [];
  for (let i = 0; names.length === 0 && i < 50; i += 1) {
    names = await files("html");
    if (!names.length) await sleep(10);
  }
  assert.equal(names.length, 1);

  setDiskCacheRootForTests(null);
  clearHtmlCache();
  setDiskCacheRootForTests(root);

  const hit = await withHtmlCache("/a?", 60, async () => {
    throw new Error("render çalışmamalıydı");
  });
  assert.equal(hit.html, "diskten");
  assert.equal(getHtmlCacheSize(), 1);
});

test("invalidation removes the file so the next read renders", async () => {
  await tempRoot();

  await withHtmlCache("/haber/a?", 60, async () => ({ html: "eski", status: 200 }));
  for (let i = 0; (await files("html")).length === 0 && i < 50; i += 1) await sleep(10);

  invalidateHtmlCache("/haber/a");
  for (let i = 0; (await files("html")).length > 0 && i < 50; i += 1) await sleep(10);
  assert.deepEqual(await files("html"), []);
});

test("the data cache reuses a value written to disk", async () => {
  await tempRoot();

  await withDataCache("haber:1", 60, async () => ({ baslik: "disk" }));
  for (let i = 0; (await files("data")).length === 0 && i < 50; i += 1) await sleep(10);

  setDiskCacheRootForTests(null);
  clearDataCache();
  setDiskCacheRootForTests(root);

  const value = await withDataCache("haber:1", 60, async () => {
    throw new Error("upstream'e gidilmemeliydi");
  });
  assert.deepEqual(value, { baslik: "disk" });
  assert.equal(getDataCacheSize(), 1);
});

test("redis suppresses the disk copy", async () => {
  await tempRoot();
  setRedisClientForTests({
    async get() {
      return null;
    },
    async getBuffer() {
      return null;
    },
    async set() {
      return "OK";
    },
    async unlink() {
      return 0;
    },
    async scan() {
      return ["0", []];
    },
    async publish() {
      return 1;
    },
  });

  await withHtmlCache("/a?", 60, async () => ({ html: "redis", status: 200 }));
  await sleep(30);
  assert.deepEqual(await files("html"), []);
});
