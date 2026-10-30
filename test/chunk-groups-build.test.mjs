/**
 * Client chunk grouping: splitting kapalı ve groups ile çıktı birleşmesi.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildClient } from "../src/build/tasks/client.mjs";
import { initBuildPaths } from "../src/build/paths.mjs";

/**
 * @param {{
 *   splitting?: boolean,
 *   groups?: Record<string, string[]>,
 *   chunkGroup?: ((id: string) => string | null | undefined) | null,
 * }} [client]
 */
function makeFixture(client = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-chunks-"));
  const clientDir = path.join(root, "client");
  const entriesDir = path.join(clientDir, "entries");
  const libDir = path.join(clientDir, "lib");
  const publicDir = path.join(root, "public");
  const assetsDir = path.join(publicDir, "assets");
  const generatedDir = path.join(root, ".jskelet");

  fs.mkdirSync(entriesDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(generatedDir, { recursive: true });

  fs.writeFileSync(
    path.join(libDir, "a.js"),
    `export const a = "a";\n`,
  );
  fs.writeFileSync(
    path.join(libDir, "b.js"),
    `export const b = "b";\n`,
  );
  // İki ayrı dinamik import → splitting açıkken genelde birden fazla dosya.
  fs.writeFileSync(
    path.join(entriesDir, "main.js"),
    `
export async function boot() {
  const [{ a }, { b }] = await Promise.all([
    import("../lib/a.js"),
    import("../lib/b.js"),
  ]);
  return a + b;
}
`,
  );

  /** @type {import('../src/config/index.js').ResolvedConfig} */
  const config = {
    root,
    loaded: true,
    dirs: {
      client: clientDir,
      public: publicDir,
      assets: assetsDir,
      fonts: path.join(publicDir, "fonts"),
      generated: generatedDir,
      views: path.join(root, "views"),
      routes: path.join(root, "routes"),
      styles: path.join(root, "styles", "globals.css"),
      features: path.join(root, "features"),
      shared: path.join(root, "shared"),
    },
    headers: [],
    redirects: [],
    rewrites: [],
    html: [],
    cacheQuery: [],
    cacheVary: { host: false, headers: [], fn: null, assets: true },
    htmlMaxEntries: 500,
    staleWhileRevalidate: 60,
    data: {},
    trackUpstream: false,
    trackDependencies: false,
    transientRetry: { attempts: 1, delayMs: 300 },
    redis: {},
    upstream: {},
    logs: {},
    admin: {},
    cloudflare: {},
    prewarm: {},
    prewarmPriority: [],
    brand: {},
    auth: { crossSubdomainHandoff: false },
    hooks: {},
    layout: path.join(root, "views", "layout.ejs"),
    routes: null,
    trailingSlash: false,
    static: { extensions: new Set(), prefixes: [] },
    devGate: false,
    devGateBypass: [],
    preconnect: [],
    navigation: {
      prefetch: false,
      prerender: false,
      viewTransition: false,
      exclude: [],
    },
    security: {
      trustProxy: true,
      cookieSecret: null,
      csrf: {
        enabled: false,
        token: false,
        allowedOrigins: [],
        exclude: [],
        cookieName: "csrf_token",
        fieldName: "_csrf",
        headerName: "x-csrf-token",
      },
    },
    prewarmSkip: [],
    watch: [],
    fonts: [],
    icons: false,
    images: false,
    clientEnv: [],
    build: {
      client: {
        splitting: client.splitting !== false,
        groups: client.groups ?? {},
        chunkGroup: client.chunkGroup ?? null,
      },
      assets: {
        prefix: "",
        upload: {
          enabled: false,
          bucket: null,
          keyPrefix: "",
          region: "us-east-1",
          endpoint: null,
          include: ["assets"],
          cacheControl: "public, max-age=31536000, immutable",
        },
      },
    },
  };

  return { root, config };
}

/** @param {string} outDir */
function countJsOutputs(outDir) {
  if (!fs.existsSync(outDir)) return 0;
  /** @type {string[]} */
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  };
  walk(outDir);
  return files.length;
}

test("buildClient: splitting false emits a single entry file", async () => {
  const { root, config } = makeFixture({ splitting: false });
  try {
    initBuildPaths(config);
    const manifest = await buildClient(config);
    assert.ok(manifest["main.js"]);
    const outDir = path.join(root, "public", "assets", "js");
    // Dinamik import'lar splitting kapalıyken de ayrı dosya üretebilir;
    // en azından entry tek hash'li main dosyasıdır.
    assert.equal(Object.keys(manifest).length, 1);
    assert.ok(countJsOutputs(outDir) >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildClient: groups co-locate matched modules in one chunk", async () => {
  const { root, config } = makeFixture({
    splitting: true,
    groups: {
      shared: ["./client/lib/"],
    },
  });
  try {
    initBuildPaths(config);
    const manifest = await buildClient(config);
    assert.ok(manifest["main.js"]);

    const metafile = JSON.parse(
      fs.readFileSync(path.join(root, ".jskelet", "metafile.json"), "utf8"),
    );
    /** @type {string[]} */
    const owners = [];
    for (const [outFile, output] of Object.entries(metafile.outputs)) {
      const inputs = Object.keys(output.inputs ?? {});
      const hasA = inputs.some((input) =>
        input.replace(/\\/g, "/").endsWith("client/lib/a.js"),
      );
      const hasB = inputs.some((input) =>
        input.replace(/\\/g, "/").endsWith("client/lib/b.js"),
      );
      if (hasA && hasB) owners.push(outFile.replace(/\\/g, "/"));
    }
    assert.ok(
      owners.length >= 1,
      "expected a.js and b.js in the same output chunk",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
