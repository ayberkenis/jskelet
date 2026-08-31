/**
 * Paylaşımlı önbellek kademesi. Gerçek bir Redis gerektiren test yazılmıyor:
 * doğrulanması gereken şey ağ değil, **sözleşme** — serileştirme, soğuk
 * node'un promote etmesi, olayların döngüye girmemesi ve Redis hata verdiğinde
 * davranışın hiç değişmemesi.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearHtmlCache,
  getHtmlCacheEntries,
  getHtmlCacheSize,
  invalidateHtmlCache,
  withHtmlCache,
} from "../src/server/html-cache.js";
import {
  clearDataCache,
  getDataCacheSize,
  withDataCache,
} from "../src/server/data-cache.js";
import {
  emitRemoteCacheEventForTests,
  getRedisDetails,
  getRedisStatus,
  inspectRedis,
  setRedisClientForTests,
} from "../src/server/redis.js";

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `setRedisClientForTests` bu öneki kuruyor; anahtarları elle kurmak için. */
const PREFIX = "_jskelet:default:test";

/**
 * Bellek içi sahte istemci. Yalnızca bu katmanın kullandığı komutlar var.
 */
function createFakeRedis() {
  /** @type {Map<string, string>} */
  const store = new Map();
  /** @type {any[]} */
  const published = [];

  return {
    store,
    published,
    /** @param {string} key */
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    /** @param {string} key @param {string} value */
    async set(key, value) {
      store.set(key, value);
      return "OK";
    },
    /** @param {string[]} keys */
    async unlink(...keys) {
      let dropped = 0;
      for (const key of keys) if (store.delete(key)) dropped += 1;
      return dropped;
    },
    /** @param {string} _cursor @param {string} _match @param {string} pattern */
    async scan(_cursor, _match, pattern) {
      const base = pattern.replace(/\*$/, "");
      return ["0", [...store.keys()].filter((key) => key.startsWith(base))];
    },
    /** @param {string} _channel @param {string} payload */
    async publish(_channel, payload) {
      published.push(JSON.parse(payload));
      return 1;
    },
  };
}

/** Her komutu reddeden istemci: Redis düştüğünde ne olduğunu görmek için. */
function createBrokenRedis() {
  const boom = async () => {
    throw new Error("ECONNREFUSED");
  };
  return { get: boom, set: boom, unlink: boom, scan: boom, publish: boom };
}

afterEach(() => {
  setRedisClientForTests(null);
  clearHtmlCache();
  clearDataCache();
});

/* ------------------------------------------------------------------ serileştirme */

test("a cached page is written to the shared tier", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  await withHtmlCache("/a?", 60, async () => ({ html: "merhaba", status: 200 }));

  const raw = fake.store.get(`${PREFIX}:html:/a?`);
  assert.ok(raw, "girdi paylaşımlı kademeye yazılmalı");

  const payload = JSON.parse(raw);
  assert.equal(payload.html, "merhaba");
  assert.equal(payload.status, 200);
  assert.deepEqual(payload.deps, []);
  assert.ok(payload.expiresAt > Date.now(), "mutlak zamanlar taşınmalı");
  assert.ok(payload.staleUntil > payload.expiresAt);
});

test("compressed bodies stay local unless storeEncoded is on", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  const hit = await withHtmlCache("/a?", 60, async () => ({ html: "x", status: 200 }));
  // Yanıt yolunun yaptığı şey: gövde ilk kez sıkıştırıldığında haritaya konur.
  hit.encoded?.set("br", Buffer.from("sıkıştırılmış"));

  await withHtmlCache("/a?", 60, async () => ({ html: "x", status: 200 }));

  const payload = JSON.parse(fake.store.get(`${PREFIX}:html:/a?`));
  assert.equal(payload.encoded, undefined, "varsayılan olarak paylaşılmamalı");
});

test("storeEncoded shares the compressed body on the next read", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake, { storeEncoded: true });

  const hit = await withHtmlCache("/a?", 60, async () => ({ html: "x", status: 200 }));
  hit.encoded?.set("br", Buffer.from("sıkıştırılmış"));

  // `encoded` yazma anında boş; paylaşım bir sonraki okumada tamamlanır.
  await withHtmlCache("/a?", 60, async () => ({ html: "x", status: 200 }));

  const payload = JSON.parse(fake.store.get(`${PREFIX}:html:/a?`));
  assert.equal(
    Buffer.from(payload.encoded.br, "base64").toString(),
    "sıkıştırılmış",
  );
});

test("results that must not be cached never reach the shared tier", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  await withHtmlCache("/yok?", 60, async () => ({ html: "404", status: 404 }));
  await withHtmlCache("/kismi?", 60, async () => ({
    html: "eksik",
    status: 200,
    degraded: true,
  }));
  // Kişiye özel çıktının paylaşımlı kademeye girmesi, bir kullanıcının
  // HTML'ini tüm kümeye servis etmek olurdu.
  await withHtmlCache("/panel?", 60, async () => ({
    html: "merhaba ayşe",
    status: 200,
    storable: false,
  }));

  assert.equal(fake.store.size, 0);
  assert.equal(getHtmlCacheSize(), 0);
});

