/**
 * `build.client.hoistShared`: ortak modüllerin çatı entry'sine toplanması.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { initBuildPaths } from "../src/build/paths.mjs";
import {
  findHostEntry,
  parseUsage,
  planHoist,
  proxySource,
  rewriteDynamicImports,
} from "../src/build/hoist-shared.mjs";
import {
  contentHash,
  leadingImports,
  parseImportNames,
  rehashRewritten,
} from "../src/build/inline-chunks.mjs";
import { buildClient } from "../src/build/tasks/client.mjs";
import { normalizeBuild } from "../src/config/index.js";

/**
 * @param {Record<string, { imports?: { path: string, kind: string, original?: string }[], format?: string }>} inputs
 * @returns {import('esbuild').Metafile}
 */
function metafile(inputs) {
  /** @type {any} */
  const out = { inputs: {}, outputs: {} };
  for (const [file, input] of Object.entries(inputs)) {
    out.inputs[file] = {
      bytes: 1,
      format: input.format ?? "esm",
      imports: (input.imports ?? []).map((item) => ({
        original: `./${item.path}`,
        ...item,
      })),
    };
  }
  return out;
}

const stat = (/** @type {string} */ target) => ({ path: target, kind: "import-statement" });
const dyn = (/** @type {string} */ target) => ({ path: target, kind: "dynamic-import" });

test("findHostEntry accepts a path or a manifest name", () => {
  const entries = ["client/entries/chart.js", "client/entries/main.ts"];
  assert.equal(findHostEntry(entries, "main.js"), "client/entries/main.ts");
  assert.equal(findHostEntry(entries, "client/entries/main.js"), "client/entries/main.ts");
  assert.equal(findHostEntry(entries, "./client/entries/chart.js"), "client/entries/chart.js");
  assert.equal(findHostEntry(entries, "other.js"), null);
});

test("planHoist: host closure and modules shared by islands are hoisted", () => {
  const plan = planHoist(
    metafile({
      "e/main.js": { imports: [stat("l/log.js"), dyn("c/a.js"), dyn("c/b.js"), dyn("c/solo.js")] },
      "l/log.js": {},
      "l/util.js": { imports: [stat("l/deep.js")] },
      "l/deep.js": {},
      "l/own.js": {},
      "c/a.js": { imports: [stat("l/log.js"), stat("l/util.js")] },
      "c/b.js": { imports: [stat("l/util.js")] },
      "c/solo.js": { imports: [stat("l/own.js")] },
    }),
    {
      root: "/app",
      entries: ["e/main.js"],
      hoist: { into: "main.js", minImporters: 2, exclude: [] },
    },
  );

  assert.equal(plan.host, "e/main.js");
  for (const file of ["e/main.js", "l/log.js", "l/util.js", "l/deep.js"]) {
    assert.ok(plan.hoisted.has(file), `${file} should be hoisted`);
  }
  assert.ok(!plan.hoisted.has("l/own.js"));
  assert.ok(!plan.hoisted.has("c/a.js"));

  // `deep.js` yalnızca hoisted `util.js` tarafından çekiliyor: proxy gerekmez.
  assert.deepEqual([...plan.registered.keys()].sort(), ["l/log.js", "l/util.js"]);
});

test("planHoist: excluded vendors and their dependencies stay out", () => {
  const plan = planHoist(
    metafile({
      "e/main.js": { imports: [dyn("c/a.js"), dyn("c/b.js")] },
      "c/a.js": { imports: [stat("l/chart-helper.js"), stat("l/fmt.js")] },
      "c/b.js": { imports: [stat("l/chart-helper.js"), stat("l/fmt.js")] },
      "l/chart-helper.js": { imports: [stat("node_modules/heavy/index.js")] },
      "l/fmt.js": {},
      "node_modules/heavy/index.js": { imports: [stat("node_modules/heavy-dep/index.js")] },
      "node_modules/heavy-dep/index.js": {},
    }),
    {
      root: "/app",
      entries: ["e/main.js"],
      hoist: { into: "main.js", minImporters: 2, exclude: ["heavy"] },
    },
  );

  assert.ok(plan.hoisted.has("l/fmt.js"));
  assert.ok(!plan.hoisted.has("node_modules/heavy/index.js"));
  assert.ok(!plan.hoisted.has("node_modules/heavy-dep/index.js"), "vendor deps follow the vendor");
  assert.ok(!plan.hoisted.has("l/chart-helper.js"), "importers of a vendor stay with it");
});

