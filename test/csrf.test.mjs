/**
 * CSRF middleware'i.
 *
 * İki davranış özellikle önemli ve kolay bozulur: çapraz site olduğu **belli
 * olmayan** isteğin geçmesi (webhook'lar `Origin` göndermez) ve muaf yolların
 * gerçekten muaf olması.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { before, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import { setSignedCookie } from "../src/http/cookies.js";
import { csrf } from "../src/server/middleware/csrf.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "csrf-app");
const HOST = "app.example.com";

/** @type {import('express').RequestHandler} */
let handler;

before(async () => {
  await loadConfig({ root: FIXTURE, force: true });
  handler = csrf();
});

/**
 * Geçerli bir token cookie'si üretir: imzalama mantığını taklit etmek yerine
 * gerçek yazma yolunu kullanıyoruz.
 *
 * @param {string} token
 * @returns {string}
 */
function tokenCookie(token) {
  /** @type {string[]} */
  let written = [];
  const res = /** @type {any} */ ({
    setHeader: (/** @type {string} */ _key, /** @type {any} */ value) => {
      written = Array.isArray(value) ? value.map(String) : [String(value)];
    },
    getHeader: () => undefined,
  });

  setSignedCookie(res, "csrf_token", token);
  return written[0].split(";")[0];
}

/**
 * @param {{ method?: string, path?: string, headers?: Record<string, string>,
 *   body?: Record<string, unknown> }} options
 */
async function run(options = {}) {
  const req = /** @type {any} */ ({
    method: options.method ?? "POST",
    path: options.path ?? "/kaydet",
    originalUrl: options.path ?? "/kaydet",
    headers: { host: HOST, ...(options.headers ?? {}) },
    body: options.body ?? {},
  });

  let status = 0;
  let nexted = false;

  const res = /** @type {any} */ ({
    status(/** @type {number} */ code) {
      status = code;
      return res;
    },
    setHeader: () => res,
    type: () => res,
    send: () => res,
  });

  const original = console.warn;
  console.warn = () => {};

  try {
    await handler(req, res, () => {
      nexted = true;
    });
  } finally {
    console.warn = original;
  }

  return { status, passed: nexted };
}

test("güvenli metotlar dokunulmaz", async () => {
  const result = await run({ method: "GET", headers: { origin: "https://kotu.example" } });
  assert.equal(result.passed, true);
});

test("aynı origin ve geçerli token geçer", async () => {
  const result = await run({
    headers: {
      origin: `https://${HOST}`,
      "sec-fetch-site": "same-origin",
      cookie: tokenCookie("t1"),
    },
    body: { _csrf: "t1" },
  });

  assert.equal(result.passed, true);
});

test("yabancı origin reddedilir", async () => {
  const result = await run({
    headers: { origin: "https://kotu.example", cookie: tokenCookie("t1") },
    body: { _csrf: "t1" },
  });

  assert.equal(result.passed, false);
  assert.equal(result.status, 403);
});

test("izin verilen ek origin geçer", async () => {
  const result = await run({
    headers: {
      origin: "https://admin.example.com",
      cookie: tokenCookie("t1"),
    },
    body: { _csrf: "t1" },
  });

  assert.equal(result.passed, true);
});

test("sec-fetch-site cross-site reddedilir", async () => {
  const result = await run({
    headers: { "sec-fetch-site": "cross-site", cookie: tokenCookie("t1") },
    body: { _csrf: "t1" },
  });

  assert.equal(result.passed, false);
  assert.equal(result.status, 403);
});

test("token eksikse reddedilir", async () => {
  const result = await run({
    headers: { origin: `https://${HOST}`, cookie: tokenCookie("t1") },
  });

  assert.equal(result.passed, false);
  assert.equal(result.status, 403);
});

test("token uyuşmuyorsa reddedilir", async () => {
  const result = await run({
    headers: { origin: `https://${HOST}`, cookie: tokenCookie("t1") },
    body: { _csrf: "baska" },
  });

  assert.equal(result.passed, false);
  assert.equal(result.status, 403);
});

test("token başlıktan da okunur", async () => {
  const result = await run({
    headers: {
      origin: `https://${HOST}`,
      cookie: tokenCookie("t1"),
      "x-csrf-token": "t1",
    },
  });

  assert.equal(result.passed, true);
});

test("muaf yol hiçbir kontrole girmez", async () => {
  const result = await run({
    path: "/webhook/stripe",
    headers: { origin: "https://kotu.example" },
  });

  assert.equal(result.passed, true);
});

test("origin bilgisi hiç yoksa geçer ama token yine gerekir", async () => {
  // Webhook tarzı istek: tarayıcı başlığı yok. Origin katmanı geçirir,
  // token katmanı durdurur — bu yüzden webhook uçları muaf listeye girer.
  const withoutToken = await run({});
  assert.equal(withoutToken.passed, false);

  const withToken = await run({
    headers: { cookie: tokenCookie("t1") },
    body: { _csrf: "t1" },
  });
  assert.equal(withToken.passed, true);
});
