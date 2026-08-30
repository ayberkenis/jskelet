/**
 * `route(fn, { private: true })` ve kimlik sızıntısı koruması.
 *
 * Buradaki testlerin varlık sebebi tek bir şey: kişiye özel bir sayfanın
 * public HTML cache'ine girmesi hiçbir yerde hata olarak görünmez. Sessiz
 * kalan bir regresyonu yakalayacak tek yer bu dosya.
 *
 * `NODE_ENV` ayarlanmadığı için render katmanı üretim davranışında: sızıntı
 * fırlatmaz, uyarır ve önbelleğe yazmaz. Dev'deki fırlatma ayrı bir dosyada
 * (`private-route-dev.test.mjs`) sınanıyor, çünkü karar modül yüklenirken
 * bir kez okunuyor.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, before, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import { clearHtmlCache, getHtmlCacheSize } from "../src/server/html-cache.js";
import { fragment, route } from "../src/server/render.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "private-app");

before(async () => {
  await loadConfig({ root: FIXTURE, force: true });
});

afterEach(() => {
  clearHtmlCache();
});

/**
 * @param {{ path?: string, method?: string, headers?: Record<string, string> }} [options]
 */
function createRequest(options = {}) {
  const headers = options.headers ?? {};

  return {
    method: options.method ?? "GET",
    path: options.path ?? "/hello",
    originalUrl: options.path ?? "/hello",
    params: {},
    query: {},
    headers,
    /** @param {string} name */
    get(name) {
      return headers[name.toLowerCase()];
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
    /** @type {"send" | "end" | "redirect" | null} */
    sentVia: null,
    /** @type {string | null} */
    location: null,
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
      res.sentVia = "send";
      return res;
    },
    /** @param {string} [value] */
    end(value) {
      if (value !== undefined) res.body = value;
      res.sentVia ??= "end";
      return res;
    },
    /**
     * @param {number} code
     * @param {string} location
     */
    redirect(code, location) {
      res.statusCode = code;
      res.location = location;
      res.sentVia = "redirect";
      return res;
    },
    header: headers,
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

  await handler(
    /** @type {any} */ (req),
    /** @type {any} */ (res),
    (value) => {
      error = value;
    },
  );

  return { res, error };
}

/** Sessiz uyarı beklemek yerine uyarıları toplayıp doğruluyoruz. */
function captureWarnings() {
  const original = console.warn;
  /** @type {string[]} */
  const lines = [];

  console.warn = (...args) => {
    lines.push(args.map(String).join(" "));
  };

  return {
    lines,
    restore() {
      console.warn = original;
    },
  };
}

test("a public route is cached through a config pattern", async () => {
  const handler = route(async () => ({ view: "pages/hello", data: { who: "public" } }));

  const first = await run(handler, createRequest());
  assert.equal(first.error, null);
  assert.match(String(first.res.body), /public/);
  assert.equal(first.res.getHeader("cache-control"), "public, max-age=0, s-maxage=60, stale-while-revalidate=60");
  assert.equal(first.res.getHeader("x-jskelet-cache"), "MISS");
  assert.equal(getHtmlCacheSize(), 1);

  const second = await run(handler, createRequest());
  assert.equal(second.res.getHeader("x-jskelet-cache"), "HIT");
});

test("a private route stays out of the cache even with a broad config pattern", async () => {
  const handler = route(
    async () => ({ view: "pages/hello", data: { who: "gizli" } }),
    { private: true },
  );

  const first = await run(handler, createRequest({ path: "/panel" }));
  assert.equal(first.error, null);
  assert.equal(first.res.getHeader("cache-control"), "private, no-store");
  assert.equal(first.res.getHeader("vary"), "Cookie");
  assert.equal(first.res.getHeader("x-jskelet-cache"), undefined);
    assert.equal(getHtmlCacheSize(), 0, "a private route must never be stored");

  // ETag yalnızca `res.send()` yolunda üretilir; private yanıt `end()` ile
  // yazılır ki kullanıcıya özel bir doğrulayıcı basılmasın.
  assert.equal(first.res.sentVia, "end");
  assert.equal(first.res.getHeader("content-length"), String(Buffer.byteLength(String(first.res.body))));

  const second = await run(handler, createRequest({ path: "/panel" }));
  assert.equal(second.res.getHeader("x-jskelet-cache"), undefined);
  assert.equal(getHtmlCacheSize(), 0);
});

test("a cacheable route that reads cookies is not stored and warns", async () => {
  const handler = route(async (ctx) => ({
    view: "pages/hello",
    data: { who: ctx.req.headers.cookie ?? "anonim" },
  }));

  const warnings = captureWarnings();

  try {
    const { res, error } = await run(
      handler,
      createRequest({ path: "/sizinti", headers: { cookie: "session=abc" } }),
    );

    assert.equal(error, null);
    assert.equal(res.getHeader("cache-control"), "private, no-store");
    assert.equal(res.getHeader("vary"), "Cookie");
    assert.equal(getHtmlCacheSize(), 0, "identity-bound output must not be stored");
    assert.ok(
      warnings.lines.some((line) => line.includes("req.headers.cookie")),
      "the warning must name the access that marked the route",
    );
  } finally {
    warnings.restore();
  }
});

test("req.get('authorization') marks the route too", async () => {
  const handler = route(async (ctx) => ({
    view: "pages/hello",
    data: { who: ctx.req.get("Authorization") ?? "anonim" },
  }));

  const warnings = captureWarnings();

  try {
    await run(
      handler,
      createRequest({ path: "/token", headers: { authorization: "Bearer x" } }),
    );

    assert.equal(getHtmlCacheSize(), 0);
    assert.ok(
      warnings.lines.some((line) => line.toLowerCase().includes("authorization")),
      "the marking access must appear in the warning",
    );
  } finally {
    warnings.restore();
  }
});

test("a route that never touches identity is not marked", async () => {
  const handler = route(async (ctx) => ({
    view: "pages/hello",
    data: { who: ctx.req.path },
  }));

  await run(handler, createRequest({ path: "/temiz" }));
  assert.equal(getHtmlCacheSize(), 1, "only cookie/auth access should mark a route");
});

test("a fragment responds without layout, no-store and uncached", async () => {
  const handler = fragment(async () => ({
    view: "partials/rows",
    data: { rows: ["a", "b"] },
  }));

  const { res, error } = await run(handler, createRequest({ path: "/_fragment/rows" }));

  assert.equal(error, null);
  assert.equal(res.getHeader("cache-control"), "private, no-store");
  assert.equal(res.sentVia, "end", "a fragment must not produce an ETag either");
  assert.match(String(res.body), /<li>a<\/li>/);
  assert.doesNotMatch(String(res.body), /<html/, "the layout must not be printed");
  assert.equal(getHtmlCacheSize(), 0);
});

test("a fragment error returns a small piece instead of a whole page", async () => {
  const handler = fragment(async () => {
    throw new Error("the data source went down");
  });

  const originalError = console.error;
  console.error = () => {};

  try {
    const { res } = await run(handler, createRequest({ path: "/_fragment/patlak" }));

    assert.equal(res.statusCode, 500);
    assert.equal(res.getHeader("cache-control"), "private, no-store");
    assert.match(String(res.body), /data-fragment-error/);
    assert.doesNotMatch(String(res.body), /<html/);
  } finally {
    console.error = originalError;
  }
});
