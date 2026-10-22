/**
 * Gerçek bir HTTP sunucusu üzerinden: ETag/304 sıkıştırılmış yolda da
 * çalışır, kişiye özel yanıt doğrulayıcı taşımaz, 103 Early Hints yalnızca
 * açıkken ve render beklenecekken gider.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import express from "express";
import { loadConfig } from "../src/config/index.js";
import { clearHtmlCache, settleHtmlCacheWrites } from "../src/server/html-cache.js";
import { compression } from "../src/server/middleware/compression.js";
import { route } from "../src/server/render.js";

const VIEWS = path.join(import.meta.dirname, "fixtures", "private-app", "views");

/** @type {http.Server} */
let server;
let base = "";

before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-validators-"));
  fs.writeFileSync(
    path.join(root, "jskelet.config.mjs"),
    `export default {
      paths: { views: ${JSON.stringify(VIEWS)} },
      preconnect: ["https://cdn.example.com"],
      earlyHints: true,
      cache() { return { html: { "/public": 60 } }; },
    };\n`,
  );
  await loadConfig({ root, force: true });
  clearHtmlCache();

  const app = express();
  app.use(compression());
  app.get(
    "/public",
    route(async () => ({ view: "pages/hello", data: { who: "herkes" } })),
  );
  app.get(
    "/private",
    route(async () => ({ view: "pages/hello", data: { who: "ayşe" } }), { private: true }),
  );

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await settleHtmlCacheWrites();
  clearHtmlCache();
  await new Promise((resolve) => server.close(resolve));
});

/**
 * @param {string} pathname
 * @param {Record<string, string>} [headers]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders,
 *   body: Buffer, hints: string[] }>}
 */
function get(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    /** @type {string[]} */
    const hints = [];
    const req = http.get(`${base}${pathname}`, { headers }, (res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
          hints,
        }),
      );
    });
    req.on("information", (info) => {
      if (info.statusCode !== 103) return;
      const link = info.headers.link;
      hints.push(...(Array.isArray(link) ? link : String(link).split(/,\s*(?=<)/)));
    });
    req.on("error", reject);
  });
}

test("a brotli response carries an ETag and revalidates to 304", async () => {
  const first = await get("/public", { "accept-encoding": "br" });
  assert.equal(first.status, 200);
  assert.equal(first.headers["content-encoding"], "br");
  const etag = first.headers.etag;
  assert.match(String(etag), /^W\/"/);

  await settleHtmlCacheWrites();
  const again = await get("/public", { "accept-encoding": "br", "if-none-match": String(etag) });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  assert.equal(again.headers["content-encoding"], undefined, "304 gövde taşımaz");
  assert.equal(again.headers.etag, etag);
});

test("the validator is the same for every encoding of one page", async () => {
  const br = await get("/public", { "accept-encoding": "br" });
  const gzip = await get("/public", { "accept-encoding": "gzip" });
  const plain = await get("/public");
  assert.equal(br.headers.etag, gzip.headers.etag);
  assert.equal(br.headers.etag, plain.headers.etag);

  // Ham yoldan alınmış doğrulayıcı brotli istekte de geçerli.
  const revalidated = await get("/public", {
    "accept-encoding": "br",
    "if-none-match": String(plain.headers.etag),
  });
  assert.equal(revalidated.status, 304);
});

test("a private page has no validator and never answers 304", async () => {
  const first = await get("/private", { "accept-encoding": "br" });
  assert.equal(first.headers.etag, undefined);
  const again = await get("/private", { "accept-encoding": "br", "if-none-match": "*" });
  assert.equal(again.status, 200);
});

test("early hints go out while rendering and not for a cache hit", async () => {
  clearHtmlCache();
  const miss = await get("/public", { "accept-encoding": "br" });
  assert.equal(miss.headers["x-jskelet-cache"], "MISS");
  assert.ok(
    miss.hints.some((link) => link.includes("<https://cdn.example.com>; rel=preconnect")),
    `103 preconnect taşımalı: ${miss.hints.join(" | ")}`,
  );

  const hit = await get("/public", { "accept-encoding": "br" });
  assert.equal(hit.headers["x-jskelet-cache"], "HIT");
  assert.deepEqual(hit.hints, []);

  // Dinamik/private yol her istekte render bekler.
  const priv = await get("/private");
  assert.ok(priv.hints.length > 0);
});