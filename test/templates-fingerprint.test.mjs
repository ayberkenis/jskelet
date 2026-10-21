/**
 * Şablon parmak izi: layout / bileşen değişince HTML önbelleğinin isim alanı
 * da değişmeli; aynı ağaç aynı kimliği vermeli.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import {
  computeTemplatesFingerprint,
  getTemplatesFingerprint,
  writeTemplatesFingerprint,
} from "../src/build/templates-fingerprint.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-fingerprint-"));

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("fingerprint follows layout, component and EJS sources", async () => {
  const views = path.join(root, "views");
  fs.mkdirSync(path.join(views, "components"), { recursive: true });
  fs.writeFileSync(path.join(root, "jskelet.config.mjs"), "export default {};\n");
  fs.writeFileSync(path.join(views, "layout.jsk"), "<head><Stylesheets /></head>\n");
  fs.writeFileSync(path.join(views, "components", "badge.js"), "export const badge = () => '';\n");

  const config = await loadConfig({ root, force: true });
  const first = computeTemplatesFingerprint(config);
  assert.match(first, /^[0-9a-f]{10}$/);
  assert.equal(computeTemplatesFingerprint(config), first);

  fs.writeFileSync(path.join(views, "layout.jsk"), "<head><Stylesheets :blocking=\"false\" /></head>\n");
  const afterLayout = computeTemplatesFingerprint(config);
  assert.notEqual(afterLayout, first);

  fs.writeFileSync(path.join(views, "components", "badge.js"), "export const badge = () => 'x';\n");
  const afterComponent = computeTemplatesFingerprint(config);
  assert.notEqual(afterComponent, afterLayout);

  fs.writeFileSync(path.join(views, "legacy.ejs"), "<p><%= x %></p>\n");
  assert.notEqual(computeTemplatesFingerprint(config), afterComponent);

  // İlgisiz dosyalar kimliği oynatmaz.
  const before = computeTemplatesFingerprint(config);
  fs.writeFileSync(path.join(views, "notes.md"), "irrelevant\n");
  assert.equal(computeTemplatesFingerprint(config), before);
});

test("runtime reads the recorded fingerprint outside development", async () => {
  const config = await loadConfig({ root, force: true });
  const outDir = path.join(config.dirs.generated, "templates");
  fs.mkdirSync(outDir, { recursive: true });

  const written = writeTemplatesFingerprint(config, outDir);
  assert.equal(written, computeTemplatesFingerprint(config));

  fs.writeFileSync(path.join(outDir, "build.json"), JSON.stringify({ id: "recorded01" }));
  assert.equal(getTemplatesFingerprint(config), "recorded01");
});
