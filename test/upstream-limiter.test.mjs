/**
 * Upstream hız freni.
 *
 * Dosyanın varlık sebebi üretimde görülen bir davranış: ısıtma turu API'yi
 * 429'a düşürüyor, 429 geçici sayıldığı için üretilen HTML önbelleğe
 * yazılmıyor ve tur kotayı harcayıp karşılığında hiçbir şey saklamıyor. Bu
 * testler frenin dört sözünü tutuyor mu diye bakıyor: ortalama hız, anlık
 * baskı, 429'a tepki ve devre kesici.
 *
 * Zaman gerçek ama küçük: sahte saat kurmak, `setTimeout` ile yazılmış
 * beklemeyi de taklit etmek demek olurdu ve test asıl davranışı değil
 * enjeksiyonu doğrulardı.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getUpstreamLimiterStatus,
  limitUpstream,
  noteUpstreamResponse,
  resetUpstreamLimiterForTests,
} from "../src/server/upstream-limiter.js";
import {
  trackUpstreamFetch,
  withUpstreamTracking,
} from "../src/server/upstream-tracking.js";

afterEach(() => {
  resetUpstreamLimiterForTests({});
});

const URL_A = "https://api.example.com/v1/quotes";

/** @param {string} host */
function statusOf(host) {
  return getUpstreamLimiterStatus().find((entry) => entry.host === host);
}

test("fren kapalıyken hiçbir çağrı beklemez", async () => {
  resetUpstreamLimiterForTests({});

  const started = Date.now();
  for (let i = 0; i < 50; i += 1) {
    const permit = await limitUpstream(URL_A);
    assert.equal(permit, null);
  }

  assert.ok(Date.now() - started < 50);
  assert.deepEqual(getUpstreamLimiterStatus(), []);
});

test("ortalama hız verilen tavanı aşmaz", async () => {
  // 20/s ve tek tokenlik kova: ilk çağrı hemen, sonraki ikisi 50ms arayla.
  resetUpstreamLimiterForTests({ rate: 20, burst: 1 });

  const started = Date.now();
  for (let i = 0; i < 3; i += 1) {
    const permit = await limitUpstream(URL_A);
    assert.equal(permit?.blocked, false);
    permit?.release();
  }

  assert.ok(Date.now() - started >= 90, "iki bekleme birikmeliydi");
});

test("kova boyu kadar patlamaya izin verilir", async () => {
  resetUpstreamLimiterForTests({ rate: 1, burst: 5 });

  const started = Date.now();
  for (let i = 0; i < 5; i += 1) {
    (await limitUpstream(URL_A))?.release();
  }

  assert.ok(Date.now() - started < 50, "kova doluyken beklenmemeli");
});

