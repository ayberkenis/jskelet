import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearHtmlCache,
  getHtmlCacheSize,
  withHtmlCache,
} from "../src/server/html-cache.js";

afterEach(() => {
  clearHtmlCache();
});

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a ttl of 0 is never stored", async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    return { html: "x", status: 200 };
  };

  await withHtmlCache("/a", 0, producer);
  const second = await withHtmlCache("/a", 0, producer);

  assert.equal(calls, 2);
  assert.equal(second.cached, false);
  assert.equal(getHtmlCacheSize(), 0);
});

test("the second request is served from the cache", async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    return { html: `render ${calls}`, status: 200 };
  };

  const first = await withHtmlCache("/a", 60, producer);
  const second = await withHtmlCache("/a", 60, producer);

  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.stale, false);
  assert.equal(second.html, "render 1");
});

test("an expired ttl serves stale html and revalidates in the background", async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    return { html: `render ${calls}`, status: 200 };
  };

  // 50 ms TTL, 70 ms bekleme: TTL geçmiş ama stale penceresi (TTL'in bir katı
  // daha, yani 100 ms) sürüyor. Gerçek zamanı beklemek burada saati taklit
  // etmekten daha az kırılgan.
  const ttl = 0.05;
  await withHtmlCache("/a", ttl, producer);
  await sleep(70);

  const stale = await withHtmlCache("/a", ttl, producer);
  assert.equal(stale.cached, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.html, "render 1", "eski html anında dönmeli");

  await sleep(20);
  assert.equal(calls, 2, "tazeleme arkada bir kez çalışmalı");
});

test("concurrent requests for the same key share one render", async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    await sleep(10);
    return { html: "x", status: 200 };
  };

  await Promise.all([
    withHtmlCache("/a", 60, producer),
    withHtmlCache("/a", 60, producer),
    withHtmlCache("/a", 60, producer),
  ]);

  assert.equal(calls, 1);
});

test("404 and degraded results are not stored", async () => {
  await withHtmlCache("/yok", 60, async () => ({ html: "404", status: 404 }));
  assert.equal(getHtmlCacheSize(), 0, "404 önbelleğe girmemeli");

  await withHtmlCache("/kismi", 60, async () => ({
    html: "eksik",
    status: 200,
    degraded: true,
  }));
  assert.equal(getHtmlCacheSize(), 0, "degraded render önbelleğe girmemeli");
});