test("planHoist: exclude keeps the module out but hoists its app dependencies", () => {
  const plan = planHoist(
    metafile({
      "e/main.js": {
        imports: [dyn("c/markets.js"), dyn("c/news.js"), dyn("c/board.js"), dyn("c/feed.js")],
      },
      "c/markets.js": { imports: [stat("l/dates.js"), stat("l/only-markets.js")] },
      "c/news.js": { imports: [stat("l/dates.js")] },
      "c/board.js": { imports: [stat("l/page-helper.js")] },
      "c/feed.js": { imports: [stat("l/page-helper.js")] },
      "l/page-helper.js": { imports: [stat("l/legacy.js")] },
      "l/legacy.js": {},
      "l/dates.js": {},
      "l/only-markets.js": {},
    }),
    {
      root: "/app",
      entries: ["e/main.js"],
      hoist: { into: "main.js", minImporters: 2, exclude: ["./c/markets.js", "./l/legacy.js"] },
    },
  );

  assert.ok(!plan.hoisted.has("c/markets.js"));
  assert.ok(plan.hoisted.has("l/dates.js"), "shared helper of an excluded module is hoisted");
  assert.ok(plan.registered.has("l/dates.js"), "the excluded module reaches it via proxy");
  assert.ok(!plan.hoisted.has("l/only-markets.js"), "single-root helpers stay with their island");
  assert.ok(!plan.hoisted.has("l/page-helper.js"), "importers of an excluded module stay out");
});

test("planHoist: group members are never hoisted", () => {
  const plan = planHoist(
    metafile({
      "e/main.js": { imports: [dyn("c/a.js"), dyn("c/b.js")] },
      "c/a.js": { imports: [stat("node_modules/chart.js/dist/chart.js")] },
      "c/b.js": { imports: [stat("node_modules/chart.js/dist/chart.js")] },
      "node_modules/chart.js/dist/chart.js": {},
    }),
    {
      root: "/app",
      entries: ["e/main.js"],
      hoist: { into: "main.js", minImporters: 2, exclude: [] },
      groupOptions: { root: "/app", groups: { charts: ["chart.js"] }, chunkGroup: null },
    },
  );
  assert.ok(!plan.hoisted.has("node_modules/chart.js/dist/chart.js"));
});

test("planHoist: minImporters raises the bar", () => {
  const plan = planHoist(
    metafile({
      "e/main.js": { imports: [dyn("c/a.js"), dyn("c/b.js")] },
      "c/a.js": { imports: [stat("l/x.js")] },
      "c/b.js": { imports: [stat("l/x.js")] },
      "l/x.js": {},
    }),
    {
      root: "/app",
      entries: ["e/main.js"],
      hoist: { into: "main.js", minImporters: 3, exclude: [] },
    },
  );
  assert.ok(!plan.hoisted.has("l/x.js"));
  assert.equal(plan.registered.size, 0);
});

test("planHoist: missing host disables hoisting", () => {
  const plan = planHoist(metafile({ "e/main.js": {} }), {
    root: "/app",
    entries: ["e/main.js"],
    hoist: { into: "shell.js", minImporters: 2, exclude: [] },
  });
  assert.equal(plan.host, null);
  assert.equal(plan.hoisted.size, 0);
});

test("proxySource handles reserved and non-identifier export names", () => {
  const source = proxySource(3, "esm", ["default", "delete", "a-b"]);
  assert.match(source, /_0 as default/);
  assert.match(source, /_1 as delete/);
  assert.match(source, /_2 as "a-b"/);
  assert.match(proxySource(1, "cjs", []), /module\.exports/);
});

