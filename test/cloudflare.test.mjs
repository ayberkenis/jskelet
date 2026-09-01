/**
 * Cloudflare cache yüzeyi. Gerçek bir zone gerektiren test yazılmıyor;
 * doğrulanması gereken şey ağ değil **sözleşme**: purge'ün 100'lük partilere
 * bölünmesi, hata durumunda fırlatmak yerine `{ ok: false }` dönmesi, token'ın
 * hiçbir dönüş değerine sızmaması ve yol → tam URL çevrimi.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import process from "node:process";
import {
  cloudflareConfigured,
  fetchCacheAnalytics,
  fetchPathEdges,
  getCloudflareStatus,
  purgeCloudflare,
  setCloudflareSetting,
  toCloudflareUrls,
} from "../src/server/cloudflare.js";

const TOKEN = "cf-token-do-not-leak";
const originalFetch = globalThis.fetch;

/** @type {{ url: string, method: string, body: any, auth: string | null }[]} */
let calls = [];

/**
 * @param {(request: { url: string, body: any }) => { status?: number, payload: any }} handler
 */
function stubFetch(handler) {
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(String(options.body)) : null;
    calls.push({
      url: String(url),
      method: options.method ?? "GET",
      body,
      auth: new Headers(options.headers).get("authorization"),
    });

    const { status = 200, payload } = handler({ url: String(url), body });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

beforeEach(() => {
  calls = [];
  process.env.JSKELET_CLOUDFLARE_KEY = TOKEN;
  process.env.JSKELET_CLOUDFLARE_ZONE_ID = "zone-abcd1234";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.JSKELET_CLOUDFLARE_KEY;
  delete process.env.JSKELET_CLOUDFLARE_ZONE_ID;
  delete process.env.JSKELET_CLOUDFLARE_HOSTNAME;
});

/* ------------------------------------------------------------------ kurulum */

test("the token comes from the environment and never leaves the server", () => {
  assert.equal(cloudflareConfigured(), true);

  const status = getCloudflareStatus();
  assert.equal(status.configured, true);
  assert.equal(status.tokenSource, "env");
  assert.equal(status.zoneId, "…1234", "zone kimliğinin yalnızca sonu gösterilir");
  assert.ok(!JSON.stringify(status).includes(TOKEN), "token durum özetine girmemeli");
});

test("without a token nothing is configured and no request is made", async () => {
  delete process.env.JSKELET_CLOUDFLARE_KEY;
  stubFetch(() => ({ payload: { success: true } }));

  assert.equal(cloudflareConfigured(), false);

  const result = await purgeCloudflare({ everything: true });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0, "yapılandırılmamışken ağa çıkılmamalı");
});

/* -------------------------------------------------------------------- purge */

test("purge everything hits the zone endpoint with the documented body", async () => {
  stubFetch(() => ({ payload: { success: true, result: { id: "x" } } }));

  const result = await purgeCloudflare({ everything: true });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/zones/zone-abcd1234/purge_cache"));
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { purge_everything: true });
  assert.equal(calls[0].auth, `Bearer ${TOKEN}`);
});

test("long url lists are split into requests of 100", async () => {
  stubFetch(() => ({ payload: { success: true } }));

  const files = Array.from({ length: 250 }, (_, index) => `https://x.test/${index}`);
  const result = await purgeCloudflare({ files });

  assert.equal(result.ok, true);
  assert.equal(result.purged, 250);
  assert.equal(result.batches, 3, "Cloudflare istek başına 100 anahtar kabul ediyor");
  assert.equal(calls[0].body.files.length, 100);
  assert.equal(calls[2].body.files.length, 50);
});

test("duplicate keys are collapsed before purging", async () => {
  stubFetch(() => ({ payload: { success: true } }));

  const result = await purgeCloudflare({ tags: ["a", "a", "b", ""] });
  assert.equal(result.purged, 2);
  assert.deepEqual(calls[0].body, { tags: ["a", "b"] });
});

