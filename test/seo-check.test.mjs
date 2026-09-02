import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gradeTitleLength,
  gradeDescriptionLength,
  gradeImageAlt,
  gradeHeadingSkip,
  trimText,
} from "../src/client/devtools/seo.js";

test("title grades empty, short, long and ok lengths", () => {
  assert.equal(gradeTitleLength("").severity, "error");
  assert.equal(gradeTitleLength("Hi").severity, "warn");
  assert.equal(gradeTitleLength("A".repeat(70)).severity, "warn");
  assert.equal(gradeTitleLength("JSkelet — a thin SSR framework"), null);
});

test("description grades empty, short, long and ok lengths", () => {
  assert.equal(gradeDescriptionLength("").severity, "error");
  assert.equal(gradeDescriptionLength("Too short to be useful").severity, "warn");
  assert.equal(gradeDescriptionLength("A".repeat(200)).severity, "warn");
  assert.equal(
    gradeDescriptionLength(
      "JSkelet ships HTML from the server with islands, Tailwind and an in-process cache for SEO-friendly pages.",
    ),
    null,
  );
});

test("image alt requires the attribute; empty alt is decorative", () => {
  assert.equal(gradeImageAlt(null, false).severity, "error");
  assert.equal(gradeImageAlt("", true), null);
  assert.equal(gradeImageAlt("Chart of monthly revenue", true), null);
  assert.equal(gradeImageAlt("A".repeat(140), true).severity, "warn");
});

test("heading skip detects jumped levels", () => {
  assert.equal(gradeHeadingSkip([1, 2, 3]), null);
  assert.equal(gradeHeadingSkip([1, 3]).severity, "warn");
  assert.equal(gradeHeadingSkip([]), null);
});

test("trimText collapses whitespace", () => {
  assert.equal(trimText("  hello\n  world  "), "hello world");
});
