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
import { reportUpstreamFailure } from "../src/server/upstream-tracking.js";

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
