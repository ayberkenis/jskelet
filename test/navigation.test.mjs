import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSpeculationRules } from "../src/server/head-hints.js";

/** @param {object} [overrides] */
const nav = (overrides = {}) => ({
  prefetch: "moderate",
  prerender: false,
  viewTransition: false,
  exclude: [],
  ...overrides,
});

test("no rule is emitted when both are disabled", () => {
  assert.equal(buildSpeculationRules(nav({ prefetch: false })), null);
});

test("only the enabled section is printed", () => {
  const rules = buildSpeculationRules(nav());
  assert.deepEqual(Object.keys(rules), ["prefetch"]);
  assert.equal(rules.prefetch[0].eagerness, "moderate");
});

test("prefetch and prerender can carry different eagerness together", () => {
  const rules = buildSpeculationRules(
    nav({ prefetch: "moderate", prerender: "conservative" }),
  );

  assert.equal(rules.prefetch[0].eagerness, "moderate");
  assert.equal(rules.prerender[0].eagerness, "conservative");
});

test("the rule matches same-origin paths only", () => {
  const [first] = buildSpeculationRules(nav()).prefetch[0].where.and;
  assert.deepEqual(first, { href_matches: "/*" });
});

test("exclude patterns become a negative condition", () => {
  const { and } = buildSpeculationRules(nav({ exclude: ["/api/*"] })).prefetch[0].where;
  assert.ok(and.some((clause) => clause.not?.href_matches === "/api/*"));
});

test("links with side effects are always exempt", () => {
  const { and } = buildSpeculationRules(nav()).prefetch[0].where;
  const selectors = and
    .map((clause) => clause.not?.selector_matches)
    .filter(Boolean);

  assert.deepEqual(selectors, [
    "[rel~=nofollow]",
    "[target=_blank]",
    "[data-no-prefetch]",
  ]);
});
