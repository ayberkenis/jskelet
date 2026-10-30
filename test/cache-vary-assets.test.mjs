/**
 * HTML cache `vary.assets` — stylesheet içerik hash'inin anahtara girmesi.
 *
 * Redis DEL zaman aşımında eski HTML aynı anahtardan geri geliyordu; hash
 * anahtardayken CSS değişince bakılan kayıt başkadır ve L1 düşer.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import {
  clearHtmlCache,
  getHtmlCacheEntries,
  isHtmlCacheFresh,
} from "../src/server/html-cache.js";
import { getStylesheetHash } from "../src/server/assets.js";
import { route } from "../src/server/render.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-vary-assets-"));
const generated = path.join(root, ".jskelet");
const views = path.join(root, "views", "pages");

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

fs.mkdirSync(generated, { recursive: true });
fs.mkdirSync(views, { recursive: true });
fs.writeFileSync(path.join(views, "hello.ejs"), "<p><%= who %></p>\n");

/**
 * @param {Record<string, string>} manifest
 */
function writeManifest(manifest) {
  fs.writeFileSync(
    path.join(generated, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

/**
 * @param {Record<string, string>} manifest
 * @returns {string}
 */
function cssHash(manifest) {
  const lines = Object.entries(manifest)
    .filter(([name]) => name.endsWith(".css"))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, url]) => `${name}=${url}`);
  return crypto.createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 10);
}

/**
 * @param {{ assets?: boolean }} [vary]
 */
async function loadApp(vary = {}) {
  const assetsLine =
    vary.assets === false ? "        assets: false,\n" : "";
  fs.writeFileSync(
    path.join(root, "jskelet.config.mjs"),
    `export default {
  cache: () => ({
    html: { "/:path*": 60 },
    vary: {
${assetsLine}    },
    prewarm: { enabled: false },
  }),
};
`,
  );
  await loadConfig({ root, force: true });
  clearHtmlCache();
}

/**
 * @param {string} pathname
 */
function createRequest(pathname) {
  return {
    method: "GET",
    path: pathname,
    originalUrl: pathname,
    params: {},
    query: {},
    headers: { host: "example.com" },
    /** @param {string} name */
    get(name) {
      return name.toLowerCase() === "host" ? "example.com" : undefined;
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

const handler = route(async () => ({
  view: "pages/hello",
  data: { who: "assets" },
}));

/**
 * @param {ReturnType<typeof createRequest>} req
 */
async function run(req) {
  const res = createResponse();
  /** @type {unknown} */
  let error = null;
  await handler(/** @type {any} */ (req), /** @type {any} */ (res), (value) => {
    error = value;
  });
  return { res, error };
}

test("vary.assets puts the stylesheet hash in the HTML cache key", async () => {
  const manifest = {
    "app.css": "/assets/app.aaa111.css",
    "main.js": "/assets/js/main.bbb222.js",
  };
  writeManifest(manifest);
  await loadApp();

  const first = await run(createRequest("/hello"));
  assert.equal(first.error, null);
  assert.equal(first.res.getHeader("x-jskelet-cache"), "MISS");

  const hash = cssHash(manifest);
  assert.equal(getStylesheetHash(), hash);

  const keys = getHtmlCacheEntries().map((entry) => entry.key);
  assert.deepEqual(keys, [`a=${hash}|/hello?`]);

  const again = await run(createRequest("/hello"));
  assert.equal(again.res.getHeader("x-jskelet-cache"), "HIT");
});

test("a CSS hash change drops the previous HTML entry", async () => {
  writeManifest({
    "app.css": "/assets/app.aaa111.css",
    "home.css": "/assets/home.short.css",
  });
  await loadApp();

  await run(createRequest("/hello"));
  assert.equal(
    (await run(createRequest("/hello"))).res.getHeader("x-jskelet-cache"),
    "HIT",
  );
  assert.equal(isHtmlCacheFresh("/hello"), true);

  // Size değişsin diye daha uzun bir hash'li ad — Windows'ta aynı mtime
  // basılırsa stamp yine değişir.
  writeManifest({
    "app.css": "/assets/app.zzz999longer.css",
    "home.css": "/assets/home.short.css",
  });

  const after = await run(createRequest("/hello"));
  assert.equal(after.res.getHeader("x-jskelet-cache"), "MISS");
  assert.equal(getHtmlCacheEntries().length, 1);
  assert.match(getHtmlCacheEntries()[0].key, /^a=[0-9a-f]{10}\|\/hello\?$/);
  assert.notEqual(
    getHtmlCacheEntries()[0].key,
    `a=${cssHash({ "app.css": "/assets/app.aaa111.css", "home.css": "/assets/home.short.css" })}|/hello?`,
  );
});

test("JS-only manifest changes do not rotate the HTML key", async () => {
  writeManifest({
    "app.css": "/assets/app.same.css",
    "main.js": "/assets/js/main.old.js",
  });
  await loadApp();

  await run(createRequest("/hello"));
  const before = getHtmlCacheEntries()[0].key;

  writeManifest({
    "app.css": "/assets/app.same.css",
    "main.js": "/assets/js/main.new-longer.js",
  });

  const again = await run(createRequest("/hello"));
  assert.equal(again.res.getHeader("x-jskelet-cache"), "HIT");
  assert.equal(getHtmlCacheEntries()[0].key, before);
});

test("vary.assets: false keeps the key stable across CSS changes", async () => {
  writeManifest({ "app.css": "/assets/app.one.css" });
  await loadApp({ assets: false });

  await run(createRequest("/hello"));
  assert.equal(getHtmlCacheEntries()[0].key, "/hello?");

  writeManifest({ "app.css": "/assets/app.two-longer.css" });
  const again = await run(createRequest("/hello"));
  assert.equal(again.res.getHeader("x-jskelet-cache"), "HIT");
  assert.equal(getHtmlCacheEntries()[0].key, "/hello?");
});
