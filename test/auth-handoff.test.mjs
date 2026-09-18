/**
 * Alt alan handoff bileti.
 */
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import express from "express";
import { loadConfig } from "../src/config/index.js";
import {
  _handoffTicketCount,
  _resetHandoffTickets,
  mountAuthHandoff,
} from "../src/server/auth/handoff.js";

process.env.JSKELET_SECRET = "test-sirri";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "shared-cookie-app");

/** @type {import('http').Server} */
let server;
/** @type {string} */
let origin;

/** @returns {Record<string, string>} */
function localeHeaders(host) {
  return {
    "content-type": "application/json",
    "x-forwarded-host": host,
    "x-forwarded-proto": "https",
  };
}

before(async () => {
  await loadConfig({ root: FIXTURE, force: true });
  _resetHandoffTickets();

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  mountAuthHandoff(app);
  app.get("/ok", (_req, res) => res.type("text").send("ok"));

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(null)));
  const address = /** @type {import('net').AddressInfo} */ (server.address());
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  _resetHandoffTickets();
  await new Promise((resolve) => server.close(() => resolve(null)));
});

test("POST mints a one-time handoff URL under the shared root", async () => {
  _resetHandoffTickets();

  const response = await fetch(`${origin}/_jskelet/auth/handoff`, {
    method: "POST",
    headers: localeHeaders("en.investvio.com"),
    body: JSON.stringify({
      name: "sid",
      value: "session-1",
      next: "https://tr.investvio.com/panel",
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.url, /^https:\/\/tr\.investvio\.com\/panel\?handoff=/);
  assert.equal(_handoffTicketCount(), 1);
});

test("GET with handoff sets a cookie and redirects once", async () => {
  _resetHandoffTickets();

  const minted = await fetch(`${origin}/_jskelet/auth/handoff`, {
    method: "POST",
    headers: localeHeaders("en.investvio.com"),
    body: JSON.stringify({
      name: "sid",
      value: "session-2",
      next: "https://tr.investvio.com/ok",
    }),
  });
  const { url } = await minted.json();
  const ticket = new URL(url).searchParams.get("handoff");
  assert.ok(ticket);

  const redeem = await fetch(`${origin}/ok?handoff=${ticket}`, {
    redirect: "manual",
    headers: {
      "x-forwarded-host": "tr.investvio.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(redeem.status, 303);
  const setCookie = redeem.headers.getSetCookie?.() ?? [];
  const joined = setCookie.join("\n") || String(redeem.headers.get("set-cookie") ?? "");
  assert.match(joined, /sid=session-2/);
  assert.match(joined, /Domain=\.investvio\.com/);
  assert.equal(_handoffTicketCount(), 0);

  const again = await fetch(`${origin}/ok?handoff=${ticket}`, {
    redirect: "manual",
    headers: {
      "x-forwarded-host": "tr.investvio.com",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(again.status, 200);
});

test("POST rejects a JWT-sized value", async () => {
  const response = await fetch(`${origin}/_jskelet/auth/handoff`, {
    method: "POST",
    headers: localeHeaders("en.investvio.com"),
    body: JSON.stringify({
      name: "sid",
      value: "y".repeat(600),
      next: "https://tr.investvio.com/",
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
});
