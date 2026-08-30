/**
 * Isıtma dilimi seçimi: `cache().prewarm.priority` sırası ve kuyruk rotasyonu.
 *
 * On binlerce yolluk bir sitede tek turda her şeyi ısıtmak mümkün değil;
 * doğru davranış "önemli olanlar her turda, geri kalanı sırayla" — bu dosya
 * o iki cümlenin karşılığını sınar.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { before, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import { selectPrewarmPaths } from "../src/server/prewarm.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "prewarm-app");

before(async () => {
  await loadConfig({ root: FIXTURE, force: true });
});

test("a list that fits under the limit is warmed as it came", () => {
  const paths = ["/haberler/a", "/", "/piyasalar"];
  assert.deepEqual(selectPrewarmPaths(paths, 10), paths);
});

test("priority patterns come first, in the order they were written", () => {
  const paths = [
    "/haberler/a",
    "/etiket/altin",
    "/piyasalar/dolar",
    "/",
    "/haberler/b",
  ];

  // Fixture sırası: "/" → "/piyasalar/:path*" → /^\/haberler\//
  const selected = selectPrewarmPaths(paths, 4);

  assert.deepEqual(selected.slice(0, 3), ["/", "/piyasalar/dolar", "/haberler/a"]);
  assert.equal(selected.length, 4);
});

test("the tail continues where the previous pass stopped", () => {
  const paths = ["/", "/etiket/a", "/etiket/b", "/etiket/c", "/etiket/d"];

  // Her turda öncelikli "/" + kuyruktan iki yol.
  const first = selectPrewarmPaths(paths, 3);
  const second = selectPrewarmPaths(paths, 3);
  const third = selectPrewarmPaths(paths, 3);

  assert.deepEqual(first, ["/", "/etiket/a", "/etiket/b"]);
  assert.deepEqual(second, ["/", "/etiket/c", "/etiket/d"]);
  // Kuyruk halkasal: dördüncü yoldan sonra başa sarar.
  assert.deepEqual(third, ["/", "/etiket/a", "/etiket/b"]);
});

test("rotation off always warms the same slice", () => {
  const paths = ["/", "/etiket/a", "/etiket/b", "/etiket/c"];

  const first = selectPrewarmPaths(paths, 2, false);
  const second = selectPrewarmPaths(paths, 2, false);

  assert.deepEqual(first, ["/", "/etiket/a"]);
  assert.deepEqual(second, ["/", "/etiket/a"]);
});
