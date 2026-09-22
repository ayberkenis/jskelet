/**
 * Config istediği sayıyı yazar; framework bellek ve onVisit tavanına çeker.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config/index.js";

const CEILING = path.join(import.meta.dirname, "fixtures", "cache-ceiling-app");

test("oversized cache and onVisit settings are clamped", async () => {
  /** @type {string[]} */
  const warnings = [];
  const original = console.warn;
  console.warn = (/** @type {unknown[]} */ ...args) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    const config = await loadConfig({ root: CEILING, force: true });
    assert.equal(config.htmlMaxEntries, 800);
    assert.equal(config.data.maxEntries, 20000);
    assert.equal(config.data.staleFactor, 10);
    assert.equal(config.prewarm.onVisit.perPage, 20);
    assert.equal(config.prewarm.onVisit.rps, 2);
    assert.equal(config.prewarm.onVisit.concurrency, 2);
    assert.equal(config.prewarm.onVisit.enabled, true);

    const text = warnings.join("\n");
    assert.match(text, /cache\(\)\.maxEntries 2500 exceeds the ceiling of 800/);
    assert.match(text, /cache\(\)\.data\.maxEntries 50000 exceeds the ceiling of 20000/);
    assert.match(text, /onVisit\.perPage 100 exceeds the ceiling of 20/);
    assert.match(text, /onVisit\.rps 10 exceeds the ceiling of 2/);
    assert.match(text, /onVisit\.concurrency 8 exceeds the ceiling of 2/);
  } finally {
    console.warn = original;
  }
});
