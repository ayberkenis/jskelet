/**
 * Admin paneli: mount, IP/bot kapısı, oturum, log ring.
 */
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server/create-app.js";
import { PASSWORD } from "../src/server/admin/auth.js";
import { looksLikeBot, ipAllowed } from "../src/server/admin/gate.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "admin-app");

/**
 * @param {http.Server} server
 * @param {string} pathname
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [options]
 */
function request(server, pathname, options = {}) {
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: pathname,
        method: options.method ?? "GET",
        headers: options.headers ?? {},
      },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test("gate helpers: bots and CIDR", () => {
  assert.equal(looksLikeBot("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
  assert.equal(looksLikeBot("Mozilla/5.0 Chrome/120.0"), false);
  assert.equal(ipAllowed("10.0.0.5", ["10.0.0.0/8"]), true);
  assert.equal(ipAllowed("11.0.0.5", ["10.0.0.0/8"]), false);
  assert.equal(ipAllowed("203.0.113.10", []), true);
});

test("admin panel: login, data, bot and logs", async () => {
  const previous = process.env.JSKELET_ADMIN;
  process.env.JSKELET_ADMIN = "1";

  try {
    const app = await createApp({ root: ROOT, force: true });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(null)));

    try {
      const bot = await request(server, "/_jskelet/admin/", {
        headers: { "user-agent": "Googlebot/2.1" },
      });
      assert.equal(bot.status, 404);

      const open = await request(server, "/_jskelet/admin/", {
        headers: { "user-agent": "Mozilla/5.0 Test" },
      });
      assert.equal(open.status, 200);
      assert.match(open.body, /login|password|Admin/i);

      const denied = await request(server, "/_jskelet/admin/data", {
        headers: { "user-agent": "Mozilla/5.0 Test", Accept: "application/json" },
      });
      assert.equal(denied.status, 404);

      const login = await request(server, "/_jskelet/admin/login", {
        method: "POST",
        headers: {
          "user-agent": "Mozilla/5.0 Test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: PASSWORD }),
      });
      assert.equal(login.status, 200);
      const cookie = String(login.headers["set-cookie"] ?? "");
      assert.match(cookie, /jskelet_admin_sid=/);

      const data = await request(server, "/_jskelet/admin/data", {
        headers: {
          "user-agent": "Mozilla/5.0 Test",
          Accept: "application/json",
          cookie: cookie.split(";")[0],
        },
      });
      assert.equal(data.status, 200);
      const payload = JSON.parse(data.body);
      assert.ok(payload.html);
      assert.ok(payload.process);

      // Bir site isteği ring'e düşsün.
      await request(server, "/", { headers: { "user-agent": "Mozilla/5.0 Test" } });

      const logs = await request(server, "/_jskelet/admin/api/logs?limit=50", {
        headers: {
          "user-agent": "Mozilla/5.0 Test",
          Accept: "application/json",
          cookie: cookie.split(";")[0],
        },
      });
      assert.equal(logs.status, 200);
      const logPayload = JSON.parse(logs.body);
      assert.ok(Array.isArray(logPayload.entries));

      const streamDenied = await request(server, "/_jskelet/admin/api/logs/stream", {
        headers: { "user-agent": "Mozilla/5.0 Test", Accept: "text/event-stream" },
      });
      assert.equal(streamDenied.status, 404);
    } finally {
      await new Promise((resolve) => server.close(() => resolve(null)));
    }
  } finally {
    if (previous === undefined) delete process.env.JSKELET_ADMIN;
    else process.env.JSKELET_ADMIN = previous;
  }
});
