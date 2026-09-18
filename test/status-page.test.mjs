/**
 * Durum sayfası: production'da yalın 500, development'ta yığın izi.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, before, test } from "node:test";
import { loadConfig } from "../src/config/index.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "jsk-app");
const previousEnv = process.env.NODE_ENV;

before(async () => {
  await loadConfig({ root: FIXTURE, force: true });
});

afterEach(() => {
  if (previousEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnv;
});

const { renderStatusPage, statusFromError } = await import(
  "../src/server/status-page.js"
);

test("statusFromError: bilinmeyen → 500, statusCode / status okunur", () => {
  assert.equal(statusFromError(new Error("x")), 500);
  assert.equal(statusFromError(Object.assign(new Error("x"), { status: 503 })), 503);
  assert.equal(
    statusFromError(Object.assign(new Error("x"), { statusCode: 429 })),
    429,
  );
  assert.equal(statusFromError(null), 500);
});

test("production 500: yığın izi yok, gömülü sayfa", async () => {
  process.env.NODE_ENV = "production";
  const err = new Error("secret-db-password-leaked");
  const html = await renderStatusPage(500, { error: err });

  assert.match(html, /Something went wrong|Bir hata oluştu/);
  assert.doesNotMatch(html, /secret-db-password-leaked/);
  assert.doesNotMatch(html, /Development only/);
});

test("development 500: mesaj + yığın izi", async () => {
  process.env.NODE_ENV = "development";
  const err = new Error("boom-detail-xyz");
  const html = await renderStatusPage(500, { error: err });

  assert.match(html, /Development only/);
  assert.match(html, /boom-detail-xyz/);
  assert.match(html, /status-page\.test\.mjs/);
});

test("development 404: teşhis sayfası değil", async () => {
  process.env.NODE_ENV = "development";
  const html = await renderStatusPage(404);

  assert.doesNotMatch(html, /Development only/);
  assert.match(html, /Page not found|Sayfa bulunamadı/);
});

test("development 503: cause zinciri basılır", async () => {
  process.env.NODE_ENV = "development";
  const root = new Error("upstream timeout");
  const wrapped = new Error("render failed", { cause: root });
  const html = await renderStatusPage(503, { error: wrapped });

  assert.match(html, /render failed/);
  assert.match(html, /Caused by/);
  assert.match(html, /upstream timeout/);
});
