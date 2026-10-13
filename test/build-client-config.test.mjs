/**
 * `normalizeBuild` ve chunk-group matcher birim testleri.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { normalizeBuild } from "../src/config/index.js";
import {
  isSafeGroupName,
  listPathMatcherMembers,
  matchBarePackage,
  matchPathPrefix,
  matcherKind,
  resolveGroupName,
  resolvePathMatcher,
} from "../src/build/chunk-groups.mjs";

const savedEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

/** Asset env'lerini bu test dosyasında izole tut. */
function clearAssetEnv() {
  delete process.env.JSKELET_ASSET_PREFIX;
  delete process.env.JSKELET_ASSETS_BUCKET;
  delete process.env.AWS_REGION;
  delete process.env.AWS_DEFAULT_REGION;
  delete process.env.AWS_ENDPOINT_URL;
  delete process.env.JSKELET_S3_REGION;
  delete process.env.JSKELET_S3_API_URL;
}

test("normalizeBuild: defaults when empty", () => {
  clearAssetEnv();
  const build = normalizeBuild(null);
  assert.equal(build.client.splitting, true);
  assert.deepEqual(build.client.groups, {});
  assert.equal(build.client.chunkGroup, null);
  assert.equal(build.assets.prefix, "");
  assert.equal(build.assets.upload.enabled, false);
  assert.deepEqual(build.assets.upload.include, ["assets"]);
});

test("normalizeBuild: invalid build ignored", () => {
  const build = normalizeBuild("nope");
  assert.equal(build.client.splitting, true);
  assert.deepEqual(build.client.groups, {});
  assert.equal(build.assets.upload.enabled, false);
});

test("normalizeBuild: splitting false and groups warn path", () => {
  const build = normalizeBuild({
    client: {
      splitting: false,
      groups: { charts: ["chart.js"] },
    },
  });
  assert.equal(build.client.splitting, false);
  assert.deepEqual(build.client.groups, { charts: ["chart.js"] });
});

test("normalizeBuild: groups and chunkGroup", () => {
  const hook = (id) => (id.includes("lodash") ? "vendor" : null);
  const build = normalizeBuild({
    client: {
      groups: {
        charts: ["chart.js", "  chartjs-adapter-date-fns "],
        "bad name": ["x"],
        chrome: ["./client/chrome/"],
      },
      chunkGroup: hook,
    },
  });
  assert.equal(build.client.splitting, true);
  assert.deepEqual(build.client.groups, {
    charts: ["chart.js", "chartjs-adapter-date-fns"],
    chrome: ["./client/chrome/"],
  });
  assert.equal(build.client.chunkGroup, hook);
});

test("normalizeBuild: chunkGroup must be a function", () => {
  const build = normalizeBuild({
    client: { chunkGroup: "nope" },
  });
  assert.equal(build.client.chunkGroup, null);
});

test("normalizeBuild: assets prefix and upload from env", () => {
  clearAssetEnv();
  process.env.JSKELET_ASSET_PREFIX = "https://cdn.example.com/";
  process.env.JSKELET_ASSETS_BUCKET = "my-bucket/static";
  process.env.AWS_REGION = "eu-central-1";
  const build = normalizeBuild({});
  assert.equal(build.assets.prefix, "https://cdn.example.com");
  assert.equal(build.assets.upload.enabled, true);
  assert.equal(build.assets.upload.bucket, "my-bucket");
  assert.equal(build.assets.upload.keyPrefix, "static/");
  assert.equal(build.assets.upload.region, "eu-central-1");
});

test("normalizeBuild: upload enabled false wins over bucket env", () => {
  clearAssetEnv();
  process.env.JSKELET_ASSETS_BUCKET = "blocked";
  const build = normalizeBuild({
    assets: { upload: { enabled: false } },
  });
  assert.equal(build.assets.upload.enabled, false);
  assert.equal(build.assets.upload.bucket, "blocked");
});

test("matcher helpers", () => {
  assert.equal(isSafeGroupName("charts"), true);
  assert.equal(isSafeGroupName("bad name"), false);
  assert.equal(matcherKind("chart.js"), "bare");
  assert.equal(matcherKind("./client/chrome/"), "path");
  assert.equal(matcherKind("@/client/chrome/"), "path");
  assert.equal(matchBarePackage("chart.js", "chart.js"), true);
  assert.equal(matchBarePackage("chart.js", "chart.js/auto"), true);
  assert.equal(matchBarePackage("chart.js", "chartj"), false);

  const root = path.join(os.tmpdir(), "jskelet-match-root");
  const chrome = path.join(root, "client", "chrome", "nav.js");
  assert.equal(
    matchPathPrefix(resolvePathMatcher(root, "./client/chrome/"), chrome),
    true,
  );
  assert.equal(
    matchPathPrefix(resolvePathMatcher(root, "@/client/chrome/"), chrome),
    true,
  );
});

test("resolveGroupName: hook wins over groups", () => {
  const root = "/proj";
  const name = resolveGroupName(
    "chart.js",
    path.join(root, "node_modules", "chart.js", "dist", "chart.js"),
    {
      root,
      groups: { charts: ["chart.js"] },
      chunkGroup: () => "vendor",
    },
  );
  assert.equal(name, "vendor");
});

test("resolveGroupName: bare and path matchers", () => {
  const root = path.join(os.tmpdir(), "jskelet-group-root");
  const file = path.join(root, "client", "chrome", "nav.js");
  assert.equal(
    resolveGroupName("chart.js", null, {
      root,
      groups: { charts: ["chart.js"] },
      chunkGroup: null,
    }),
    "charts",
  );
  assert.equal(
    resolveGroupName("@/client/chrome/nav.js", file, {
      root,
      groups: { chrome: ["@/client/chrome/"] },
      chunkGroup: null,
    }),
    "chrome",
  );
});

test("listPathMatcherMembers globs js/ts under prefix", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-glob-"));
  try {
    const dir = path.join(root, "client", "chrome");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "nav.js"), "");
    fs.writeFileSync(path.join(dir, "footer.ts"), "");
    fs.writeFileSync(path.join(dir, "readme.md"), "");
    const members = listPathMatcherMembers(root, "./client/chrome/")
      .map((p) => path.basename(p))
      .sort();
    assert.deepEqual(members, ["footer.ts", "nav.js"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