test("a cloudflare error is returned, not thrown", async () => {
  stubFetch(() => ({
    status: 403,
    payload: {
      success: false,
      errors: [{ code: 10000, message: "Authentication error" }],
    },
  }));

  const result = await purgeCloudflare({ everything: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, "Authentication error (10000)");
});

test("a network failure is returned, not thrown", async () => {
  globalThis.fetch = async () => {
    throw new Error("ECONNRESET");
  };

  const result = await purgeCloudflare({ everything: true });
  assert.equal(result.ok, false);
  assert.equal(result.error, "ECONNRESET");
});

test("an empty target is refused before any request", async () => {
  stubFetch(() => ({ payload: { success: true } }));

  const result = await purgeCloudflare({ files: [] });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

/* ---------------------------------------------------------------------- url */

test("paths become absolute urls through the configured hostname", () => {
  process.env.JSKELET_CLOUDFLARE_HOSTNAME = "example.com";

  assert.deepEqual(toCloudflareUrls(["/", "/blog?page=2"], "http://10.0.0.4:3000"), [
    "https://example.com/",
    "https://example.com/blog?page=2",
  ]);
});

test("without a hostname the request origin is the fallback", () => {
  assert.deepEqual(toCloudflareUrls(["/a"], "https://site.test"), ["https://site.test/a"]);
  assert.deepEqual(toCloudflareUrls(["/a"]), [], "kök yoksa URL üretilmez");
});

/* ----------------------------------------------------------------- ayarlar */

test("only cache related settings can be changed", async () => {
  stubFetch(() => ({ payload: { success: true, result: { value: "on" } } }));

  const allowed = await setCloudflareSetting("development_mode", "on");
  assert.equal(allowed.ok, true);
  assert.equal(allowed.value, "on");
  assert.ok(calls[0].url.endsWith("/settings/development_mode"));
  assert.equal(calls[0].method, "PATCH");

  const refused = await setCloudflareSetting(
    /** @type {any} */ ("security_level"),
    "high",
  );
  assert.equal(refused.ok, false);
  assert.equal(calls.length, 1, "beyaz liste dışındaki ayar için istek atılmamalı");
});

/* ---------------------------------------------------------------- analitik */

test("the cache status breakdown is read from the adaptive dataset", async () => {
  stubFetch(({ body }) => {
    assert.ok(body.query.includes("httpRequestsAdaptiveGroups"));
    assert.ok(body.variables.since, "pencere başlangıcı gönderilmeli");
    assert.ok(body.variables.until, "üst sınır sabitlenmeli — açık uç Free zone'da 1d'yi aşıyor");
    assert.ok(body.query.includes("datetime_leq"), "filter üst sınırı da taşımalı");

    const spanMs =
      Date.parse(body.variables.until) - Date.parse(body.variables.since);
    assert.equal(spanMs, 12 * 3600_000, "pencere tam N saat; ağ gecikmesi eklenmez");

    return {
      payload: {
        data: {
          viewer: {
            zones: [
              {
                httpRequestsAdaptiveGroups: [
                  { count: 90, sum: { edgeResponseBytes: 900 }, dimensions: { cacheStatus: "hit" } },
                  { count: 10, sum: { edgeResponseBytes: 100 }, dimensions: { cacheStatus: "miss" } },
                ],
              },
            ],
          },
        },
      },
    };
  });

  const result = await fetchCacheAnalytics({ hours: 12 });
  assert.equal(result.ok, true);
  assert.equal(result.hours, 12);
  assert.deepEqual(result.rows[0], { status: "hit", requests: 90, bytes: 900 });
});

test("per-path colo counts separate cache hits from origin traffic", async () => {
  stubFetch(({ body }) => {
    assert.equal(body.variables.path, "/blog");

    return {
      payload: {
        data: {
          viewer: {
            zones: [
              {
                httpRequestsAdaptiveGroups: [
                  { count: 7, dimensions: { coloCode: "IST", cacheStatus: "hit" } },
                  { count: 2, dimensions: { coloCode: "IST", cacheStatus: "miss" } },
                  { count: 4, dimensions: { coloCode: "FRA", cacheStatus: "hit" } },
                  { count: 1, dimensions: { coloCode: "FRA", cacheStatus: "expired" } },
                ],
              },
            ],
          },
        },
      },
    };
  });

  const result = await fetchPathEdges({ path: "/blog", hours: 6 });
  assert.equal(result.ok, true);
  assert.equal(result.hits, 11);
  // `expired` de origin'e giden bir istek; tek kolonda toplanır.
  assert.equal(result.misses, 3);
  assert.deepEqual(result.colos[0], { colo: "IST", hits: 7, misses: 2 });
});

test("a graphql error surfaces as a failed query", async () => {
  stubFetch(() => ({
    payload: { errors: [{ message: "unknown field cacheStatus" }], data: null },
  }));

  const result = await fetchCacheAnalytics({});
  assert.equal(result.ok, false);
  assert.equal(result.error, "unknown field cacheStatus");
});
