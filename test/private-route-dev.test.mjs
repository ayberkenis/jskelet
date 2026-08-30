/**
 * Dev'de kimlik sızıntısı sessiz bir uyarı değil, hatadır.
 *
 * Ayrı dosya olmasının sebebi `NODE_ENV`: render katmanı dev olup olmadığını
 * modül yüklenirken bir kez okuyor, bu yüzden ortam değişkeni statik
 * import'lardan önce ayarlanmalı ve testler ayrı bir süreçte koşmalı.
 */
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";

process.env.NODE_ENV = "development";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "private-app");

const { loadConfig } = await import("../src/config/index.js");
const { getHtmlCacheSize } = await import("../src/server/html-cache.js");
const { route } = await import("../src/server/render.js");

await loadConfig({ root: FIXTURE, force: true });

test("in dev, a cacheable route that reads cookies throws", async () => {
  const handler = route(async (ctx) => ({
    view: "pages/hello",
    data: { who: ctx.req.headers.cookie ?? "anonim" },
  }));

  /** @type {unknown} */
  let captured = null;

  await handler(
    /** @type {any} */ ({
      method: "GET",
      path: "/dev-sizinti",
      originalUrl: "/dev-sizinti",
      params: {},
      query: {},
      headers: { cookie: "session=abc" },
    }),
    /** @type {any} */ ({
      status: () => {},
      setHeader: () => {},
      getHeader: () => undefined,
      send: () => {},
      end: () => {},
    }),
    (error) => {
      captured = error;
    },
  );

  assert.ok(captured instanceof Error, "the error must reach the middleware chain");
  assert.match(String(captured.message), /private: true/);
  assert.match(String(captured.message), /req\.headers\.cookie/);
  assert.equal(getHtmlCacheSize(), 0);
});
