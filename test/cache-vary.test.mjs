/**
 * HTML cache `vary` — host / header / fn parçalarının anahtara girmesi.
 *
 * Host'tan locale üreten sitelerde önek yoksa ilk locale'in HTML'i diğer
 * host'a servis edilir; bu test o sızıntıyı yakalar.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, before, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import {
  clearHtmlCache,
  getHtmlCacheEntries,
  getHtmlCacheSize,
  invalidateHtmlCache,
  isHtmlCacheFresh,
} from "../src/server/html-cache.js";
import { pathOfCacheKey, publicHost } from "../src/server/cache-vary.js";
import { route } from "../src/server/render.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "vary-app");

before(async () => {
  await loadConfig({ root: FIXTURE, force: true });
});

afterEach(() => {
  clearHtmlCache();
});

/**
 * @param {string} pathname
 * @param {{ host?: string, "x-forwarded-host"?: string, "x-locale"?: string }} [headers]
 */
function createRequest(pathname, headers = {}) {
  /** @type {Record<string, string>} */
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value != null) normalized[key.toLowerCase()] = value;
  }

  return {
    method: "GET",
    path: pathname,
    originalUrl: pathname,
    params: {},
    query: {},
    headers: normalized,
    /** @param {string} name */
    get(name) {
      return normalized[name.toLowerCase()];
    },
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
    /**
     * @param {string} key
     * @param {unknown} value
     */
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
    type() {
      return res;
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
 * @param {ReturnType<typeof createRequest>} req
 */
async function run(handler, req) {
  const res = createResponse();
  /** @type {unknown} */
  let error = null;

  await handler(/** @type {any} */ (req), /** @type {any} */ (res), (value) => {
    error = value;
  });

  return { res, error };
}

const handler = route(async () => ({
  view: "pages/hello",
  data: { who: "vary" },
}));

test("publicHost prefers x-forwarded-host and strips the port", () => {
  assert.equal(
    publicHost(createRequest("/", { "x-forwarded-host": "TR.Example.com:443" })),
    "tr.example.com",
  );
  assert.equal(
    publicHost(
      createRequest("/", {
        "x-forwarded-host": "tr.example.com, en.example.com",
        host: "ignored:3000",
      }),
    ),
    "tr.example.com",
  );
  assert.equal(publicHost(createRequest("/", { host: "127.0.0.1:3000" })), "127.0.0.1");
});

test("pathOfCacheKey strips the vary prefix before the path", () => {
  assert.equal(pathOfCacheKey("h=tr.example.com|/instruments/aapl?"), "/instruments/aapl");
  assert.equal(pathOfCacheKey("h=x&x-locale=tr|/list?page=2"), "/list");
  assert.equal(pathOfCacheKey("/plain?"), "/plain");
});

test("different hosts get separate cache entries when vary.host is on", async () => {
  const tr = await run(handler, createRequest("/hello", { host: "tr.example.com" }));
  assert.equal(tr.error, null);
  assert.equal(tr.res.getHeader("x-jskelet-cache"), "MISS");

  const en = await run(handler, createRequest("/hello", { host: "en.example.com" }));
  assert.equal(en.res.getHeader("x-jskelet-cache"), "MISS");
  assert.equal(getHtmlCacheSize(), 2, "locale hosts must not share one HTML entry");

  const trAgain = await run(handler, createRequest("/hello", { host: "tr.example.com" }));
  assert.equal(trAgain.res.getHeader("x-jskelet-cache"), "HIT");

  const keys = getHtmlCacheEntries().map((entry) => entry.key).sort();
  assert.deepEqual(keys, [
    "h=en.example.com&l=en|/hello?",
    "h=tr.example.com&l=tr|/hello?",
  ]);
});

test("invalidate by path hits every host variant", async () => {
  await run(handler, createRequest("/hello", { host: "tr.example.com" }));
  await run(handler, createRequest("/hello", { host: "en.example.com" }));
  assert.equal(getHtmlCacheSize(), 2);

  const affected = invalidateHtmlCache("/hello");
  assert.equal(affected, 2);
});

test("vary.fn contributes a custom segment", async () => {
  // Fixture fn returns l=tr / l=en from Host. Same host header family, different fn output.
  const a = await run(
    handler,
    createRequest("/hello", { host: "tr.example.com", "x-locale": "ignored" }),
  );
  assert.equal(a.res.getHeader("x-jskelet-cache"), "MISS");

  const keys = getHtmlCacheEntries().map((entry) => entry.key);
  assert.ok(
    keys.some((key) => key.startsWith("h=tr.example.com&l=tr|/hello")),
    `expected fn segment in ${keys.join(", ")}`,
  );
});

test("isHtmlCacheFresh follows the request host, not a bare path", async () => {
  await run(handler, createRequest("/hello", { host: "tr.example.com" }));

  assert.equal(
    isHtmlCacheFresh("/hello", createRequest("/hello", { host: "tr.example.com" })),
    true,
  );
  assert.equal(
    isHtmlCacheFresh("/hello", createRequest("/hello", { host: "en.example.com" })),
    false,
  );
});
