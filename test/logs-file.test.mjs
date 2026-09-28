/**
 * Dosya sink + pipeline kinds filtresi.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, test } from "node:test";
import * as log from "../src/log.mjs";
import { createFileSink } from "../src/server/logs/file-sink.js";
import {
  acceptLogEntry,
  closeLogs,
  configureLogs,
} from "../src/server/logs/pipeline.js";

/** @type {string[]} */
const temps = [];

afterEach(async () => {
  await closeLogs();
  for (const dir of temps.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/** @returns {Promise<string>} */
async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jskelet-logs-"));
  temps.push(dir);
  return dir;
}

/**
 * @param {string} dir
 * @returns {Promise<string>}
 */
async function onlyChunk(dir) {
  const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".ndjson.zst"));
  assert.equal(names.length, 1);
  return path.join(dir, names[0]);
}

/**
 * @param {string} file
 * @returns {Promise<object[]>}
 */
async function readChunk(file) {
  const compressed = await fs.readFile(file);
  const text = zlib.zstdDecompressSync(compressed).toString("utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

test("file sink writes zstd NDJSON chunks", async () => {
  const root = await tempDir();
  const sink = createFileSink({ root, dir: "out" });

  await sink.write({ kind: "http", method: "GET", url: "/", status: 200, at: Date.UTC(2026, 8, 2) });
  await sink.write({ kind: "event", scope: "css", message: "rebuilt", at: Date.UTC(2026, 8, 2) });
  await sink.flush();

  const lines = await readChunk(await onlyChunk(path.join(root, "out")));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].kind, "http");
  assert.equal(lines[1].scope, "css");
});

test("file sink holds lines until flush", async () => {
  const root = await tempDir();
  const sink = createFileSink({ root, dir: "out" });
  const dir = path.join(root, "out");

  await sink.write({ kind: "event", message: "later", at: Date.UTC(2026, 8, 2) });
  await assert.rejects(fs.readdir(dir));

  await sink.flush();
  const lines = await readChunk(await onlyChunk(dir));
  assert.equal(lines[0].message, "later");
  await sink.close();
});

test("chunks older than the retention window are deleted oldest first", async () => {
  const root = await tempDir();
  const dir = path.join(root, "out");
  await fs.mkdir(dir);
  const stale = path.join(dir, "jskelet-old.ndjson.zst");
  const fresh = path.join(dir, "jskelet-fresh.ndjson.zst");
  await fs.writeFile(stale, "old");
  await fs.writeFile(fresh, "fresh");
  const past = new Date(Date.now() - 6 * 60 * 1000);
  await fs.utimes(stale, past, past);

  const sink = createFileSink({ root, dir: "out", retentionMs: 5 * 60 * 1000 });
  await sink.write({ kind: "event", message: "now" });
  await sink.flush();

  await assert.rejects(fs.stat(stale));
  await fs.stat(fresh);
  const names = await fs.readdir(dir);
  assert.equal(names.filter((name) => name.endsWith(".ndjson.zst")).length, 2);
});

test("drainLog receives the zstd chunk and a throw does not fail the write", async () => {
  const root = await tempDir();
  /** @type {import('../src/server/logs/file-sink.js').LogChunk[]} */
  const got = [];
  const sink = createFileSink({
    root,
    dir: "out",
    persist: false,
    drainLog(chunk) {
      got.push(chunk);
    },
  });

  await sink.write({ kind: "event", message: "ship" });
  await sink.flush();

  assert.equal(got.length, 1);
  assert.equal(got[0].encoding, "zstd");
  assert.equal(got[0].lines, 1);
  const text = zlib.zstdDecompressSync(got[0].body).toString("utf8");
  assert.equal(JSON.parse(text).message, "ship");
  await assert.rejects(fs.readdir(path.join(root, "out")));

  const broken = createFileSink({
    root,
    dir: "out",
    persist: false,
    drainLog() {
      throw new Error("collector down");
    },
  });
  await broken.write({ kind: "event", message: "still" });
  await broken.flush();
});

test("pipeline kinds filter skips unlisted kinds", async () => {
  const root = await tempDir();

  await configureLogs({
    root,
    logs: {
      console: false,
      kinds: ["error"],
      file: { enabled: true, dir: "out", rotate: "daily" },
      s3: {
        enabled: false,
        bucket: null,
        prefix: "jskelet/logs/",
        region: null,
        endpoint: null,
        flushIntervalMs: 5000,
        maxBatch: 100,
      },
    },
  });

  acceptLogEntry({ kind: "http", method: "GET", url: "/x", status: 200 });
  acceptLogEntry({ kind: "error", scope: "boom", message: "fail" });
  log.event({ scope: "css", message: "rebuilt" });

  // subscribe async değil ama write Promise; kısa bekle.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await closeLogs();

  const names = (await fs.readdir(path.join(root, "out"))).filter((name) =>
    name.endsWith(".ndjson.zst"),
  );
  assert.equal(names.length, 1);
  const text = zlib
    .zstdDecompressSync(await fs.readFile(path.join(root, "out", names[0])))
    .toString("utf8");
  const lines = text.trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "error");
  assert.equal(lines[0].message, "fail");
});
