/**
 * Query parametreli isteklerin cache davranışı.
 *
 * Varsayılan "query varsa dinamik" kararı sessiz bir regresyon adayı: bir
 * yolun bütün `?utm_source=…` varyantlarının cache'lenmesi hiçbir yerde hata
 * olarak görünmez, yalnızca LRU'daki gerçek sayfalar kaybolur.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, before, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import { clearHtmlCache, getHtmlCacheSize } from "../src/server/html-cache.js";
import { route } from "../src/server/render.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "private-app");

before(async () => {
  await loadConfig({ root: FIXTURE, force: true });
});

afterEach(() => {
  clearHtmlCache();
});

/**
 * @param {string} pathname
 * @param {Record<string, string>} [query]
 */
function createRequest(pathname, query = {}) {
  return {
    method: "GET",
    path: pathname,
    originalUrl: pathname,
    params: {},
    query,
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

/** @param {string} who */
function page(who) {
  return route(async (ctx) => ({
    view: "pages/hello",
    data: { who: `${who}:${ctx.query.q ?? ""}` },
  }));
}

test("a request without query is cached as before", async () => {
  const handler = page("plain");

  const first = await run(handler, createRequest("/hello"));
  assert.equal(first.error, null);
  assert.equal(first.res.getHeader("x-jskelet-cache"), "MISS");
  assert.equal(getHtmlCacheSize(), 1);

  const second = await run(handler, createRequest("/hello"));
  assert.equal(second.res.getHeader("x-jskelet-cache"), "HIT");
});

test("a query parameter makes the page dynamic by default", async () => {
  const handler = page("dinamik");

  const { res, error } = await run(
    handler,
    createRequest("/hello", { utm_source: "x" }),
  );

  assert.equal(error, null);
  assert.equal(res.getHeader("cache-control"), "private, no-store");
  assert.equal(res.getHeader("x-jskelet-cache"), undefined);
  assert.equal(getHtmlCacheSize(), 0, "an unlisted parameter must not be stored");
});

test("allowed parameters are cached, one entry per distinct value", async () => {
  const handler = page("arama");

  const first = await run(handler, createRequest("/search", { q: "a" }));
  assert.equal(first.res.getHeader("x-jskelet-cache"), "MISS");
  assert.match(
    String(first.res.getHeader("cache-control")),
    /^public, max-age=0, s-maxage=60/,
  );

  const repeat = await run(handler, createRequest("/search", { q: "a" }));
  assert.equal(repeat.res.getHeader("x-jskelet-cache"), "HIT");

  const other = await run(handler, createRequest("/search", { q: "b" }));
  assert.equal(other.res.getHeader("x-jskelet-cache"), "MISS");
  assert.equal(getHtmlCacheSize(), 2);
});

test("parameter order does not create a second entry", async () => {
  const handler = page("sira");

  await run(handler, createRequest("/search", { q: "a", page: "2" }));
  const second = await run(handler, createRequest("/search", { page: "2", q: "a" }));

  assert.equal(second.res.getHeader("x-jskelet-cache"), "HIT");
  assert.equal(getHtmlCacheSize(), 1);
});

test("an unlisted parameter alongside an allowed one is ignored, not dynamic", async () => {
  const handler = page("kampanya");

  await run(handler, createRequest("/search", { q: "a" }));
  const tagged = await run(
    handler,
    createRequest("/search", { q: "a", utm_source: "newsletter" }),
  );

  assert.equal(
    tagged.res.getHeader("x-jskelet-cache"),
    "HIT",
    "campaign parameters must share the copy of the allowed key",
  );
  assert.equal(getHtmlCacheSize(), 1);
});

test("true means every parameter belongs to the key", async () => {
  const handler = page("hepsi");

  const first = await run(handler, createRequest("/all", { anything: "1" }));
  assert.equal(first.res.getHeader("x-jskelet-cache"), "MISS");

  const second = await run(handler, createRequest("/all", { anything: "2" }));
  assert.equal(second.res.getHeader("x-jskelet-cache"), "MISS");
  assert.equal(getHtmlCacheSize(), 2);
});

test("an empty list ignores the query entirely", async () => {
  const handler = page("yoksay");

  await run(handler, createRequest("/ignore"));
  const tagged = await run(handler, createRequest("/ignore", { utm_source: "x" }));

  assert.equal(tagged.res.getHeader("x-jskelet-cache"), "HIT");
  assert.equal(getHtmlCacheSize(), 1);
});
