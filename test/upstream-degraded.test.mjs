/**
 * Geçici upstream hatasının `notFound()` ile birleştiği durum.
 *
 * Bu dosyanın varlık sebebi üretimde görülen bir davranış: API rate limit'e
 * (429) girdiğinde veri gelmeyen sayfa `notFound()` çağırıyor, 404 önbelleğe
 * yazılıyor ve geçici bir kota sorunu TTL boyunca "bu sayfa yok" cevabına
 * dönüşüyor. Arama motoru için bu kalıcı bir kayıp.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, before, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import { clearHtmlCache, getHtmlCacheSize } from "../src/server/html-cache.js";
import { route } from "../src/server/render.js";
import { notFound } from "../src/http/control-flow.js";
import {
  reportUpstreamFailure,
  trackUpstreamFetch,
} from "../src/server/upstream-tracking.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "private-app");

before(async () => {
  await loadConfig({ root: FIXTURE, force: true });
});

afterEach(() => {
  clearHtmlCache();
});

/** @param {string} pathname */
function createRequest(pathname) {
  return {
    method: "GET",
    path: pathname,
    originalUrl: pathname,
    params: {},
    query: {},
    headers: {},
    get: () => undefined,
  };
}

function createResponse() {
  /** @type {Map<string, string>} */
  const headers = new Map();

  const res = {
    statusCode: 200,
    /** @type {string | undefined} */
    body: undefined,
    /** @param {number} code */
    status(code) {
      res.statusCode = code;
      return res;
    },
    /** @param {string} key @param {unknown} value */
    setHeader(key, value) {
      headers.set(key.toLowerCase(), String(value));
      return res;
    },
    /** @param {string} key */
    getHeader(key) {
      return headers.get(key.toLowerCase());
    },
    /** @param {string} key */
    removeHeader(key) {
      headers.delete(key.toLowerCase());
    },
    /** @param {string} [value] */
    send(value) {
      res.body = value;
      return res;
    },
    /** @param {string} [value] */
    end(value) {
      if (value !== undefined) res.body = value;
      return res;
    },
    redirect() {
      return res;
    },
  };

  return res;
}

/**
 * @param {import('express').RequestHandler} handler
 * @param {string} pathname
 */
async function run(handler, pathname) {
  const res = createResponse();
  const warn = console.warn;
  console.warn = () => {};

  try {
    await handler(
      /** @type {any} */ (createRequest(pathname)),
      /** @type {any} */ (res),
      () => {},
    );
  } finally {
    console.warn = warn;
  }

  return res;
}

test("notFound() during a transient upstream failure serves an uncached 503", async () => {
  const handler = route(async () => {
    reportUpstreamFailure({ status: 429, path: "/api/haber/x" });
    notFound();
  });

  const res = await run(handler, "/haber/x");

  assert.equal(res.statusCode, 503);
  assert.equal(res.getHeader("retry-after"), "30");
  assert.equal(res.getHeader("cache-control"), "private, no-store");
  assert.equal(getHtmlCacheSize(), 0, "geçici hata önbelleğe yazılmamalı");
});

test("a genuine notFound() still serves 404", async () => {
  const handler = route(async () => {
    notFound();
  });

  const res = await run(handler, "/haber/yok");

  assert.equal(res.statusCode, 404);
  assert.equal(res.getHeader("retry-after"), undefined);
  assert.equal(getHtmlCacheSize(), 0);
});

test("notFound() after a permanent upstream failure still serves 404", async () => {
  const handler = route(async () => {
    // 404 deterministik: tekrar denemek düzeltmez, 503 vermek yanlış olur.
    reportUpstreamFailure({ status: 404, path: "/api/haber/y" });
    notFound();
  });

  const res = await run(handler, "/haber/y");

  assert.equal(res.statusCode, 404);
  assert.equal(res.getHeader("retry-after"), undefined);
});

test("a page that fails once is retried and served, not turned into a 404", async () => {
  let calls = 0;

  const handler = route(async () => {
    calls += 1;
    if (calls === 1) {
      reportUpstreamFailure({ status: 429, path: "/api/haber/z" });
      notFound();
    }
    return { view: "pages/hello", data: { who: "geldi" } };
  });

  const res = await run(handler, "/haber/z");

  assert.equal(calls, 2, "geçici hatadan sonra bir kez daha denenmeli");
  assert.equal(res.statusCode, 200);
  // İkinci deneme temiz bir izleme bağlamında koştu: ilk turun 429'u sayfayı
  // "eksik veriyle üretildi" saymamalı, yoksa gerçek içerik önbelleğe girmez.
  assert.equal(getHtmlCacheSize(), 1);
});

test("a retry that finds a clean answer serves a real 404", async () => {
  let calls = 0;

  const handler = route(async () => {
    calls += 1;
    if (calls === 1) reportUpstreamFailure({ status: 429, path: "/api/haber/q" });
    notFound();
  });

  const res = await run(handler, "/haber/q");

  assert.equal(calls, 2);
  assert.equal(res.statusCode, 404);
  assert.equal(res.getHeader("retry-after"), undefined);
});

test("a transient fetch failure is reported without any app code", async () => {
  const original = globalThis.fetch;

  // Taklit önce konur, sarmalayıcı onun üstüne geçer: test ağa çıkmadan
  // gerçek zincirin aynısı kurulmuş olur.
  globalThis.fetch = /** @type {any} */ (
    async () => new Response("slow down", { status: 429 })
  );
  trackUpstreamFetch();

  try {
    const handler = route(async () => {
      await globalThis.fetch("https://api.example.com/haber/w");
      notFound();
    });

    const res = await run(handler, "/haber/w");

    assert.equal(res.statusCode, 503, "429 elle bildirilmese de 404'e düşmemeli");
    assert.equal(res.getHeader("retry-after"), "30");
    assert.equal(getHtmlCacheSize(), 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("a degraded 200 is not offered to shared caches", async () => {
  const handler = route(async () => {
    reportUpstreamFailure({ status: 503, path: "/api/liste" });
    return { view: "pages/hello", data: { who: "eksik" } };
  });

  const res = await run(handler, "/liste");

  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader("cache-control"), "private, no-store");
  // Teşhis başlığı yine yazılır: sayfanın önbellek yolundan geçtiğini ama
  // saklanmadığını gösteren tek ipucu bu.
  assert.equal(res.getHeader("x-jskelet-cache"), "MISS");
  assert.equal(getHtmlCacheSize(), 0);
});
