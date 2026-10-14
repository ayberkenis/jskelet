/**
 * Cache MISS yolunda render süresi vs toplam istek süresi (blog örneği).
 *
 * Sunucu ayaktayken:
 *   node scripts/measure-ssr.mjs
 *   BASE=http://localhost:3210 node scripts/measure-ssr.mjs
 *
 * Ayrıca fixture ile saf `.jsk` render mikrobench çalıştırır (upstream yok).
 */
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileAll, compileSource } from "../src/compile/index.js";
import { loadConfig } from "../src/config/index.js";
import { renderPage, renderView, resetRenderEngine } from "../src/server/render.js";
import { esc } from "../src/views/helpers/html.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "test", "fixtures", "jsk-app");
const BASE = process.env.BASE ?? "http://localhost:3210";

async function microbenchFixture() {
  resetRenderEngine();
  const config = await loadConfig({ root: FIXTURE, force: true });
  await compileAll(config);
  resetRenderEngine();

  const data = {
    heading: "Bench",
    items: Array.from({ length: 50 }, (_, i) => `item-${i}`),
  };

  // Isınma
  for (let i = 0; i < 20; i += 1) await renderView("pages/home", data);

  const rounds = 200;
  const t0 = performance.now();
  for (let i = 0; i < rounds; i += 1) await renderView("pages/home", data);
  const viewMs = (performance.now() - t0) / rounds;

  const t1 = performance.now();
  for (let i = 0; i < rounds; i += 1) {
    await renderPage({
      view: "pages/home",
      data,
      pathname: "/",
      metadata: { title: "Bench" },
    });
  }
  const pageMs = (performance.now() - t1) / rounds;

  const { code } = compileSource(
    `<ul>{#each items as item}<li>{{ item }}</li>{/each}</ul>`,
    { viewId: "pages/list" },
  );
  const staticOps = [...code.matchAll(/s \+= /g)].length;

  console.log("fixture SSR (no upstream)");
  console.log(`  renderView avg:  ${viewMs.toFixed(3)} ms`);
  console.log(`  renderPage avg:  ${pageMs.toFixed(3)} ms`);
  console.log(`  each-list += ops in generated code: ${staticOps}`);
}

async function measureLiveMiss() {
  const bust = `?_bench=${Date.now()}`;
  // Blog cache.query genelde boş — bilinmeyen query → dinamik (MISS her seferinde).
  // Önce ana sayfayı cache header ile oku.
  const paths = ["/", "/blog", "/iletisim"];

  console.log(`\nlive requests (${BASE})`);
  for (const pathname of paths) {
    const url = `${BASE}${pathname}${bust}`;
    const t0 = performance.now();
    let res;
    try {
      res = await fetch(url, { redirect: "manual" });
    } catch (error) {
      console.log(`  ${pathname}: server unreachable (${error.cause?.code ?? error.message})`);
      return false;
    }
    const totalMs = performance.now() - t0;
    const body = await res.text();
    const cache = res.headers.get("x-jskelet-cache") ?? "-";
    const serverTiming = res.headers.get("server-timing") ?? "";
    console.log(
      `  ${pathname.padEnd(12)} ${res.status} cache=${cache} total=${totalMs.toFixed(1)}ms ` +
        `bytes=${body.length}${serverTiming ? ` timing=${serverTiming}` : ""}`,
    );
  }

  // İkinci geçiş: cache HIT (query olmadan)
  const tHit = performance.now();
  const hit = await fetch(`${BASE}/`);
  const hitMs = performance.now() - tHit;
  await hit.text();
  console.log(
    `  ${"/".padEnd(12)} ${hit.status} cache=${hit.headers.get("x-jskelet-cache") ?? "-"} total=${hitMs.toFixed(1)}ms (second request)`,
  );
  return true;
}

await microbenchFixture();
const live = await measureLiveMiss();
if (!live) {
  console.log("\n(start the blog example to measure live MISS/HIT: npm --prefix examples/blog run start)");
}
