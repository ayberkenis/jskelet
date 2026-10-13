/**
 * CDN asset prefix ve S3 upload yardımcıları.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { applyAssetPrefix, asset } from "../src/server/assets.js";
import {
  assetsUploadSkipReason,
  contentTypeFor,
  listFilesRecursive,
  uploadAssets,
} from "../src/build/tasks/assets-upload.mjs";
import { initBuildPaths } from "../src/build/paths.mjs";
import { loadConfig, readS3CredentialsFromEnv } from "../src/config/index.js";
import { icon } from "../src/views/helpers/tags.js";

const savedEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

test("applyAssetPrefix joins origin and path", () => {
  assert.equal(
    applyAssetPrefix("https://cdn.example.com", "/assets/app.css"),
    "https://cdn.example.com/assets/app.css",
  );
  assert.equal(
    applyAssetPrefix("https://cdn.example.com/", "assets/app.css"),
    "https://cdn.example.com/assets/app.css",
  );
  assert.equal(applyAssetPrefix("", "/assets/x.js"), "/assets/x.js");
  assert.equal(
    applyAssetPrefix("https://cdn.example.com", "https://other/x.js"),
    "https://other/x.js",
  );
});

test("asset({ origin: \"document\" }) skips CDN prefix; icon() uses it for sprite", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-asset-origin-"));
  try {
    fs.mkdirSync(path.join(root, ".jskelet"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".jskelet", "manifest.json"),
      JSON.stringify({
        "app.css": "/assets/app.abc123.css",
        "sprite.svg": "/assets/sprite.def456.svg",
      }),
    );
    fs.writeFileSync(
      path.join(root, "jskelet.config.mjs"),
      `export default {
        build: { assets: { prefix: "https://cdn.example.com" } },
      };\n`,
    );

    await loadConfig({ root, force: true });

    assert.equal(
      asset("app.css"),
      "https://cdn.example.com/assets/app.abc123.css",
    );
    assert.equal(
      asset("app.css", { origin: "cdn" }),
      "https://cdn.example.com/assets/app.abc123.css",
    );
    assert.equal(
      asset("sprite.svg", { origin: "document" }),
      "/assets/sprite.def456.svg",
    );

    const html = icon({ name: "House" });
    assert.match(html, /href="\/assets\/sprite\.def456\.svg#house-regular"/);
    assert.doesNotMatch(html, /cdn\.example\.com/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("readS3CredentialsFromEnv prefers AWS_* over JSKELET_S3_*", () => {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.JSKELET_S3_ACCESS_KEY_ID;
  delete process.env.JSKELET_S3_SECRET_ACCESS_KEY;
  delete process.env.JSKELET_S3_SESSION_TOKEN;

  process.env.JSKELET_S3_ACCESS_KEY_ID = "jsk-key";
  process.env.JSKELET_S3_SECRET_ACCESS_KEY = "jsk-secret";
  assert.deepEqual(readS3CredentialsFromEnv(), {
    accessKeyId: "jsk-key",
    secretAccessKey: "jsk-secret",
    sessionToken: null,
  });

  process.env.AWS_ACCESS_KEY_ID = "aws-key";
  process.env.AWS_SECRET_ACCESS_KEY = "aws-secret";
  process.env.AWS_SESSION_TOKEN = "aws-sess";
  assert.deepEqual(readS3CredentialsFromEnv(), {
    accessKeyId: "aws-key",
    secretAccessKey: "aws-secret",
    sessionToken: "aws-sess",
  });
});

test("contentTypeFor and listFilesRecursive skip br/gz", () => {
  assert.equal(contentTypeFor("x.js"), "application/javascript; charset=utf-8");
  assert.equal(contentTypeFor("x.woff2"), "font/woff2");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-list-"));
  try {
    fs.writeFileSync(path.join(dir, "a.js"), "1");
    fs.writeFileSync(path.join(dir, "a.js.br"), "2");
    fs.writeFileSync(path.join(dir, "a.js.gz"), "3");
    const names = listFilesRecursive(dir).map((f) => path.basename(f));
    assert.deepEqual(names, ["a.js"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** @returns {import('../src/config/index.js').ResolvedConfig} */
