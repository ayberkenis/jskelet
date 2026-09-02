/**
 * `.jsk` derleyici birim testleri.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, after } from "node:test";
import {
  CompileError,
  compileSource,
  compileAll,
  parseTemplate,
} from "../src/compile/index.js";
import { esc } from "../src/views/helpers/html.js";

/**
 * @param {string} source
 * @param {Record<string, unknown>} data
 * @param {Record<string, unknown>} [extraHelpers]
 */
async function renderCompiled(source, data, extraHelpers = {}) {
  const { code } = compileSource(source, { viewId: "pages/test" });
  const dir = mkdtempSync(path.join(tmpdir(), "jsk-"));
  const file = path.join(dir, "test.mjs");
  writeFileSync(file, code);
  try {
    const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
    return mod.render(data, { esc, ...extraHelpers });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("jsk compile", () => {
  it("renders static HTML and escaped text", async () => {
    const html = await renderCompiled(`<p class="x">{{ name }}</p>`, {
      name: `<script>`,
    });
    assert.equal(html, `<p class="x">&lt;script&gt;</p>`);
  });

  it("renders raw HTML with {{{ }}}", async () => {
    const html = await renderCompiled(`<div>{{{ html }}}</div>`, {
      html: `<em>ok</em>`,
    });
    assert.equal(html, `<div><em>ok</em></div>`);
  });

  it("binds attributes and boolean attrs", async () => {
    const html = await renderCompiled(
      `<input :value="name" disabled :open="isOpen" />`,
      { name: `a"b`, isOpen: false },
      {
        attrs: (obj) => {
          const parts = [];
          for (const [k, v] of Object.entries(obj)) {
            if (v == null || v === false) continue;
            if (v === true) parts.push(k);
            else parts.push(`${k}="${esc(v)}"`);
          }
          return parts.length ? ` ${parts.join(" ")}` : "";
        },
      },
    );
    assert.match(html, /value="a&quot;b"/);
    assert.match(html, /\bdisabled\b/);
    assert.doesNotMatch(html, /\bopen\b/);
  });

  it("renders components with props and children", async () => {
    const html = await renderCompiled(
      `<Card title="Hi"><p>{{ body }}</p></Card>`,
      { body: "x" },
      {
        Card: ({ title, children }) =>
          `<section data-title="${esc(title)}">${children}</section>`,
      },
    );
    assert.equal(html, `<section data-title="Hi"><p>x</p></section>`);
  });

  it("supports if/else and each", async () => {
    const withItems = await renderCompiled(
      `{#if items.length}{#each items as item}<i>{{ item }}</i>{/each}{#else}empty{/if}`,
      { items: ["a", "b"] },
    );
    assert.equal(withItems, `<i>a</i><i>b</i>`);

    const empty = await renderCompiled(
      `{#if items.length}{#each items as item}<i>{{ item }}</i>{/each}{#else}empty{/if}`,
      { items: [] },
    );
    assert.equal(empty, `empty`);
  });

  it("rejects unknown syntax with location", () => {
    assert.throws(
      () => parseTemplate(`{#wat}`, { file: "x.jsk" }),
      (err) => {
        assert.ok(err instanceof CompileError);
        assert.match(err.message, /Unknown directive/);
        assert.match(err.message, /x\.jsk/);
        return true;
      },
    );
  });

  it("rejects invalid each heads", () => {
    assert.throws(
      () => parseTemplate(`{#each items}x{/each}`),
      /Invalid \{#each\}/,
    );
  });

  it("compileAll writes modules and manifest", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "jsk-app-"));
    mkdirSync(path.join(root, "views", "pages"), { recursive: true });
    mkdirSync(path.join(root, ".jskelet"), { recursive: true });
    writeFileSync(
      path.join(root, "views", "pages", "home.jsk"),
      `<h1>{{ title }}</h1>\n`,
    );

    try {
      const result = await compileAll({
        root,
        dirs: {
          views: path.join(root, "views"),
          generated: path.join(root, ".jskelet"),
          features: path.join(root, "features"),
          shared: path.join(root, "shared"),
        },
      });
      assert.equal(result.count, 1);
      assert.ok(result.manifest["pages/home"]);
      const code = readFileSync(
        path.join(root, ".jskelet", "templates", "pages", "home.mjs"),
        "utf8",
      );
      assert.match(code, /export function render/);
      assert.doesNotMatch(code, /\beval\b/);
      assert.doesNotMatch(code, /new Function/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

after(() => {
  // no-op: temp dirs cleaned per test
});
