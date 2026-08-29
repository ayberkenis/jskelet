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

test("ikisi de kapalıysa kural üretilmez", () => {
  assert.equal(buildSpeculationRules(nav({ prefetch: false })), null);
});

test("yalnızca açık olan bölüm basılır", () => {
  const rules = buildSpeculationRules(nav());
  assert.deepEqual(Object.keys(rules), ["prefetch"]);
  assert.equal(rules.prefetch[0].eagerness, "moderate");
});

test("prefetch ve prerender birlikte farklı eagerness taşıyabilir", () => {
  const rules = buildSpeculationRules(
    nav({ prefetch: "moderate", prerender: "conservative" }),
  );

  assert.equal(rules.prefetch[0].eagerness, "moderate");
  assert.equal(rules.prerender[0].eagerness, "conservative");
});

test("kural yalnızca aynı origin yollarını eşler", () => {
  const [first] = buildSpeculationRules(nav()).prefetch[0].where.and;
  assert.deepEqual(first, { href_matches: "/*" });
});

test("exclude desenleri olumsuz koşula çevrilir", () => {
  const { and } = buildSpeculationRules(nav({ exclude: ["/api/*"] })).prefetch[0].where;
  assert.ok(and.some((clause) => clause.not?.href_matches === "/api/*"));
});

test("yan etkili bağlantılar her koşulda muaf", () => {
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
