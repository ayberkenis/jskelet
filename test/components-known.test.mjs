/**
 * Named export tarama ve bilinen bileşen keşfi.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CompileError,
  collectKnownComponents,
  scanNamedExports,
  toComponentTag,
} from "../src/compile/index.js";
import { loadComponents } from "../src/views/components/loader.js";

describe("scanNamedExports", () => {
  it("reads function, const and export-list names", () => {
    const names = scanNamedExports(`
      import { x } from "./x.js";
      // export function ignored() {}
      export function sectionHead() {}
      export const pill = () => "";
      export { format, card as CardShell } from "../lib.js";
      export default function nope() {}
    `);
    assert.deepEqual(names.sort(), ["CardShell", "format", "pill", "sectionHead"]);
  });
});

describe("collectKnownComponents", () => {
  it("uses export names, not the file basename", () => {
    const root = mkdtempSync(path.join(tmpdir(), "jsk-known-"));
    try {
      const components = path.join(root, "components");
      mkdirSync(components);
      writeFileSync(
        path.join(components, "ui.js"),
        `export function sectionHead() { return ""; }\nexport function card() { return ""; }\n`,
      );
      const known = collectKnownComponents([components], new Map());
      assert.ok(known.has("sectionHead"));
      assert.ok(known.has("SectionHead"));
      assert.ok(known.has("card"));
      assert.ok(known.has("Card"));
      assert.equal(known.has("Ui"), false);
      assert.equal(known.has("ui"), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when the same export appears in two files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "jsk-dup-"));
    try {
      const components = path.join(root, "components");
      mkdirSync(components);
      writeFileSync(
        path.join(components, "a.js"),
        `export function card() { return "a"; }\n`,
      );
      writeFileSync(
        path.join(components, "b.js"),
        `export function card() { return "b"; }\n`,
      );
      assert.throws(
        () => collectKnownComponents([components], new Map()),
        (error) =>
          error instanceof CompileError &&
          /defined twice/.test(error.message) &&
          /card/.test(error.message),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws when camelCase and PascalCase collide across files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "jsk-tag-"));
    try {
      const components = path.join(root, "components");
      mkdirSync(components);
      writeFileSync(
        path.join(components, "a.js"),
        `export function card() { return "a"; }\n`,
      );
      writeFileSync(
        path.join(components, "b.js"),
        `export function Card() { return "b"; }\n`,
      );
      assert.throws(
        () => collectKnownComponents([components], new Map()),
        (error) =>
          error instanceof CompileError && /defined twice/.test(error.message),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("toComponentTag", () => {
  it("uppercases only the first character", () => {
    assert.equal(toComponentTag("sectionHead"), "SectionHead");
    assert.equal(toComponentTag("Card"), "Card");
  });
});

describe("loadComponents", () => {
  it("throws on duplicate named exports across files", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "jsk-load-"));
    try {
      const components = path.join(root, "components");
      mkdirSync(components);
      writeFileSync(
        path.join(components, "a.js"),
        `export function card() { return "a"; }\n`,
      );
      writeFileSync(
        path.join(components, "b.js"),
        `export function card() { return "b"; }\n`,
      );
      await assert.rejects(
        () => loadComponents(components),
        (error) =>
          error instanceof Error &&
          /defined twice/.test(error.message) &&
          /card/.test(error.message),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows a component file to override the barrel", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "jsk-barrel-"));
    try {
      const components = path.join(root, "components");
      mkdirSync(components);
      writeFileSync(
        path.join(components, "index.js"),
        `export function card() { return "barrel"; }\n`,
      );
      writeFileSync(
        path.join(components, "card.js"),
        `export function card() { return "file"; }\n`,
      );
      const loaded = await loadComponents(components);
      assert.equal(/** @type {() => string} */ (loaded.card)(), "file");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