/* ---------------------------------------------------------------------- promote */

test("a cold node serves another node's html without rendering", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  await withHtmlCache("/a?", 60, async () => ({ html: "uzak render", status: 200 }));

  // Soğuk node taklidi: yerel L1 boşaltılır ama paylaşımlı kopya kalır.
  // Boşaltma sırasında istemci kapatılıyor, yoksa `clearHtmlCache()` Redis
  // kopyasını da silerdi.
  setRedisClientForTests(null);
  clearHtmlCache();
  setRedisClientForTests(fake);

  const hit = await withHtmlCache("/a?", 60, async () => {
    throw new Error("render çalışmamalıydı");
  });

  assert.equal(hit.html, "uzak render");
  assert.equal(getHtmlCacheSize(), 1, "girdi L1'e alınmalı");
});

test("a stale shared entry is ignored so the refresh can run", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  const now = Date.now();
  // Bayat bir kopyayı promote etmek tazelemeyi sonsuza kadar ertelerdi.
  fake.store.set(
    `${PREFIX}:html:/a?`,
    JSON.stringify({
      html: "bayat",
      status: 200,
      storedAt: now - 10_000,
      expiresAt: now - 5_000,
      staleUntil: now + 60_000,
      deps: [],
    }),
  );

  const hit = await withHtmlCache("/a?", 60, async () => ({ html: "taze", status: 200 }));
  assert.equal(hit.html, "taze");
});

test("a promoted entry keeps its dependencies", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  const now = Date.now();
  fake.store.set(
    `${PREFIX}:html:/a?`,
    JSON.stringify({
      html: "uzak",
      status: 200,
      storedAt: now,
      expiresAt: now + 60_000,
      staleUntil: now + 120_000,
      deps: ["haber:1"],
    }),
  );

  await withHtmlCache("/a?", 60, async () => ({ html: "yerel", status: 200 }));
  assert.equal(getHtmlCacheEntries()[0].deps, 1, "ters indeks yeniden kurulmalı");

  // Ters indeks gerçekten bağlıysa veri anahtarını düşürmek sayfayı bayatlatır.
  await withDataCache("haber:1", 60, async () => "veri");
  clearDataCache("haber:");
  assert.equal(getHtmlCacheEntries()[0].stale, true);
});

test("the data cache reuses another node's upstream call", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  await withDataCache("haber:1", 60, async () => ({ baslik: "uzak" }));

  setRedisClientForTests(null);
  clearDataCache();
  setRedisClientForTests(fake);

  const value = await withDataCache("haber:1", 60, async () => {
    throw new Error("upstream'e gidilmemeliydi");
  });

  assert.deepEqual(value, { baslik: "uzak" });
  assert.equal(getDataCacheSize(), 1);
});

/* ----------------------------------------------------------------------- olaylar */

test("invalidation is announced and the shared copy is dropped", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  await withHtmlCache("/haber/a?", 60, async () => ({ html: "x", status: 200 }));
  await withHtmlCache("/hakkinda?", 60, async () => ({ html: "y", status: 200 }));

  invalidateHtmlCache("/haber/:slug");
  await sleep(5);

  const event = fake.published.at(-1);
  assert.equal(event.type, "html:invalidate");
  assert.equal(event.hard, false);
  assert.deepEqual(event.targets, ["/haber/:slug"]);
  assert.ok(event.originId, "kendi mesajını elemek için kimlik taşınmalı");

  assert.equal(fake.store.has(`${PREFIX}:html:/haber/a?`), false);
  assert.ok(fake.store.has(`${PREFIX}:html:/hakkinda?`), "eşleşmeyen yol kalmalı");
});

test("regexp targets survive the round trip", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  await withHtmlCache("/x-yorumlar?", 60, async () => ({ html: "x", status: 200 }));
  invalidateHtmlCache([/-yorumlar$/i]);

  const event = fake.published.at(-1);
  assert.deepEqual(event.targets, [{ re: "-yorumlar$", flags: "i" }]);
});

test("a remote invalidation stales the local entry without echoing back", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  await withHtmlCache("/haber/a?", 60, async () => ({ html: "x", status: 200 }));
  fake.published.length = 0;

  emitRemoteCacheEventForTests({
    type: "html:invalidate",
    hard: false,
    targets: ["/haber/:slug"],
  });

  assert.equal(getHtmlCacheSize(), 1, "yumuşak invalidation girdiyi silmemeli");
  assert.equal(getHtmlCacheEntries()[0].stale, true);
  assert.deepEqual(fake.published, [], "uzak olay yeniden yayınlanmamalı");
});

