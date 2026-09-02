/**
 * `trailingSlash` middleware.
 *
 * Açıkken slash'sız yol 308 ile slash'lıya gider; slash'lı yol geçer.
 * Kapalıyken (varsayılan) hiçbir istek dokunulmaz.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import {
  skipTrailingSlash,
  trailingSlash,
} from "../src/server/middleware/trailing-slash.js";

const ON = path.join(import.meta.dirname, "fixtures", "trailing-slash-app");
const OFF = path.join(import.meta.dirname, "fixtures", "csrf-app");

/**
 * @param {string} pathname
 * @param {string} [originalUrl]
 */
async function run(pathname, originalUrl = pathname) {
  const handler = trailingSlash();
  const req = /** @type {any} */ ({
    path: pathname,
    originalUrl,
  });

  /** @type {{ status?: number, location?: string }} */
  const result = {};
  let nexted = false;

  const res = /** @type {any} */ ({
    redirect(/** @type {number} */ status, /** @type {string} */ location) {
      result.status = status;
      result.location = location;
    },
  });

  await handler(req, res, () => {
    nexted = true;
  });

  return { ...result, nexted };
}

test("skipTrailingSlash: root, files and .well-known", () => {
  assert.equal(skipTrailingSlash("/"), true);
  assert.equal(skipTrailingSlash("/favicon.ico"), true);
  assert.equal(skipTrailingSlash("/assets/app.js"), true);
  assert.equal(skipTrailingSlash("/.well-known/acme-challenge/x"), true);
  assert.equal(skipTrailingSlash("/.well-known"), true);
  assert.equal(skipTrailingSlash("/hakkinda"), false);
  assert.equal(skipTrailingSlash("/blog/yazi"), false);
});

test("trailingSlash off: every path passes through", async () => {
  await loadConfig({ root: OFF, force: true });

  const bare = await run("/hakkinda");
  assert.equal(bare.nexted, true);
  assert.equal(bare.status, undefined);

  const slashed = await run("/hakkinda/");
  assert.equal(slashed.nexted, true);
});

test("trailingSlash on: bare path 308 to slash form", async () => {
  await loadConfig({ root: ON, force: true });

  const result = await run("/hakkinda");
  assert.equal(result.nexted, false);
  assert.equal(result.status, 308);
  assert.equal(result.location, "/hakkinda/");
});

test("trailingSlash on: query string is kept", async () => {
  await loadConfig({ root: ON, force: true });

  const result = await run("/arama", "/arama?q=jskelet&page=2");
  assert.equal(result.status, 308);
  assert.equal(result.location, "/arama/?q=jskelet&page=2");
});

test("trailingSlash on: already-slashed path is 200 path (next)", async () => {
  await loadConfig({ root: ON, force: true });

  const result = await run("/hakkinda/");
  assert.equal(result.nexted, true);
  assert.equal(result.status, undefined);
});

test("trailingSlash on: static and well-known are not redirected", async () => {
  await loadConfig({ root: ON, force: true });

  for (const pathName of [
    "/",
    "/robots.txt",
    "/assets/app.js",
    "/.well-known/security.txt",
  ]) {
    const result = await run(pathName);
    assert.equal(result.nexted, true, pathName);
    assert.equal(result.status, undefined, pathName);
  }
});
