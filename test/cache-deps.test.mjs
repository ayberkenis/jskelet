import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearHtmlCache,
  getHtmlCacheEntries,
  getHtmlCacheSize,
  withHtmlCache,
} from "../src/server/html-cache.js";
import { clearDataCache, withDataCache } from "../src/server/data-cache.js";

afterEach(() => {
  clearHtmlCache();
  clearDataCache();
});

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a render records the data keys it read", async () => {
  await withHtmlCache("/haber/a?", 60, async () => {
    await withDataCache("haber:a", 60, async () => ({ baslik: "A" }));
    await withDataCache("etiket:x", 60, async () => ["a"]);
    return { html: "A", status: 200 };
  });

  assert.equal(getHtmlCacheEntries()[0].deps, 2);
});

test("clearing a data key stales every page that read it", async () => {
  let detay = 0;
  let liste = 0;

  const renderDetay = async () => {
    detay += 1;
    await withDataCache("haber:a", 60, async () => ({ baslik: "A" }));
    return { html: `detay ${detay}`, status: 200 };
  };

  // Liste sayfası aynı veriyi okuyor; elle tag'lemede unutulan tam olarak bu.
  const renderListe = async () => {
    liste += 1;
    await withDataCache("haber:a", 60, async () => ({ baslik: "A" }));
    return { html: `liste ${liste}`, status: 200 };
  };

  await withHtmlCache("/haber/a?", 60, renderDetay);
  await withHtmlCache("/?", 60, renderListe);

  clearDataCache("haber:");

  const hit = await withHtmlCache("/haber/a?", 60, renderDetay);
  assert.equal(hit.cached, true);
  assert.equal(hit.stale, true, "detay sayfası bayatlamalı");
  assert.equal(hit.html, "detay 1", "ziyaretçi render'ı beklememeli");

  const home = await withHtmlCache("/?", 60, renderListe);
  assert.equal(home.stale, true, "aynı veriyi okuyan liste de bayatlamalı");

  await sleep(20);
  assert.equal(detay, 2);
  assert.equal(liste, 2);
});

test("pages that read nothing in common are untouched", async () => {
  const render = (/** @type {string} */ key) => async () => {
    await withDataCache(key, 60, async () => key);
    return { html: key, status: 200 };
  };

  await withHtmlCache("/haber/a?", 60, render("haber:a"));
  await withHtmlCache("/haber/b?", 60, render("haber:b"));

  clearDataCache("haber:a");

  const other = await withHtmlCache("/haber/b?", 60, render("haber:b"));
  assert.equal(other.stale, false, "ilgisiz sayfa bayatlamamalı");
});

test("a webhook that lands mid-render keeps the page out of the cache", async () => {
  // Ters indeks yalnızca yazılmış girdileri tanır; render sürerken gelen bir
  // purge, "doğduğu anda bayat" bir sayfayı önbelleğe sokabilirdi.
  const render = withHtmlCache("/haber/a?", 60, async () => {
    await withDataCache("haber:a", 60, async () => "eski");
    await sleep(30);
    return { html: "eski", status: 200 };
  });

  await sleep(10);
  clearDataCache("haber:a");
  await render;

  assert.equal(getHtmlCacheSize(), 0, "purge'den önce okunan veri saklanmamalı");
});

test("the reverse index does not leak when entries are dropped", async () => {
  await withHtmlCache("/haber/a?", 0.05, async () => {
    await withDataCache("haber:a", 60, async () => "A");
    return { html: "A", status: 200 };
  });

  // Bayat penceresi de dolunca girdi düşer; ters indeks onunla birlikte
  // temizlenmezse sessizce büyür ve ölü sayfaları bayatlatmaya çalışır.
  await sleep(120);
  await withHtmlCache("/haber/a?", 0.05, async () => ({ html: "B", status: 200 }));

  assert.equal(getHtmlCacheSize(), 1);
  assert.equal(getHtmlCacheEntries()[0].deps, 0);
  assert.equal(clearDataCache("haber:"), 1, "veri girdisi hâlâ orada");
});