test("a remote data purge clears the local data cache without echoing back", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  await withDataCache("haber:1", 60, async () => 1);
  await withDataCache("etiket:1", 60, async () => 2);
  fake.published.length = 0;

  emitRemoteCacheEventForTests({ type: "data:clear", prefix: "haber:" });

  assert.equal(getDataCacheSize(), 1);
  assert.deepEqual(fake.published, []);
});

test("a node ignores its own messages", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  // Yayın her aboneye gider, yayınlayana da. Kendi mesajını işlemek yerel işi
  // ikinci kez yapmak olurdu; burada da az önce yazılan girdiyi düşürürdü.
  await withHtmlCache("/a?", 60, async () => ({ html: "x", status: 200 }));
  invalidateHtmlCache("/a", { hard: true });
  const own = fake.published.at(-1);

  await withHtmlCache("/a?", 60, async () => ({ html: "yeni", status: 200 }));
  emitRemoteCacheEventForTests(own);

  assert.equal(getHtmlCacheSize(), 1, "kendi yayını yeni girdiyi düşürmemeli");
});

test("clearHtmlCache empties the shared tier too", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  await withHtmlCache("/a?", 60, async () => ({ html: "x", status: 200 }));
  clearHtmlCache();
  await sleep(5);

  assert.equal(fake.store.size, 0);
  assert.equal(fake.published.at(-1).type, "html:clear");
});

/* ---------------------------------------------------------------- hata dayanımı */

test("a broken redis changes nothing", async () => {
  setRedisClientForTests(createBrokenRedis());

  let calls = 0;
  const producer = async () => {
    calls += 1;
    return { html: `render ${calls}`, status: 200 };
  };

  const first = await withHtmlCache("/a?", 60, producer);
  const second = await withHtmlCache("/a?", 60, producer);

  assert.equal(calls, 1, "Redis hatası render'ı tekrarlatmamalı");
  assert.equal(first.html, "render 1");
  assert.equal(second.cached, true);

  // Invalidation da fırlatmamalı.
  assert.equal(invalidateHtmlCache("/a", { hard: true }), 1);
  assert.equal(getHtmlCacheSize(), 0);
});

test("the circuit breaker stops hammering a dead redis", async () => {
  setRedisClientForTests(createBrokenRedis());

  // Devre kesici beş art arda hatadan sonra kapanır; sonraki çağrılar Redis'e
  // hiç gitmez ve `getRedisStatus()` bunu bildirir.
  for (let i = 0; i < 6; i += 1) {
    await withHtmlCache(`/a${i}?`, 60, async () => ({ html: "x", status: 200 }));
  }

  const status = getRedisStatus();
  assert.equal(status.bypassed, true);
  assert.ok(status.errors >= 5);
});

test("the status is safe to read with no connection", () => {
  setRedisClientForTests(null);

  const status = getRedisStatus();
  assert.equal(status.enabled, false);
  assert.equal(status.connected, false);
});

/* ----------------------------------------------------------------- teşhis */

test("the connection details never carry the password", () => {
  setRedisClientForTests(createFakeRedis(), {
    url: "rediss://admin:s3cret@cache.internal:6380/3",
    namespace: "haber",
  });

  const details = getRedisDetails();
  assert.equal(details.address, "cache.internal:6380");
  assert.equal(details.secure, true);
  assert.equal(details.db, "3");
  assert.equal(details.namespace, "haber");
  assert.ok(
    !JSON.stringify(details).includes("s3cret"),
    "sır teşhis çıktısına girmemeli",
  );
});

test("a broken url degrades to a label instead of throwing", () => {
  setRedisClientForTests(createFakeRedis(), { url: "not a url" });
  assert.equal(getRedisDetails().address, "custom");
});

test("inspecting the shared tier counts the keys of each kind", async () => {
  const fake = createFakeRedis();
  setRedisClientForTests(fake);

  await withHtmlCache("/a?", 60, async () => ({ html: "x", status: 200 }));
  await withHtmlCache("/b?", 60, async () => ({ html: "y", status: 200 }));
  await withDataCache("quote:AAPL", 60, async () => ({ price: 1 }));

  const result = await inspectRedis();
  assert.equal(result.ok, true);
  assert.equal(result.html, 2);
  assert.equal(result.data, 1);
  // `INFO`/`DBSIZE` kısıtlı kurulumlarda reddedilebiliyor; sayımlar yine döner.
  assert.equal(result.usedMemory, null);
  assert.equal(result.totalKeys, null);
});

test("inspecting without a connection reports failure instead of throwing", async () => {
  setRedisClientForTests(null);
  assert.deepEqual(await inspectRedis(), {
    ok: false,
    html: 0,
    data: 0,
    usedMemory: null,
    totalKeys: null,
  });
});
