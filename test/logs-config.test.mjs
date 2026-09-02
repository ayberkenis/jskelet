/**
 * `normalizeLogs` birim testleri.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { normalizeLogs } from "../src/config/index.js";

const saved = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

test("normalizeLogs: defaults when empty", () => {
  const logs = normalizeLogs(null);
  assert.equal(logs.console, true);
  assert.deepEqual(logs.kinds, ["http", "event", "error"]);
  assert.equal(logs.file.enabled, false);
  assert.equal(logs.file.dir, "logs");
  assert.equal(logs.s3.enabled, false);
  assert.equal(logs.s3.bucket, null);
});

test("normalizeLogs: kinds filter drops unknowns and dedupes", () => {
  const logs = normalizeLogs({
    kinds: ["http", "nope", "http", "error"],
  });
  assert.deepEqual(logs.kinds, ["http", "error"]);
});

test("normalizeLogs: empty kinds falls back to defaults", () => {
  const logs = normalizeLogs({ kinds: ["nope"] });
  assert.deepEqual(logs.kinds, ["http", "event", "error"]);
});

test("normalizeLogs: JSKELET_LOG_BUCKET overrides; JSKELET_S3_REGION fills when unset", () => {
  process.env.JSKELET_LOG_BUCKET = "env-bucket";
  process.env.JSKELET_S3_REGION = "eu-central-1";

  const withConfigRegion = normalizeLogs({
    s3: {
      enabled: true,
      bucket: "config-bucket",
      region: "us-east-1",
      prefix: "app/",
      flushIntervalMs: 2000,
      maxBatch: 50,
    },
  });

  assert.equal(withConfigRegion.s3.enabled, true);
  assert.equal(withConfigRegion.s3.bucket, "env-bucket");
  assert.equal(withConfigRegion.s3.region, "us-east-1");
  assert.equal(withConfigRegion.s3.prefix, "app/");
  assert.equal(withConfigRegion.s3.flushIntervalMs, 2000);
  assert.equal(withConfigRegion.s3.maxBatch, 50);

  const fromEnv = normalizeLogs({
    s3: { enabled: true, bucket: "config-bucket" },
  });
  assert.equal(fromEnv.s3.region, "eu-central-1");
});

test("normalizeLogs: bucket path splits into bucket + prefix", () => {
  process.env.JSKELET_LOG_BUCKET = "ayberkenis/jskelet/logs";

  const fromEnv = normalizeLogs({
    s3: { enabled: true, prefix: "ignored/" },
  });
  assert.equal(fromEnv.s3.bucket, "ayberkenis");
  assert.equal(fromEnv.s3.prefix, "jskelet/logs/");

  const fromConfig = normalizeLogs({
    s3: { enabled: true, bucket: "ayberkenis/jskelet/logs/" },
  });
  assert.equal(fromConfig.s3.bucket, "ayberkenis");
  assert.equal(fromConfig.s3.prefix, "jskelet/logs/");
});

test("normalizeLogs: JSKELET_S3_API_URL sets endpoint and defaults region to auto", () => {
  process.env.JSKELET_LOG_BUCKET = "ayberkenis/jskelet/logs";
  process.env.JSKELET_S3_API_URL =
    "https://95b2c4d0d4558018edfad72708f1bc90.r2.cloudflarestorage.com";

  const logs = normalizeLogs({ s3: { enabled: true } });
  assert.equal(logs.s3.bucket, "ayberkenis");
  assert.equal(logs.s3.prefix, "jskelet/logs/");
  assert.equal(
    logs.s3.endpoint,
    "https://95b2c4d0d4558018edfad72708f1bc90.r2.cloudflarestorage.com",
  );
  assert.equal(logs.s3.region, "auto");
});

test("normalizeLogs: console false and file dir", () => {
  const logs = normalizeLogs({
    console: false,
    file: { enabled: true, dir: "var/log" },
  });
  assert.equal(logs.console, false);
  assert.equal(logs.file.enabled, true);
  assert.equal(logs.file.dir, "var/log");
  assert.equal(logs.file.rotate, "daily");
});
