import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compilePattern,
  matchPattern,
  fillDestination,
} from "../src/config/pattern.js";

test("tek segment parametresi segment sınırını aşmaz", () => {
  const pattern = compilePattern("/blog/:slug");

  assert.deepEqual(matchPattern(pattern, "/blog/merhaba"), { slug: "merhaba" });
  assert.equal(matchPattern(pattern, "/blog/a/b"), null);
  assert.equal(matchPattern(pattern, "/blog"), null);
});

test("joker parametre birden fazla segment yakalar", () => {
  const pattern = compilePattern("/blog/:path*");

  assert.deepEqual(matchPattern(pattern, "/blog/a/b"), { path: "a/b" });
  // Sıfır segment de eşleşir: bir bölümü tamamen kapatmak isteyen kural
  // (`/hesabim/:path*`) bölümün kök yolunu atlamamalı.
  assert.deepEqual(matchPattern(pattern, "/blog"), { path: "" });
  assert.deepEqual(matchPattern(pattern, "/blog/"), { path: "" });
  assert.equal(matchPattern(pattern, "/blogx"), null);
});

test("joker + sabit son ek uzantı kurallarını yakalar", () => {
  const pattern = compilePattern("/:path*.svg");

  assert.ok(matchPattern(pattern, "/ikon/ok.svg"));
  assert.equal(matchPattern(pattern, "/ikon/ok.png"), null);
});

test("segment ortasındaki parametre", () => {
  const pattern = compilePattern("/etiket-:slug");

  assert.deepEqual(matchPattern(pattern, "/etiket-cache"), { slug: "cache" });
  assert.equal(matchPattern(pattern, "/etiket/cache"), null);
});

test("literal nokta gerçekten nokta demektir", () => {
  const pattern = compilePattern("/robots.txt");

  assert.ok(matchPattern(pattern, "/robots.txt"));
  assert.equal(matchPattern(pattern, "/robotsxtxt"), null);
});

test("geçersiz source null döner", () => {
  assert.equal(compilePattern("blog"), null);
  assert.equal(compilePattern(undefined), null);
});

test("yakalanan değerler destination'a yazılır", () => {
  const pattern = compilePattern("/yazi/:slug");
  const params = matchPattern(pattern, "/yazi/merhaba");

  assert.equal(fillDestination("/blog/:slug", params), "/blog/merhaba");
  // Karşılığı olmayan yer tutucu olduğu gibi kalır.
  assert.equal(fillDestination("/blog/:other", params), "/blog/:other");
});
