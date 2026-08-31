/**
 * Isıtma turunun tekrar denemesi.
 *
 * İki davranış: kalıcı hatalar tekrar turuna girmez (403'ü yeniden denemek
 * kotadan karşılıksız yer) ve geçici hatalar girer — çünkü aynı yol saniyeler
 * sonra 200 dönüyor ve ziyaretçinin soğuk render'ı ödemesine gerek yok.
 *
 * Sunucu gerçek: ısıtma turu HTTP üzerinden çalıştığı için tarama yolunu
 * taklit etmenin anlamı yok.
 */
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import { prewarm } from "../src/server/prewarm.js";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "prewarm-app");

/** @type {http.Server} */
let server;
let origin = "";

/** @type {Map<string, number>} */
const hits = new Map();

before(async () => {
  await loadConfig({ root: FIXTURE, force: true });

  // Tekrar beklemesi turun kendisinden uzun sürmesin; ayarın env'den okunduğu
  // da böylece doğrulanıyor.
  process.env.PREWARM_RETRY_DELAY_MS = "10";

  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const seen = (hits.get(url) ?? 0) + 1;
    hits.set(url, seen);

    if (url === "/permanent") {
      res.writeHead(403).end("forbidden");
      return;
    }

    // İlk denemede rate limit, ikincisinde gerçek içerik.
    if (url === "/flaky") {
      if (seen === 1) res.writeHead(429, { "retry-after": "0" }).end("slow down");
      else res.writeHead(200).end("<html>ok</html>");
      return;
    }

    res.writeHead(200).end("<html>ok</html>");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(null)));

  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  origin = `http://127.0.0.1:${address.port}`;
});

after(() => {
  delete process.env.PREWARM_RETRY_DELAY_MS;
  server?.close();
});

test("kalıcı hata tekrar denenmez, geçici hata denenir", async () => {
  hits.clear();

  const result = await prewarm({
    origin,
    quiet: true,
    paths: ["/ok", "/permanent", "/flaky"],
  });

  assert.equal(hits.get("/permanent"), 1, "403 yeniden denenmemeliydi");
  assert.equal(hits.get("/flaky"), 2, "429 bir kez daha denenmeliydi");
  assert.equal(hits.get("/ok"), 1);

  // /ok ve tekrar turunda kurtulan /flaky başarılı; yalnızca /permanent hata.
  assert.equal(result.ok, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.total, 3);
});

test("hiç geçici hata yoksa tekrar turu hiç kurulmaz", async () => {
  hits.clear();

  const result = await prewarm({ origin, quiet: true, paths: ["/permanent"] });

  assert.equal(hits.get("/permanent"), 1);
  assert.equal(result.ok, 0);
  assert.equal(result.failed, 1);
});
