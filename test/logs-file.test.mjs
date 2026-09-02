/**
 * Dosya sink + pipeline kinds filtresi.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

test("file sink writes NDJSON lines", async () => {
  const root = await tempDir();
  const sink = createFileSink({ root, dir: "out" });

  await sink.write({ kind: "http", method: "GET", url: "/", status: 200, at: Date.UTC(2026, 8, 2) });
  await sink.write({ kind: "event", scope: "css", message: "rebuilt", at: Date.UTC(2026, 8, 2) });
  await sink.flush();

  const file = path.join(root, "out", "jskelet-2026-09-02.log");
  const text = await fs.readFile(file, "utf8");
  const lines = text.trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(lines.length, 2);
  assert.equal(lines[0].kind, "http");
  assert.equal(lines[1].scope, "css");
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

  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(root, "out", `jskelet-${day}.log`);
  const text = await fs.readFile(file, "utf8");
  const lines = text.trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, "error");
  assert.equal(lines[0].message, "fail");
});