test("parseUsage reads used names from esbuild output", () => {
  const p = (/** @type {number} */ id) => `"jskelet-hoist-usage:${id}"`;
  const usage = parseUsage([
    `import { on, qs as q } from ${p(0)};\nimport get from ${p(1)};\n`,
    `import get2, { "a-b" as ab } from ${p(1)};\nimport * as ns from ${p(2)};\n`,
    `import ${p(3)};\nconst lazy = () => import(${p(4)});\nexport * from ${p(5)};\n`,
  ]);
  assert.deepEqual([...(usage.get(0) ?? [])].sort(), ["on", "qs"]);
  assert.deepEqual([...(usage.get(1) ?? [])].sort(), ["a-b", "default"]);
  assert.equal(usage.get(2), null);
  assert.deepEqual([...(usage.get(3) ?? [])], []);
  assert.equal(usage.get(4), null);
  assert.equal(usage.get(5), null);
});

test("normalizeBuild: hoistShared", () => {
  assert.equal(normalizeBuild({}).client.hoistShared, null);
  assert.deepEqual(normalizeBuild({ client: { hoistShared: true } }).client.hoistShared, {
    into: "main.js",
    minImporters: 2,
    exclude: [],
  });
  assert.deepEqual(
    normalizeBuild({
      client: {
        hoistShared: { into: "client/entries/main.js", minImporters: 1, exclude: ["yup", 3] },
      },
    }).client.hoistShared,
    { into: "client/entries/main.js", minImporters: 2, exclude: ["yup"] },
  );
});

/**
 * @param {Record<string, string>} files
 * @param {unknown} hoistShared
 */
function makeFixture(files, hoistShared) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-hoist-"));
  for (const [file, contents] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  const publicDir = path.join(root, "public");
  const config = /** @type {any} */ ({
    root,
    dirs: {
      client: path.join(root, "client"),
      public: publicDir,
      assets: path.join(publicDir, "assets"),
      generated: path.join(root, ".jskelet"),
    },
    clientEnv: [],
    build: normalizeBuild({
      client: {
        hoistShared,
        groups: { charts: ["./client/charts/"] },
      },
    }),
  });
  return { root, config };
}

