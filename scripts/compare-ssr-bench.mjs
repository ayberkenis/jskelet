/**
 * Saf SSR hot-path A/B: codegen op sayısı + render süreleri.
 * Kullanım: `node scripts/compare-ssr-bench.mjs [label]`
 */
import { performance } from "node:perf_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { compileAll, compileSource } from "../src/compile/index.js";
import { loadConfig } from "../src/config/index.js";
import { renderPage, renderView, resetRenderEngine } from "../src/server/render.js";
import { esc, attrs } from "../src/views/helpers/html.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ROOT, "test", "fixtures", "jsk-app");
const label = process.argv[2] ?? path.basename(ROOT);

const fatSource = `<section class="wrap">
  <h1>{{ title }}</h1>
  {#each items as item, i}
    <article class="card">
      <h2>{{ item.title }}</h2>
      <p>{{ item.body }}</p>
      <span>{{ item.link }}</span>
    </article>
  {/each}
</section>
`;

const { code: fatCode } = compileSource(fatSource, { viewId: "pages/fat" });
const plusOps = [...fatCode.matchAll(/s \+= /g)].length;

const layoutPath = path.join(ROOT, "src", "templates", "layout.render.js");
const layoutCode = fs.readFileSync(layoutPath, "utf8");
const layoutOps = [...layoutCode.matchAll(/s \+= /g)].length;

const dir = fs.mkdtempSync(path.join(tmpdir(), "jsk-ab-"));
const file = path.join(dir, "fat.mjs");
fs.writeFileSync(file, fatCode);
const fatMod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);

const items = Array.from({ length: 100 }, (_, i) => ({
  title: `Title ${i}`,
  body: `Body with <tags> & stuff ${i}`,
  link: `Link ${i}`,
}));
const helpers = { esc, attrs };

// Isınma + ölçüm: fat template (escape yoğun)
for (let i = 0; i < 30; i += 1) fatMod.render({ title: "T", items }, helpers);
const fatRounds = 500;
const tFat = performance.now();
let fatHtml = "";
for (let i = 0; i < fatRounds; i += 1) {
  fatHtml = fatMod.render({ title: "T", items }, helpers);
}
const fatMs = (performance.now() - tFat) / fatRounds;

// esc microbench
const samples = items.flatMap((it) => [it.title, it.body, "plain-no-special", it.link]);
for (let i = 0; i < 1000; i += 1) esc(samples[i % samples.length]);
const escRounds = 50_000;
const tEsc = performance.now();
for (let i = 0; i < escRounds; i += 1) esc(samples[i % samples.length]);
const escNs = ((performance.now() - tEsc) * 1e6) / escRounds;

resetRenderEngine();
const config = await loadConfig({ root: FIXTURE, force: true });
await compileAll(config);
resetRenderEngine();

const pageData = {
  heading: "Bench",
  items: items.map((it) => it.title),
};
for (let i = 0; i < 30; i += 1) await renderView("pages/home", pageData);
const viewRounds = 400;
const tView = performance.now();
for (let i = 0; i < viewRounds; i += 1) await renderView("pages/home", pageData);
const viewMs = (performance.now() - tView) / viewRounds;

const tPage = performance.now();
for (let i = 0; i < viewRounds; i += 1) {
  await renderPage({
    view: "pages/home",
    data: pageData,
    pathname: "/",
    metadata: { title: "Bench" },
  });
}
const pageMs = (performance.now() - tPage) / viewRounds;

fs.rmSync(dir, { recursive: true, force: true });

console.log(
  JSON.stringify({
    label,
    layoutPlusOps: layoutOps,
    fatPlusOps: plusOps,
    fatHtmlBytes: Buffer.byteLength(fatHtml),
    fatRenderMs: Number(fatMs.toFixed(4)),
    escNs: Number(escNs.toFixed(1)),
    renderViewMs: Number(viewMs.toFixed(4)),
    renderPageMs: Number(pageMs.toFixed(4)),
  }),
);