test("eşzamanlılık limiti aşılmaz", async () => {
  resetUpstreamLimiterForTests({ rate: 1000, burst: 1000, concurrency: 2 });

  const first = await limitUpstream(URL_A);
  const second = await limitUpstream(URL_A);
  assert.equal(statusOf("api.example.com")?.active, 2);

  let thirdAdmitted = false;
  const third = limitUpstream(URL_A).then((permit) => {
    thirdAdmitted = true;
    return permit;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(thirdAdmitted, false, "üçüncü çağrı yuva beklemeliydi");

  first?.release();
  (await third)?.release();
  second?.release();

  assert.equal(statusOf("api.example.com")?.active, 0);
});

test("429 hızı yarıya indirir, başarı sayacı sıfırlar", async () => {
  resetUpstreamLimiterForTests({ rate: 8, burst: 8, decreaseIntervalMs: 0 });

  (await limitUpstream(URL_A))?.release();
  assert.equal(statusOf("api.example.com")?.rate, 8);

  noteUpstreamResponse("api.example.com", 429);
  assert.equal(statusOf("api.example.com")?.rate, 4);

  noteUpstreamResponse("api.example.com", 429);
  assert.equal(statusOf("api.example.com")?.rate, 2);

  // 500 bir kota sorunu değil: yavaşlamak arızayı düzeltmez.
  noteUpstreamResponse("api.example.com", 500);
  assert.equal(statusOf("api.example.com")?.rate, 2);
  assert.equal(statusOf("api.example.com")?.bypassed, false);
});

test("hız minRate'in altına inmez", async () => {
  resetUpstreamLimiterForTests({
    rate: 4,
    minRate: 1,
    decreaseIntervalMs: 0,
    breakerFailures: 100,
  });

  (await limitUpstream(URL_A))?.release();
  for (let i = 0; i < 10; i += 1) noteUpstreamResponse("api.example.com", 429);

  assert.equal(statusOf("api.example.com")?.rate, 1);
});

test("Retry-After boyunca hiç token verilmez", async () => {
  resetUpstreamLimiterForTests({ rate: 1000, burst: 1000, decreaseIntervalMs: 0 });

  (await limitUpstream(URL_A))?.release();
  noteUpstreamResponse("api.example.com", 429, "0.1");

  assert.ok((statusOf("api.example.com")?.blockedMs ?? 0) > 0);

  const started = Date.now();
  (await limitUpstream(URL_A))?.release();
  assert.ok(Date.now() - started >= 90, "beklemeden geçilmemeliydi");
});

test("devre kesici art arda 429'dan sonra çağrıyı hiç yapmaz", async () => {
  resetUpstreamLimiterForTests({
    rate: 1000,
    burst: 1000,
    decreaseIntervalMs: 0,
    breakerFailures: 3,
    breakerCooldownMs: 60_000,
  });

  (await limitUpstream(URL_A))?.release();
  for (let i = 0; i < 3; i += 1) noteUpstreamResponse("api.example.com", 429);

  const permit = await limitUpstream(URL_A);
  assert.equal(permit?.blocked, true, "kesici açıkken izin verilmemeli");

  const status = statusOf("api.example.com");
  assert.equal(status?.bypassed, true);
  assert.equal(status?.rejected, 1);
  assert.equal(status?.throttled, 3);
});

test("host bazlı ayar kendi kotasını korur", async () => {
  resetUpstreamLimiterForTests({
    rate: 1000,
    burst: 1000,
    hosts: { "slow.example.com": { rate: 20, burst: 1 } },
  });

  const started = Date.now();
  (await limitUpstream("https://slow.example.com/a"))?.release();
  (await limitUpstream("https://slow.example.com/b"))?.release();
  const slow = Date.now() - started;

  const fastStarted = Date.now();
  (await limitUpstream("https://fast.example.com/a"))?.release();
  (await limitUpstream("https://fast.example.com/b"))?.release();

  assert.ok(slow >= 40, "yavaş host kendi hızıyla frenlenmeliydi");
  assert.ok(Date.now() - fastStarted < 30, "hızlı host etkilenmemeliydi");
});

test("URL çözülemezse fren devreye girmez", async () => {
  resetUpstreamLimiterForTests({ rate: 1 });

  assert.equal(await limitUpstream("not a url"), null);
});

/**
 * Sarmalayıcıyla birlikte: ağa çıkmadan, `globalThis.fetch` yerine sayan bir
 * sahte konuyor. Amaç frenin gerçek çağrı yolunda devreye girdiğini ve
 * kesici açıldığında upstream'e hiç gidilmediğini görmek.
 */
test("kesici açıldığında sarmalayıcı çağrıyı hiç yapmaz", async () => {
  resetUpstreamLimiterForTests({
    rate: 1000,
    burst: 1000,
    decreaseIntervalMs: 0,
    breakerFailures: 2,
    breakerCooldownMs: 60_000,
  });

  const original = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 429, headers: { "retry-after": "0" } });
  };

  try {
    trackUpstreamFetch();

    /** @type {number[]} */
    const seen = [];
    await withUpstreamTracking(async () => {
      for (let i = 0; i < 5; i += 1) {
        const response = await globalThis.fetch("https://limited.example.com/v1/x");
        seen.push(response.status);
      }
    });

    assert.deepEqual(seen, [429, 429, 429, 429, 429], "her çağrı 429 görmeli");
    assert.equal(calls, 2, "kesici açıldıktan sonra upstream'e gidilmemeli");
    assert.equal(statusOf("limited.example.com")?.bypassed, true);
    assert.equal(statusOf("limited.example.com")?.rejected, 3);
  } finally {
    globalThis.fetch = original;
  }
});
