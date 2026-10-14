/**
 * `esc` / `attrs` hot-path birim testleri.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attrs, esc } from "../src/views/helpers/html.js";

describe("html helpers", () => {
  it("esc skips replace when no special characters", () => {
    assert.equal(esc("hello"), "hello");
    assert.equal(esc(42), "42");
    assert.equal(esc(null), "");
    assert.equal(esc(false), "");
  });

  it("esc escapes markup characters", () => {
    assert.equal(esc(`<b>"x"&'y'</b>`), "&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/b&gt;");
  });

  it("attrs omits null/false and formats booleans", () => {
    assert.equal(attrs({ a: "1", b: true, c: false, d: null }), ` a="1" b`);
    assert.equal(attrs({}), "");
  });
});