/** @param {string} dir */
function listJs(dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const FIXTURE = {
  "client/entries/main.js": `
import { log } from "../lib/log.js";
log("main");
export const islands = {
  a: () => import("../islands/a.js"),
  b: () => import("../islands/b.js"),
  c: () => import("../islands/c.js"),
};
`,
  "client/lib/log.js": `
export const calls = [];
export function log(value) { calls.push(value); }
export function unusedHelper() { return "UNUSED_MARKER"; }
`,
  "client/lib/http.js": `
import { log } from "./log.js";
export default function get(url) { log("get " + url); return url; }
`,
  "client/lib/data.json": `{ "answer": 42 }`,
  "client/islands/a.js": `
import get from "@/client/lib/http.js";
import data from "../lib/data.json";
import { draw } from "../charts/draw.js";
export function mount() { return [get("/a"), data.answer, draw()]; }
`,
  "client/islands/b.js": `
import get from "../lib/http.js";
import { calls } from "../lib/log.js";
import data from "../lib/data.json";
import { draw } from "../charts/draw.js";
export function mount() { get("/b"); return [calls, data.answer, draw()]; }
`,
  "client/islands/c.js": `
export function mount() { return "c only"; }
`,
  "client/charts/draw.js": `export function draw() { return "drawn"; }`,
};

test("buildClient: hoistShared folds shared modules into main and keeps behaviour", async () => {
  const { root, config } = makeFixture(FIXTURE, { into: "client/entries/main.js" });
  try {
    initBuildPaths(config);
    const manifest = await buildClient(config);
    const outDir = path.join(root, "public", "assets", "js");

    const metafile = JSON.parse(
      fs.readFileSync(path.join(root, ".jskelet", "metafile.json"), "utf8"),
    );
    /** @type {Map<string, string[]>} */
    const owners = new Map();
    for (const [outFile, output] of Object.entries(metafile.outputs)) {
      if (!outFile.endsWith(".js")) continue;
      for (const input of Object.keys(output.inputs ?? {})) {
        const list = owners.get(input) ?? [];
        list.push(outFile);
        owners.set(input, list);
      }
    }

    const mainOut = Object.entries(metafile.outputs).find(
      ([, output]) => output.entryPoint === "client/entries/main.js",
    )?.[0];
    assert.ok(mainOut);
    for (const shared of ["client/lib/log.js", "client/lib/http.js", "client/lib/data.json"]) {
      assert.deepEqual(owners.get(shared), [mainOut], `${shared} should live only in main`);
    }

    // main + üç island + grup chunk'ı; paylaşılan küçük parça yok.
    assert.equal(listJs(outDir).length, 5);

    const preload = JSON.parse(
      fs.readFileSync(path.join(root, ".jskelet", "preload.json"), "utf8"),
    );
    assert.deepEqual(preload["client/lib/http.js"], preload["client/entries/main.js"]);

    const mainFile = path.join(root, "public", manifest["main.js"]);
    assert.ok(
      !fs.readFileSync(mainFile, "utf8").includes("UNUSED_MARKER"),
      "exports no island uses stay tree-shaken",
    );

    const mainUrl = pathToFileURL(mainFile).href;
    const main = await import(mainUrl);
    const a = await main.islands.a();
    const b = await main.islands.b();
    assert.deepEqual(a.mount(), ["/a", 42, "drawn"]);
    const [calls, answer] = b.mount();
    // Aynı `log.js` örneği: island'ın çağrıları çatının dizisine düşer.
    assert.deepEqual(calls, ["main", "get /a", "get /b"]);
    assert.equal(answer, 42);
  } finally {
    delete globalThis.__jskeletHoist;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildClient: excluded island reaches hoisted helpers through a proxy", async () => {
  const { root, config } = makeFixture(
    {
      "client/entries/main.js": `
export const islands = {
  markets: () => import("../islands/markets.js"),
  news: () => import("../islands/news.js"),
};
`,
      "client/lib/dates.js": `export const format = (d) => "date:" + d;`,
      "client/islands/markets.js": `
import { format } from "../lib/dates.js";
export function mount() { return format("m"); }
`,
      "client/islands/news.js": `
import { format } from "../lib/dates.js";
export function mount() { return format("n"); }
`,
    },
    { exclude: ["./client/islands/markets.js"] },
  );
  try {
    initBuildPaths(config);
    const manifest = await buildClient(config);
    const metafile = JSON.parse(
      fs.readFileSync(path.join(root, ".jskelet", "metafile.json"), "utf8"),
    );
    const owners = Object.entries(metafile.outputs)
      .filter(([, output]) => "client/lib/dates.js" in (output.inputs ?? {}))
      .map(([, output]) => output.entryPoint);
    assert.deepEqual(owners, ["client/entries/main.js"]);

    const main = await import(pathToFileURL(path.join(root, "public", manifest["main.js"])).href);
    assert.equal((await main.islands.markets()).mount(), "date:m");
    assert.equal((await main.islands.news()).mount(), "date:n");
  } finally {
    delete globalThis.__jskeletHoist;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rewriteDynamicImports resolves literal import() calls in place", () => {
  const specifiers = new Map([["../lib/api.js", 2]]);
  const code = rewriteDynamicImports(
    [
      `const a = import("../lib/api.js");`,
      `const b = import( /* lazy */ '../lib/api.js' );`,
      "const c = import(`../lib/api.js`);",
      `const d = import("../lib/other.js");`,
      "const e = import(`../lib/${name}.js`);",
    ].join("\n"),
    specifiers,
  );
  assert.equal(code.match(/globalThis\.__jskeletHoist\[2\]/g)?.length, 3);
  assert.match(code, /import\("\.\.\/lib\/other\.js"\)/);
  assert.match(code, /import\(`\.\.\/lib\/\$\{name\}\.js`\)/);
});

test("buildClient: import() of a hoisted module emits no extra file", async () => {
  const { root, config } = makeFixture(
    {
      "client/entries/main.js": `
import { request } from "../lib/api.js";
export const ping = () => request("main");
export const lazyApi = () => import("../lib/api.js");
export const islands = {
  a: () => import("../islands/a.js"),
  b: () => import("../islands/b.js"),
};
`,
      "client/lib/api.js": `
export const calls = [];
export function request(name) { calls.push(name); return name; }
`,
      "client/islands/a.js": `
export async function mount() {
  const { request } = await import("../lib/api.js");
  return request("a");
}
`,
      "client/islands/b.js": `
import { request } from "../lib/api.js";
export function mount() { return request("b"); }
`,
    },
    true,
  );
  try {
    initBuildPaths(config);
    const manifest = await buildClient(config);
    // main + iki island; import() için ayrı giriş dosyası yok.
    assert.equal(listJs(path.join(root, "public", "assets", "js")).length, 3);

    const main = await import(pathToFileURL(path.join(root, "public", manifest["main.js"])).href);
    const api = await main.lazyApi();
    assert.equal(await (await main.islands.a()).mount(), "a");
    assert.equal((await main.islands.b()).mount(), "b");
    assert.equal(main.ping(), "main");
    assert.deepEqual(api.calls, ["a", "b", "main"]);
  } finally {
    delete globalThis.__jskeletHoist;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildClient: hoistShared proxies CommonJS modules through interop", async () => {
  const { root, config } = makeFixture(
    {
      "client/entries/main.js": `
import { legacy } from "../lib/legacy.cjs";
export const fromMain = legacy;
export const islands = { a: () => import("../islands/a.js") };
`,
      "client/lib/legacy.cjs": `module.exports = { legacy: "yes" };`,
      "client/islands/a.js": `
import legacy from "../lib/legacy.cjs";
export function mount() { return legacy.legacy; }
`,
    },
    true,
  );
  try {
    initBuildPaths(config);
    const manifest = await buildClient(config);
    const main = await import(pathToFileURL(path.join(root, "public", manifest["main.js"])).href);
    assert.equal(main.fromMain, "yes");
    assert.equal((await main.islands.a()).mount(), "yes");
  } finally {
    delete globalThis.__jskeletHoist;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("leadingImports only reads the import statements at the top", () => {
  const text = `import{a as e,b as t}from"./chunk.X.js";import"./side.js";var s='import"./no.js"';`;
  const found = leadingImports(text);
  assert.deepEqual(
    found.map((item) => [item.specifier, item.names]),
    [
      ["./chunk.X.js", "a as e,b as t"],
      ["./side.js", null],
    ],
  );
  assert.equal(text.slice(found[0].start, found[0].end), `import{a as e,b as t}from"./chunk.X.js";`);
  assert.deepEqual(parseImportNames("a as e, b ,default as d"), { e: "a", b: "b", d: "default" });
});

test("contentHash ignores the sourceMappingURL comment", () => {
  const body = "export const n=1;\n";
  assert.equal(contentHash(body), contentHash(`${body}//# sourceMappingURL=a.OLD.js.map\n`));
  assert.notEqual(contentHash(body), contentHash("export const n=2;\n"));
  assert.equal(contentHash(body).length, 8);
});

test("rehashRewritten renames rewritten files and updates importers", () => {
  const root = path.join(os.tmpdir(), "jsk-rehash");
  const islandPath = path.join(root, "out", "chunks", "a.AAAAAAAA.js");
  const mainPath = path.join(root, "out", "main.BBBBBBBB.js");
  const fake = (file, text) => ({
    path: file,
    contents: Buffer.from(text),
    hash: "",
    get text() {
      return Buffer.from(this.contents).toString("utf8");
    },
  });
  const files = [
    fake(islandPath, "export const mount=()=>1;"),
    fake(mainPath, `export const a=()=>import("./chunks/a.AAAAAAAA.js");`),
  ];
  const toRel = (abs) => path.relative(root, abs).split(path.sep).join("/");
  const metafile = {
    outputs: {
      [toRel(islandPath)]: { bytes: 1, imports: [], inputs: {}, exports: [] },
      [toRel(mainPath)]: {
        bytes: 1,
        imports: [{ path: toRel(islandPath), kind: "dynamic-import", external: false }],
        inputs: {},
        exports: [],
      },
    },
    inputs: {},
  };
  const next = rehashRewritten(
    /** @type {any} */ (files),
    /** @type {any} */ (metafile),
    root,
    [toRel(islandPath), toRel(mainPath)],
  );
  const island = next.find((file) => path.posix.basename(file.path.replace(/\\/g, "/")).startsWith("a."));
  const main = next.find((file) => path.posix.basename(file.path.replace(/\\/g, "/")).startsWith("main."));
  assert.ok(island && main);
  assert.notEqual(path.basename(island.path), "a.AAAAAAAA.js");
  assert.equal(path.basename(island.path), `a.${contentHash(island.text)}.js`);
  assert.ok(main.text.includes(path.basename(island.path)));
  assert.notEqual(path.basename(main.path), "main.BBBBBBBB.js");
  assert.equal(path.basename(main.path), `main.${contentHash(main.text)}.js`);
  assert.equal(metafile.outputs[toRel(island.path)]?.bytes, island.contents.byteLength);
  assert.equal(metafile.outputs[toRel(islandPath)], undefined);
});

const RUNTIME_FIXTURE = {
  "client/entries/main.js": `
import { legacy } from "../lib/legacy.cjs";
export const fromMain = [legacy, process.env.NODE_ENV];
export const islands = { a: () => import("../islands/a.js") };
`,
  "client/lib/legacy.cjs": `module.exports = { legacy: "yes" };`,
  "client/islands/a.js": `
import legacy from "../lib/legacy.cjs";
export function mount() { return [legacy.legacy, Object.keys(process.env).join()]; }
`,
};

test("buildClient: esbuild's shared runtime chunk is folded into main", async () => {
  const { root, config } = makeFixture(RUNTIME_FIXTURE, true);
  try {
    initBuildPaths(config);
    const manifest = await buildClient(config);
    const js = listJs(path.join(root, "public", "assets", "js"));
    // main + island; interop yardımcıları ve `process.env` ayrı chunk değil.
    assert.equal(js.length, 2);

    const preload = JSON.parse(
      fs.readFileSync(path.join(root, ".jskelet", "preload.json"), "utf8"),
    );
    assert.deepEqual(preload["client/entries/main.js"], [manifest["main.js"]]);

    const islandFile = js.find((file) => file.includes(`${path.sep}chunks${path.sep}`));
    assert.ok(islandFile);
    const islandText = fs.readFileSync(islandFile, "utf8");
    // Hash eski içeriğe ait kalsa contentHash yeni gövdeyle eşleşmezdi.
    assert.equal(path.basename(islandFile), `a.${contentHash(islandText)}.js`);
    const mainFile = path.join(root, "public", manifest["main.js"]);
    const mainText = fs.readFileSync(mainFile, "utf8");
    assert.ok(mainText.includes(path.basename(islandFile)));
    assert.equal(path.basename(mainFile), `main.${contentHash(mainText)}.js`);

    const main = await import(pathToFileURL(mainFile).href);
    assert.deepEqual(main.fromMain, ["yes", "production"]);
    assert.deepEqual((await main.islands.a()).mount(), ["yes", "NODE_ENV"]);
  } finally {
    delete globalThis.__jskeletHoist;
    delete globalThis.__jskeletShared;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildClient: folded output keeps source maps to the original files", async () => {
  const { root, config } = makeFixture(RUNTIME_FIXTURE, true);
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    initBuildPaths(config);
    await buildClient(config);
    const jsDir = path.join(root, "public", "assets", "js");
    const names = fs.readdirSync(jsDir, { recursive: true }).map(String);
    for (const name of names.filter((file) => file.endsWith(".js"))) {
      const text = fs.readFileSync(path.join(jsDir, name), "utf8");
      const parsed = path.basename(name).match(/^(.+)\.([A-Z2-7]{8})\.js$/);
      assert.ok(parsed);
      assert.equal(parsed[2], contentHash(text));
      assert.ok(text.includes(`sourceMappingURL=${parsed[1]}.${parsed[2]}.js.map`));
      assert.ok(fs.existsSync(`${path.join(jsDir, name)}.map`));
    }
    const maps = names
      .filter((file) => file.endsWith(".map"))
      .map((file) => JSON.parse(fs.readFileSync(path.join(jsDir, file), "utf8")));
    assert.equal(maps.length, 2);
    const sources = maps.flatMap((map) => map.sources);
    assert.ok(sources.some((source) => source.endsWith("client/islands/a.js")));
    assert.ok(sources.some((source) => source.endsWith("client/entries/main.js")));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildClient: without hoistShared the shared modules split out", async () => {
  const { root, config } = makeFixture(FIXTURE, null);
  try {
    initBuildPaths(config);
    await buildClient(config);
    assert.ok(listJs(path.join(root, "public", "assets", "js")).length > 5);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
