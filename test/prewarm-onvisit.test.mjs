/**
 * Ziyaret tabanlı ısıtma: link çıkarımı ve klasik ayarlarla karşılıklı dışlama.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import {
  extractSameOriginLinks,
  isOnVisitPrewarm,
} from "../src/server/prewarm.js";

const ON_VISIT = path.join(import.meta.dirname, "fixtures", "prewarm-onvisit-app");
const CONFLICT = path.join(
  import.meta.dirname,
  "fixtures",
  "prewarm-onvisit-conflict-app",
);
const PATHS_CONFLICT = path.join(
  import.meta.dirname,
  "fixtures",
  "prewarm-onvisit-paths-conflict-app",
);

test("onVisit config loads without classic prewarm fields", async () => {
  const config = await loadConfig({ root: ON_VISIT, force: true });
  assert.equal(config.prewarm.onVisit.enabled, true);
  assert.equal(config.prewarm.onVisit.perPage, 5);
  assert.equal(config.prewarm.onVisit.concurrency, 2);
  assert.equal(config.prewarm.onVisit.rps, 3);
  assert.equal(isOnVisitPrewarm(), true);
});

test("onVisit plus classic max is rejected", async () => {
  await assert.rejects(
    () => loadConfig({ root: CONFLICT, force: true }),
    /onVisit cannot be combined with classic/,
  );
});

test("onVisit plus hooks.prewarmPaths is rejected", async () => {
  await assert.rejects(
    () => loadConfig({ root: PATHS_CONFLICT, force: true }),
    /prewarmPaths\(\) cannot be used with cache\(\)\.prewarm\.onVisit/,
  );
});

test("extractSameOriginLinks keeps document order and skips exempts", async () => {
  await loadConfig({ root: ON_VISIT, force: true });

  const html = `
    <a href="/ilk">a</a>
    <a href="https://dis.ornek/x">ext</a>
    <a href="/ikinci">b</a>
    <a href="/cikis">logout</a>
    <a href="/panel/ayarlar">panel</a>
    <a href="/api/x">api</a>
    <a href="/ucuncu" target="_blank">blank</a>
    <a href="/dorduncu" rel="nofollow">nf</a>
    <a href="/besinci" data-no-prefetch>skip</a>
    <a href="../goreli">rel</a>
    <a href="/ilk">dup</a>
    <a href="mailto:a@b.c">mail</a>
  `;

  const links = extractSameOriginLinks(html, {
    limit: 10,
    basePath: "/bolum/sayfa",
  });

  assert.deepEqual(links, ["/ilk", "/ikinci", "/goreli"]);
});

test("extractSameOriginLinks respects perPage limit", async () => {
  await loadConfig({ root: ON_VISIT, force: true });

  const html = ["a", "b", "c", "d", "e", "f"]
    .map((slug) => `<a href="/${slug}">${slug}</a>`)
    .join("");

  // Fixture perPage is 5; explicit limit wins.
  assert.equal(extractSameOriginLinks(html, { limit: 3 }).length, 3);
  assert.deepEqual(extractSameOriginLinks(html, { limit: 3 }), [
    "/a",
    "/b",
    "/c",
  ]);
});
