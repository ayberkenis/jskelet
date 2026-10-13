/**
 * On-demand cache: `prewarm: false` — ziyaret yazımı, arka plan ısıtması yok.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config/index.js";

const ON_DEMAND = path.join(
  import.meta.dirname,
  "fixtures",
  "prewarm-ondemand-app",
);
const PATHS_CONFLICT = path.join(
  import.meta.dirname,
  "fixtures",
  "prewarm-ondemand-paths-conflict-app",
);

test("prewarm: false resolves to mode off", async () => {
  const config = await loadConfig({ root: ON_DEMAND, force: true });
  assert.equal(config.prewarm.mode, "off");
  assert.equal(config.prewarm.enabled, false);
  assert.equal(config.prewarm.onVisit.enabled, false);
  assert.equal(config.html.length, 2);
  assert.equal(config.html[0].seconds, 60);
  assert.equal(config.html[1].seconds, 300);
});

test("prewarm: false plus hooks.prewarmPaths is rejected", async () => {
  await assert.rejects(
    () => loadConfig({ root: PATHS_CONFLICT, force: true }),
    /prewarmPaths\(\) cannot be used with cache\(\)\.prewarm: false/,
  );
});

test("invalid prewarm type is rejected", async () => {
  const root = path.join(
    import.meta.dirname,
    "fixtures",
    "prewarm-ondemand-invalid-app",
  );
  await assert.rejects(
    () => loadConfig({ root, force: true }),
    /cache\(\)\.prewarm must be false, or an object/,
  );
});
