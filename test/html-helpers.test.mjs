/**
 * `esc` / `attrs` hot-path birim testleri.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attrs, esc, formatDate } from "../src/views/helpers/html.js";

describe("html helpers", () => {
  it("formatDate matches toLocaleDateString", () => {
    const options = { day: "numeric", month: "long", year: "numeric" };
    for (const value of ["2026-01-05T10:00:00Z", 0, new Date(2024, 1, 29)]) {
      assert.equal(
        formatDate(value, "tr-TR", options),
        new Date(value).toLocaleDateString("tr-TR", options),
      );
      assert.equal(formatDate(value), new Date(value).toLocaleDateString());
    }
  });

  it("formatDate returns an empty string for missing or invalid dates", () => {
    assert.equal(formatDate(null), "");
    assert.equal(formatDate(undefined), "");
    assert.equal(formatDate(""), "");
    assert.equal(formatDate("tarih değil"), "");
  });

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
