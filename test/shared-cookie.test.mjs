/**
 * Paylaşımlı cookie Domain seçimi ve writeSharedCookie.
 */
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import {
  requestIsHttps,
  resolveSharedCookieDomain,
  writeSharedCookie,
} from "../src/http/shared-cookie.js";

process.env.JSKELET_SECRET = "test-sirri";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "shared-cookie-app");

before(async () => {
  await loadConfig({ root: FIXTURE, force: true });
});

test("resolveSharedCookieDomain matches registrable roots", () => {
  const roots = [".investvio.com", ".localhost"];
  assert.equal(resolveSharedCookieDomain("tr.investvio.com", roots), ".investvio.com");
  assert.equal(resolveSharedCookieDomain("investvio.com", roots), ".investvio.com");
  assert.equal(resolveSharedCookieDomain("tr.localhost:3000", roots), ".localhost");
  assert.equal(resolveSharedCookieDomain("other.com", roots), null);
});

test("requestIsHttps follows the protocol, not NODE_ENV", () => {
  assert.equal(requestIsHttps({ secure: true }), true);
  assert.equal(
    requestIsHttps({
      secure: false,
      headers: { "x-forwarded-proto": "https, http" },
    }),
    true,
  );
  assert.equal(
    requestIsHttps({ secure: false, headers: { "x-forwarded-proto": "http" } }),
    false,
  );
});

test("writeSharedCookie sets Domain and Secure from https", () => {
  /** @type {Map<string, string | string[]>} */
  const headers = new Map();
  const res = {
    setHeader: (/** @type {string} */ key, /** @type {any} */ value) =>
      headers.set(key.toLowerCase(), value),
    getHeader: (/** @type {string} */ key) => headers.get(key.toLowerCase()),
  };
  const req = {
    secure: false,
    headers: { host: "tr.investvio.com", "x-forwarded-proto": "https" },
    get: (/** @type {string} */ name) =>
      /** @type {any} */ (req.headers)[name.toLowerCase()],
  };

  const result = writeSharedCookie(/** @type {any} */ (res), "sid", "abc123", { req });
  assert.equal(result.ok, true);
  assert.equal(result.domain, ".investvio.com");
  assert.equal(result.handoff, false);

  const setCookie = String(
    Array.isArray(headers.get("set-cookie"))
      ? headers.get("set-cookie")[0]
      : headers.get("set-cookie"),
  );
  assert.match(setCookie, /Domain=\.investvio\.com/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /HttpOnly/);
});

test("writeSharedCookie refuses a large token and asks for handoff", () => {
  const res = {
    setHeader() {},
    getHeader() {
      return undefined;
    },
  };
  const req = {
    secure: true,
    headers: { host: "en.investvio.com" },
    get: (/** @type {string} */ name) =>
      /** @type {any} */ (req.headers)[name.toLowerCase()],
  };

  const jwt = "x".repeat(600);
  const result = writeSharedCookie(/** @type {any} */ (res), "sid", jwt, { req });
  assert.equal(result.ok, false);
  assert.equal(result.handoff, true);
  assert.equal(result.reason, "value-too-large");
});

test("writeSharedCookie without a matching root signals handoff", () => {
  const res = {
    setHeader() {},
    getHeader() {
      return undefined;
    },
  };
  const req = {
    secure: true,
    headers: { host: "alone.example" },
    get: (/** @type {string} */ name) =>
      /** @type {any} */ (req.headers)[name.toLowerCase()],
  };

  const result = writeSharedCookie(/** @type {any} */ (res), "sid", "abc", { req });
  assert.equal(result.ok, false);
  assert.equal(result.handoff, true);
  assert.equal(result.reason, "no-matching-root");
});

after(() => {
  // leave config as-is for other files that reload with force
});
