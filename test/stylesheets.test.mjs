/**
 * `stylesheets()`: varsayılan render-blocking link ve `blocking: false`
 * (`media="print"` + onload + noscript).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import { stylesheets } from "../src/views/helpers/tags.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-stylesheets-"));

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("stylesheets blocking default and media=print opt-out", async () => {
  fs.mkdirSync(path.join(root, ".jskelet"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".jskelet", "manifest.json"),
    JSON.stringify({
      "app.css": "/assets/app.abc123.css",
      "home.css": "/assets/home.def456.css",
    }),
  );
  fs.writeFileSync(
    path.join(root, "jskelet.config.mjs"),
    "export default {};\n",
  );

  await loadConfig({ root, force: true });

  const app = "/assets/app.abc123.css";
  const home = "/assets/home.def456.css";
  const blocking = [
    `<link rel="stylesheet" href="${app}" data-jskelet-css="app.css">`,
    `<link rel="stylesheet" href="${home}" data-jskelet-css="home.css">`,
  ].join("\n    ");

  assert.equal(stylesheets(), `<link rel="stylesheet" href="${app}" data-jskelet-css="app.css">`);
  assert.equal(stylesheets({ styles: ["home.css"] }), blocking);
  assert.equal(stylesheets({ styles: ["home.css"], blocking: true }), blocking);
  assert.equal(
    stylesheets({ styles: ["", "missing.css", "home.css"] }),
    blocking,
  );

  const asyncSheet = (href, name) =>
    [
      `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'" data-jskelet-css="${name}">`,
      `<noscript><link rel="stylesheet" href="${href}" data-jskelet-css="${name}"></noscript>`,
    ].join("\n    ");

  assert.equal(
    stylesheets({ styles: ["home.css", "missing.css"], blocking: false }),
    [asyncSheet(app, "app.css"), asyncSheet(home, "home.css")].join("\n    "),
  );
});
