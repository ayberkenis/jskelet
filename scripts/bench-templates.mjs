/**
 * EJS runtime vs derlenmiş `.jsk` SSR throughput karşılaştırması.
 *
 * Build süresi bu ölçüme dahil değildir — yalnızca render() yolu.
 *
 *   node scripts/bench-templates.mjs
 */
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ejs from "ejs";
import { compileSource } from "../src/compile/index.js";
import { esc } from "../src/views/helpers/html.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, ".bench-jsk");
const ITERATIONS = 20_000;

const data = {
  heading: "Benchmark heading",
  items: Array.from({ length: 20 }, (_, i) => `Item ${i}`),
};

const ejsSource = `<section>
  <h1><%= heading %></h1>
  <ul>
  <% for (const item of items) { %>
    <li><%= item %></li>
  <% } %>
  </ul>
</section>`;

const jskSource = `<section>
  <h1>{{ heading }}</h1>
  <ul>
  {#each items as item}
    <li>{{ item }}</li>
  {/each}
  </ul>
</section>`;

function listHtml({ items }) {
  return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

const helpers = { esc, list: listHtml, List: listHtml };

mkdirSync(OUT, { recursive: true });
const { code } = compileSource(jskSource, { viewId: "bench" });
const modPath = path.join(OUT, "bench.mjs");
writeFileSync(modPath, code);
const mod = await import(pathToFileURL(modPath).href);
const jskRender = mod.render;

const ejsFn = ejs.compile(ejsSource, { rmWhitespace: true, async: false });

/** @param {() => void} fn */
function bench(fn) {
  for (let i = 0; i < 500; i++) fn();
  /** @type {number[]} */
  const samples = [];
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  const total = performance.now() - start;
  samples.sort((a, b) => a - b);
  const p = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))];
  return {
    totalMs: total,
    opsPerSec: (ITERATIONS / total) * 1000,
    p50: p(0.5),
    p95: p(0.95),
  };
}

const ejsStats = bench(() => ejsFn(data));
const jskStats = bench(() => jskRender(data, helpers));

process.stdout.write(`Iterations: ${ITERATIONS}\n\n`);
process.stdout.write("EJS (compiled once, then render):\n");
process.stdout.write(
  `  ${ejsStats.opsPerSec.toFixed(0)} ops/s  p50=${ejsStats.p50.toFixed(4)}ms  p95=${ejsStats.p95.toFixed(4)}ms\n`,
);
process.stdout.write("JSK (build-time module render):\n");
process.stdout.write(
  `  ${jskStats.opsPerSec.toFixed(0)} ops/s  p50=${jskStats.p50.toFixed(4)}ms  p95=${jskStats.p95.toFixed(4)}ms\n`,
);
process.stdout.write("\n");
process.stdout.write(
  `Speedup (ops/s): ${(jskStats.opsPerSec / ejsStats.opsPerSec).toFixed(2)}x\n`,
);

rmSync(OUT, { recursive: true, force: true });
