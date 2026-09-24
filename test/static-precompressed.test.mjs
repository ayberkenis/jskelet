/**
 * Üretimde precompressed `stat` sonucu bellekte kalır. Olumsuz sonuç da:
 * dosya sonradan gelse bile aynı süreç ikinci kez diske bakmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, test } from "node:test";
import { Writable } from "node:stream";
import { staticPrecompressed } from "../src/server/middleware/static-precompressed.js";

/** @type {string[]} */
const temps = [];

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/**
 * @param {import('express').RequestHandler} mw
 * @param {string} urlPath
 * @returns {Promise<{ next: boolean, encoding?: string }>}
 */
function run(mw, urlPath) {
  return new Promise((resolve, reject) => {
    const req = {
      method: "GET",
      path: urlPath,
      headers: { "accept-encoding": "br" },
    };
    const res = new Writable({
      write(_chunk, _enc, callback) {
        callback();
      },
    });
    /** @type {Record<string, string>} */
    const headers = {};
    Object.assign(res, {
      setHeader(name, value) {
        headers[name] = String(value);
      },
    });
    res.on("error", reject);

    mw(req, /** @type {import('express').Response} */ (res), () => {
      resolve({ next: true });
    });

    res.on("finish", () => {
      resolve({ next: false, encoding: headers["Content-Encoding"] });
    });
  });
}

test("production caches a missing precompressed file", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jskelet-static-"));
  temps.push(dir);
  await fs.mkdir(path.join(dir, "assets"));

  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const mw = staticPrecompressed(dir);
    assert.equal((await run(mw, "/assets/app.js")).next, true);

    await fs.writeFile(path.join(dir, "assets", "app.js.br"), "compressed");
    assert.equal((await run(mw, "/assets/app.js")).next, true);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("development sees a precompressed file that appears later", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jskelet-static-"));
  temps.push(dir);
  await fs.mkdir(path.join(dir, "assets"));

  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const mw = staticPrecompressed(dir);
    assert.equal((await run(mw, "/assets/app.js")).next, true);

    await fs.writeFile(path.join(dir, "assets", "app.js.br"), "compressed");
    const hit = await run(mw, "/assets/app.js");
    assert.equal(hit.next, false);
    assert.equal(hit.encoding, "br");
  } finally {
    process.env.NODE_ENV = prev;
  }
});
