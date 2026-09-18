/**
 * Client entry keşfi: .ts/.mts kabulü, manifest anahtarı, çakışma hatası.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  entryManifestName,
  listClientEntries,
} from "../src/build/tasks/client.mjs";

test("entryManifestName normalizes .ts and .mts to .js keys", () => {
  assert.equal(entryManifestName("client/entries/main.ts"), "main.js");
  assert.equal(entryManifestName("client/entries/chart.mts"), "chart.js");
  assert.equal(entryManifestName("client/entries/main.js"), "main.js");
});

test("listClientEntries accepts .js and .ts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-entries-"));
  try {
    fs.writeFileSync(path.join(dir, "main.ts"), "");
    fs.writeFileSync(path.join(dir, "chart.js"), "");
    fs.writeFileSync(path.join(dir, "readme.md"), "");
    const entries = listClientEntries(dir).map((p) => path.basename(p)).sort();
    assert.deepEqual(entries, ["chart.js", "main.ts"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("listClientEntries rejects stem conflicts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-entries-"));
  try {
    fs.writeFileSync(path.join(dir, "main.js"), "");
    fs.writeFileSync(path.join(dir, "main.ts"), "");
    assert.throws(
      () => listClientEntries(dir),
      /conflicting client entries for "main"/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
