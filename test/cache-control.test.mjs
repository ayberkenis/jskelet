/**
 * Edge başlığı: tarayıcıda max-age=0, süre CDN-Cache-Control'da.
 * s-maxage, must-revalidate, proxy-revalidate ve no-cache bu yanıtta yok.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import { edgeCacheControl } from "../src/server/cache-control.js";
import { clearHtmlCache } from "../src/server/html-cache.js";
import { sendOgImage } from "../src/server/og-image.js";
import { route } from "../src/server/render.js";

const VIEWS = path.join(import.meta.dirname, "fixtures", "private-app", "views");

const FORBIDDEN = /s-maxage|must-revalidate|proxy-revalidate|\bno-cache\b/;

test("edge cache headers keep the browser at max-age=0", () => {
  const headers = edgeCacheControl(10, 60);
  assert.equal(headers.cacheControl, "public, max-age=0");
  assert.equal(headers.cdnCacheControl, "max-age=10, stale-while-revalidate=60");
  assert.doesNotMatch(headers.cacheControl, FORBIDDEN);
  assert.doesNotMatch(headers.cdnCacheControl, FORBIDDEN);
});

test("staleWhileRevalidate 0 omits the directive", () => {
  const headers = edgeCacheControl(10, 0);
  assert.equal(headers.cacheControl, "public, max-age=0");
  assert.equal(headers.cdnCacheControl, "max-age=10");
});

test("og images use the shared producer with their own durations", async () => {
  const res = createResponse();
  await sendOgImage(res, { title: "Card", format: "svg" });
  assert.equal(res.getHeader("cache-control"), "public, max-age=0");
  assert.equal(
    res.getHeader("cdn-cache-control"),
    "max-age=86400, stale-while-revalidate=604800",
  );
  assert.doesNotMatch(String(res.getHeader("cdn-cache-control")), FORBIDDEN);
});

test("og cacheControl override does not also write CDN-Cache-Control", async () => {
  const res = createResponse();
  await sendOgImage(res, {
    title: "Card",
    format: "svg",
    cacheControl: "private, no-store",
  });
  assert.equal(res.getHeader("cache-control"), "private, no-store");
  assert.equal(res.getHeader("cdn-cache-control"), undefined);
});

test("cache().staleWhileRevalidate is what route() writes", async () => {
  const omitted = await loadTempConfig("html: { '/:path*': 15 }");
  assert.equal(omitted.staleWhileRevalidate, 60);

  /** @type {string[]} */
  const warnings = [];
  const original = console.warn;
  console.warn = (/** @type {unknown[]} */ ...args) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const invalid = await loadTempConfig("staleWhileRevalidate: -5");
    assert.equal(invalid.staleWhileRevalidate, 60);
    assert.match(warnings.join("\n"), /staleWhileRevalidate -5/);
  } finally {
    console.warn = original;
  }

  await loadTempConfig("html: { '/:path*': 10 }, staleWhileRevalidate: 0");
  clearHtmlCache();

  const handler = route(async () => ({ view: "pages/hello", data: { who: "edge" } }));
  const res = createResponse();
  await handler(
    /** @type {any} */ ({
      method: "GET",
      path: "/hello",
      originalUrl: "/hello",
      params: {},
      query: {},
      headers: {},
      get() {
        return undefined;
      },
    }),
    /** @type {any} */ (res),
    () => {},
  );

  assert.equal(res.getHeader("cache-control"), "public, max-age=0");
  assert.equal(res.getHeader("cdn-cache-control"), "max-age=10");
  assert.equal(res.getHeader("x-jskelet-cache"), "MISS");
  assert.doesNotMatch(String(res.getHeader("cache-control")), FORBIDDEN);
  assert.doesNotMatch(String(res.getHeader("cdn-cache-control")), FORBIDDEN);
});

after(() => {
  clearHtmlCache();
});

/**
 * @param {string} body
 * @returns {Promise<import('../src/config/index.js').ResolvedConfig>}
 */
async function loadTempConfig(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-edge-"));
  fs.writeFileSync(
    path.join(root, "jskelet.config.mjs"),
    `export default {
      paths: { views: ${JSON.stringify(VIEWS)} },
      cache() { return { ${body} }; },
    };\n`,
  );
  return loadConfig({ root, force: true });
}

function createResponse() {
  /** @type {Map<string, string>} */
  const headers = new Map();

  return {
    statusCode: 200,
    /** @type {string | undefined} */
    body: undefined,
    /** @param {number} code */
    status(code) {
      this.statusCode = code;
      return this;
    },
    /**
     * @param {string} key
     * @param {unknown} value
     */
    setHeader(key, value) {
      headers.set(key.toLowerCase(), String(value));
      return this;
    },
    /** @param {string} key */
    getHeader(key) {
      return headers.get(key.toLowerCase());
    },
    removeHeader() {
      return this;
    },
    /** @param {string} [value] */
    send(value) {
      this.body = value;
      return this;
    },
    /** @param {string} [value] */
    end(value) {
      if (value !== undefined) this.body = value;
      return this;
    },
  };
}
