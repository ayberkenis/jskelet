/**
 * DEV_TOKEN ortamda durması siteyi kilitlemez. Gate açıkça açılınca 404 keser.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { afterEach, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import { devGate } from "../src/server/middleware/dev-gate.js";

const ON = path.join(import.meta.dirname, "fixtures", "dev-gate-app");
const OFF = path.join(import.meta.dirname, "fixtures", "prewarm-onvisit-app");

const saved = {
  token: process.env.DEV_TOKEN,
  gate: process.env.DEV_GATE,
};

afterEach(() => {
  restore("DEV_TOKEN", saved.token);
  restore("DEV_GATE", saved.gate);
});

/**
 * @param {string} key
 * @param {string | undefined} value
 */
function restore(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/**
 * @param {import('express').RequestHandler} handler
 * @param {{ path: string, query?: Record<string, string>, headers?: Record<string, string> }} req
 */
function run(handler, req) {
  return new Promise((resolve) => {
    /** @type {{ statusCode: number, headers: Record<string, string>, body: string, passed: boolean }} */
    const res = {
      statusCode: 200,
      headers: {},
      body: "",
      passed: false,
      /** @param {number} code */
      status(code) {
        this.statusCode = code;
        return this;
      },
      type() {
        return this;
      },
      /** @param {string} body */
      send(body) {
        this.body = body;
        resolve(this);
      },
      /** @param {string} name @param {string} value */
      setHeader(name, value) {
        this.headers[name] = value;
      },
    };

    req.headers = req.headers ?? {};
    req.query = req.query ?? {};

    handler(
      /** @type {import('express').Request} */ (req),
      /** @type {import('express').Response} */ (res),
      () => {
        res.passed = true;
        resolve(res);
      },
    );
  });
}

test("DEV_TOKEN alone does not require a token", async () => {
  process.env.DEV_TOKEN = "gizli";
  delete process.env.DEV_GATE;
  await loadConfig({ root: OFF, force: true });

  /** @type {string[]} */
  const warnings = [];
  const original = console.warn;
  console.warn = (/** @type {unknown[]} */ ...args) => {
    warnings.push(args.map(String).join(" "));
  };

  try {
    const handler = devGate();
    const res = await run(handler, { path: "/", query: {} });
    assert.equal(res.passed, true);
    assert.match(warnings.join("\n"), /gate is off/);
  } finally {
    console.warn = original;
  }
});

test("an enabled gate rejects a request without the token", async () => {
  process.env.DEV_TOKEN = "gizli";
  delete process.env.DEV_GATE;
  await loadConfig({ root: ON, force: true });

  const res = await run(devGate(), { path: "/haber", query: {} });
  assert.equal(res.passed, false);
  assert.equal(res.statusCode, 404);
});

test("the query token is accepted and stored as a cookie", async () => {
  process.env.DEV_TOKEN = "gizli";
  delete process.env.DEV_GATE;
  await loadConfig({ root: ON, force: true });

  const res = await run(devGate(), {
    path: "/",
    query: { dev_token: "gizli" },
    headers: {},
  });
  assert.equal(res.passed, true);
  assert.match(res.headers["Set-Cookie"], /^dev_token=gizli;/);
});

test("a bypass path stays open while the gate is on", async () => {
  process.env.DEV_TOKEN = "gizli";
  delete process.env.DEV_GATE;
  await loadConfig({ root: ON, force: true });

  const res = await run(devGate(), { path: "/api/healthcheck", query: {} });
  assert.equal(res.passed, true);
});

test("DEV_GATE=0 turns off a config-enabled gate", async () => {
  process.env.DEV_TOKEN = "gizli";
  process.env.DEV_GATE = "0";
  await loadConfig({ root: ON, force: true });

  const res = await run(devGate(), { path: "/", query: {} });
  assert.equal(res.passed, true);
});

test("an enabled gate with an empty token does not block", async () => {
  delete process.env.DEV_TOKEN;
  delete process.env.DEV_GATE;
  await loadConfig({ root: ON, force: true });

  const original = console.warn;
  console.warn = () => {};
  try {
    const res = await run(devGate(), { path: "/", query: {} });
    assert.equal(res.passed, true);
  } finally {
    console.warn = original;
  }
});
