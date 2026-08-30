import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearHtmlCache,
  getHtmlCacheSize,
  invalidateHtmlCache,
  takeInvalidatedPaths,
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

test("invalidation marks the entry stale instead of dropping it", async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    return { html: `render ${calls}`, status: 200 };
  };

  await withHtmlCache("/a?", 60, producer);
  assert.equal(invalidateHtmlCache("/a"), 1);
  assert.equal(getHtmlCacheSize(), 1, "yumuşak invalidation girdiyi silmemeli");

  const hit = await withHtmlCache("/a?", 60, producer);
  assert.equal(hit.cached, true);
  assert.equal(hit.stale, true);
  assert.equal(hit.html, "render 1", "ziyaretçi render'ı beklememeli");

  await sleep(10);
  assert.equal(calls, 2, "tazeleme arkada koşmalı");
});

test("a hard invalidation drops the entry", async () => {
  await withHtmlCache("/a?", 60, async () => ({ html: "x", status: 200 }));

  assert.equal(invalidateHtmlCache("/a", { hard: true }), 1);
  assert.equal(getHtmlCacheSize(), 0);
});

test("invalidation covers every query variant of a path", async () => {
  const producer = async () => ({ html: "x", status: 200 });

  await withHtmlCache("/liste?sayfa=2", 60, producer);
  await withHtmlCache("/liste?sayfa=3&utm_source=mail", 60, producer);
  await withHtmlCache("/baska?", 60, producer);

  assert.equal(invalidateHtmlCache("/liste"), 2);
});

test("invalidation targets accept patterns, regexps and lists", async () => {
  const producer = async () => ({ html: "x", status: 200 });

  await withHtmlCache("/haber/a?", 60, producer);
  await withHtmlCache("/haber/b?", 60, producer);
  await withHtmlCache("/etiket/x-yorumlar?", 60, producer);
  await withHtmlCache("/hakkinda?", 60, producer);

  assert.equal(invalidateHtmlCache("/haber/:slug", { hard: true }), 2);
  assert.equal(invalidateHtmlCache([/-yorumlar$/, "/hakkinda"], { hard: true }), 2);
  assert.equal(getHtmlCacheSize(), 0);
});

test("a prefix stops at the segment boundary", async () => {
  const producer = async () => ({ html: "x", status: 200 });

  await withHtmlCache("/haber?", 60, producer);
  await withHtmlCache("/haberler?", 60, producer);
  await withHtmlCache("/haber/a?", 60, producer);

  assert.equal(invalidateHtmlCache("/haber", { hard: true }), 2, "/haberler kalmalı");
  assert.equal(getHtmlCacheSize(), 1);
});

test("a refresh that started before the invalidation is not stored", async () => {
  let calls = 0;
  const producer = async () => {
    calls += 1;
    await sleep(30);
    return { html: `render ${calls}`, status: 200 };
  };

  // Uçuştaki render invalidation'dan önce başladı: sonucu artık geçersiz,
  // yazılırsa az önce düşürülen girdiyi geri koyar.
  const pending = withHtmlCache("/a?", 60, producer);
  await sleep(5);
  invalidateHtmlCache("/a", { hard: true });
  await pending;

  assert.equal(getHtmlCacheSize(), 0, "iptal edilmiş tur önbelleğe yazmamalı");
});

test("invalidated paths are queued for the next prewarm pass", async () => {
  const producer = async () => ({ html: "x", status: 200 });

  await withHtmlCache("/a?", 60, producer);
  await withHtmlCache("/liste?sayfa=2", 60, producer);
  invalidateHtmlCache([/^\//]);

  assert.deepEqual(takeInvalidatedPaths().sort(), ["/a", "/liste?sayfa=2"]);
  assert.deepEqual(takeInvalidatedPaths(), [], "kuyruk bir kez okunur");
});

test("a visited path leaves the prewarm queue", async () => {
  const producer = async () => ({ html: "x", status: 200 });

  await withHtmlCache("/a?", 60, producer);
  invalidateHtmlCache("/a");
  await withHtmlCache("/a?", 60, producer);

  assert.deepEqual(takeInvalidatedPaths(), [], "ziyaret edilen yol ısıtılmaz");
});