function uploadConfig(root, upload) {
  const publicDir = path.join(root, "public");
  const assetsDir = path.join(publicDir, "assets");
  return {
    root,
    loaded: true,
    dirs: {
      public: publicDir,
      assets: assetsDir,
      fonts: path.join(publicDir, "fonts"),
      generated: path.join(root, ".jskelet"),
      client: path.join(root, "client"),
      views: path.join(root, "views"),
      routes: path.join(root, "routes"),
      styles: path.join(root, "styles.css"),
      features: path.join(root, "features"),
      shared: path.join(root, "shared"),
    },
    build: {
      client: { splitting: true, groups: {}, chunkGroup: null },
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
          ...upload,
        },
      },
    },
  };
}

test("assetsUploadSkipReason explains why upload is off", () => {
  const root = "/tmp/jskelet-skip";
  assert.equal(
    assetsUploadSkipReason(uploadConfig(root, { enabled: false, bucket: null })),
    "no build.assets.upload.bucket",
  );
  assert.equal(
    assetsUploadSkipReason(
      uploadConfig(root, { enabled: false, bucket: "kept" }),
    ),
    "build.assets.upload.enabled is false",
  );
  // Credential async (task role); sync skip yalnızca config kapısı.
  assert.equal(
    assetsUploadSkipReason(
      uploadConfig(root, { enabled: true, bucket: "app-assets" }),
    ),
    null,
  );
});

test("uploadAssets uses resolveCredentials (task role path)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-role-"));
  const assetsDir = path.join(root, "public", "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, "a.js"), "1");

  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;

  const config = uploadConfig(root, {
    enabled: true,
    bucket: "static.investvio.dev",
    keyPrefix: "js",
  });
  initBuildPaths(config);

  /** @type {import('../src/server/logs/s3-put.js').PutObjectInput[]} */
  const puts = [];
  await uploadAssets(config, {
    resolveCredentials: async () => ({
      accessKeyId: "ASIAFROMROLE",
      secretAccessKey: "role-secret",
      sessionToken: "role-token",
    }),
    put: async (input) => {
      puts.push(input);
    },
  });

  assert.equal(puts.length, 1);
  assert.equal(puts[0].credentials.accessKeyId, "ASIAFROMROLE");
  assert.equal(puts[0].credentials.sessionToken, "role-token");
  assert.equal(puts[0].key, "js/assets/a.js");
  fs.rmSync(root, { recursive: true, force: true });
});

test("uploadAssets puts objects with content-type and cache-control", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-up-"));
  const publicDir = path.join(root, "public");
  const assetsDir = path.join(publicDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, "app.abc.css"), "body{}");

  process.env.AWS_ACCESS_KEY_ID = "AKIA";
  process.env.AWS_SECRET_ACCESS_KEY = "secret";

  const config = uploadConfig(root, {
    enabled: true,
    bucket: "app-assets",
    keyPrefix: "static/",
    region: "eu-central-1",
  });

  initBuildPaths(config);

  /** @type {import('../src/server/logs/s3-put.js').PutObjectInput[]} */
  const puts = [];
  await uploadAssets(config, {
    put: async (input) => {
      puts.push(input);
    },
  });

  assert.equal(puts.length, 1);
  assert.equal(puts[0].bucket, "app-assets");
  assert.equal(puts[0].key, "static/assets/app.abc.css");
  assert.equal(puts[0].contentType, "text/css; charset=utf-8");
  assert.equal(puts[0].cacheControl, "public, max-age=31536000, immutable");
  assert.equal(puts[0].body.toString(), "body{}");

  fs.rmSync(root, { recursive: true, force: true });
});
