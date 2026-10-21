/**
 * Opsiyonel Redis ikinci kademesi (L2) ve invalidation yayını.
 *
 * Redis **birincil store olmaz**. `html-cache.js` bellekten senkron okuyor,
 * sıkıştırılmış gövdeleri girdiyle birlikte tutuyor ve "bu render purge'den
 * önce mi başladı" sorusunu tek proseste cevaplıyor. Bu makineyi ağın arkasına
 * almak hem her isteğe gecikme ekler hem de yarışları küme çapında hâle
 * getirir. Bunun yerine bellek içi önbellek (L1) aynen kalır ve Redis iki iş
 * yapar:
 *
 *   1. **L1 miss'te render'ı atlatmak.** Yeni ayağa kalkan ya da o yolu hiç
 *      görmemiş bir node, başka bir node'un ürettiği HTML'i bulur.
 *   2. **Invalidation'ı yaymak.** Bugün bir webhook yalnızca isteği alan
 *      node'un önbelleğini tazeliyor; diğerleri TTL'i bekliyor. Asıl kazanç
 *      depolama değil, bu.
 *
 * Sözleşme: Redis yoksa, bağlanamıyorsa ya da bir komut hata verirse
 * **Redis'siz davranış birebir korunur**. Bu modüldeki hiçbir fonksiyon
 * fırlatmaz; okuma `null`, yazma sessiz no-op'a döner.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import { DEFAULT_REDIS } from "../config/defaults.js";
import { tryImportFromApp } from "../build/resolve-peer.mjs";
import { getBuildId } from "./assets.js";
import { decodeCacheValueAsync, encodeCacheValue } from "./cache-blob.js";

/**
 * @typedef {import('../config/index.js').RedisConfig} RedisConfig
 *
 * @typedef {{ type: string, [key: string]: unknown }} CacheEvent
 */

/** @type {any} */
let client = null;
/**
 * HTML GET/SET. `commandTimeout` ioredis'te istemci genelinde: gövde yazması
 * veri okumasının 200 ms tavanını paylaşırsa yavaş sayfa küçük anahtarları da
 * bekletir. Ayrı bağlantı bu yüzden var.
 *
 * @type {any}
 */
let htmlClient = null;
/** @type {any} */
let subscriber = null;

/** @type {RedisConfig} */
let settings = { ...DEFAULT_REDIS };

/** Anahtar öneki `_jskelet:{ns}:{buildId}` — bir kez hesaplanır. */
let prefix = "";
let channel = "";

/**
 * Bu prosesin kimliği. Kendi yayınladığı mesajı işlemek, yerel invalidation'ı
 * ikinci kez çalıştırmak ve `data:clear` gibi zincirleme olaylarda sonsuz
 * döngü üretmek olurdu.
 */
const originId = crypto.randomUUID();

/** @type {((event: CacheEvent) => void)[]} */
const listeners = [];

let errors = 0;
let htmlErrors = 0;

/**
 * Devre kesici. Redis düştüğünde her istek `commandTimeoutMs` beklemesin:
 * art arda gelen hatalardan sonra istemci bir süre baypas edilir. Süre
 * dolduğunda tek bir komut denenir ve başarılıysa sayaç sıfırlanır.
 *
 * HTML'in sayacı ayrı. Gövde zaman aşımı `consecutiveFailures`'a yazılmaz:
 * beş yavaş sayfa, veri önbelleğini beş saniye kapatmasın.
 */
let consecutiveFailures = 0;
let bypassUntil = 0;
let htmlConsecutiveFailures = 0;
let htmlBypassUntil = 0;

const MAX_FAILURES = 5;
const BYPASS_MS = 5000;

/** Yanıt için saklanan kodlamalar. Okuma bunları aynı pipeline'a koyar. */
const HTML_RESPONSE_ENCODINGS = ["br", "gzip"];

/** @returns {boolean} */
function usable() {
  if (!client) return false;
  if (bypassUntil && Date.now() < bypassUntil) return false;
  return true;
}

/** @returns {boolean} */
function htmlUsable() {
  if (!htmlClient) return false;
  if (htmlBypassUntil && Date.now() < htmlBypassUntil) return false;
  return true;
}

/**
 * @param {string} action
 * @param {unknown} error
 */
function noteFailure(action, error) {
  errors += 1;
  consecutiveFailures += 1;

  if (consecutiveFailures >= MAX_FAILURES && !bypassUntil) {
    bypassUntil = Date.now() + BYPASS_MS;
    console.warn(
      `[redis] ${MAX_FAILURES} consecutive failures — bypassing for ${BYPASS_MS}ms`,
    );
  }

  // Her hata loglanmaz: Redis düştüğünde saniyede yüzlerce satır basardı.
  if (consecutiveFailures <= MAX_FAILURES) {
    console.warn(
      `[redis] ${action} failed`,
      error instanceof Error ? error.message : error,
    );
  }
}

function noteSuccess() {
  consecutiveFailures = 0;
  bypassUntil = 0;
}

/**
 * HTML bağlantısının hataları. Veri sayacına dokunmaz.
 *
 * @param {string} action
 * @param {unknown} error
 */
function noteHtmlFailure(action, error) {
  htmlErrors += 1;
  htmlConsecutiveFailures += 1;

  if (htmlConsecutiveFailures >= MAX_FAILURES && !htmlBypassUntil) {
    htmlBypassUntil = Date.now() + BYPASS_MS;
    console.warn(
      `[redis] ${MAX_FAILURES} consecutive html failures — bypassing html for ${BYPASS_MS}ms`,
    );
  }

  if (htmlConsecutiveFailures <= MAX_FAILURES) {
    console.warn(
      `[redis] html ${action} failed`,
      error instanceof Error ? error.message : error,
    );
  }
}

function noteHtmlSuccess() {
  htmlConsecutiveFailures = 0;
  htmlBypassUntil = 0;
}

/**
 * Bağlantıyı kurar. `createApp()` config yüklendikten sonra bir kez çağırır.
 *
 * `ioredis` opsiyonel peer bağımlılık ve **uygulamanın** node_modules'ünden
 * çözülür: framework `file:`/workspace bağlantısıyla kuruluysa düz bir
 * `import "ioredis"` framework'ün kendi ağacına bakar.
 *
 * @param {import('../config/index.js').ResolvedConfig} config
 * @returns {Promise<boolean>} Bağlantı kuruldu mu.
 */
export async function connectRedis(config) {
  const redis = config.redis ?? DEFAULT_REDIS;
  if (!redis.enabled) return false;

  const module = await tryImportFromApp(config.root, "ioredis");
  if (!module) {
    console.warn(
      "[redis] cache.redis.enabled is set but `ioredis` is not installed — " +
        "falling back to the in-process cache.",
    );
    return false;
  }

  const Redis = module.default ?? module.Redis;
  if (typeof Redis !== "function") {
    console.warn("[redis] `ioredis` did not export a constructor, ignoring it");
    return false;
  }

  const options = {
    // Bağlantı `createApp()` içinde beklenmez: Redis erişilemezse sunucu yine
    // ayağa kalkmalı, sadece L2 devre dışı kalır.
    lazyConnect: true,
    // Tek bir komut isteği bloklayan adım; kuyrukta birikmesine izin verilmez.
    // Bu tavan veri, yayın ve SCAN içindir. HTML ayrı bağlantıda.
    commandTimeout: redis.commandTimeoutMs,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  };

  try {
    client = redis.url ? new Redis(redis.url, options) : new Redis(options);
    // Bağlantı hatası bir `error` dinleyicisi olmadan süreci düşürür.
    client.on("error", (error) => noteFailure("connection", error));
    await client.connect();
  } catch (error) {
    console.warn(
      "[redis] could not connect — falling back to the in-process cache:",
      error instanceof Error ? error.message : error,
    );
    try {
      client?.disconnect();
    } catch {
      // Zaten kopmuş olabilir.
    }
    client = null;
    return false;
  }

  settings = redis;
  prefix = `${redis.keyPrefix}:${redis.namespace}:${getBuildId()}`;
  // Kanal bilinçli olarak `buildId` **içermez**: deploy sırasında eski ve yeni
  // sürüm yan yana koşuyor ve purge mesajı ikisine de ulaşmalı.
  channel = `${redis.keyPrefix}:${redis.namespace}:events`;

  if (redis.html) await connectHtml(Redis, redis, options);
  if (redis.events) await subscribe(Redis, redis, options);

  console.log(`[redis] connected — keys under \`${prefix}:\``);
  return true;
}

/**
 * HTML gövdesi için ayrı bağlantı. `duplicate` host, şifre ve db'yi kopyalar;
 * `commandTimeout` ise bu istemciye özel kalır.
 *
 * Bağlanamazsa veri katmanı ayakta kalır — HTML L1'de durur.
 *
 * @param {Function} Redis
 * @param {RedisConfig} redis
 * @param {Record<string, unknown>} options
 */
async function connectHtml(Redis, redis, options) {
  const htmlOptions = { ...options, commandTimeout: redis.htmlCommandTimeoutMs };

  try {
    htmlClient =
      typeof client.duplicate === "function"
        ? client.duplicate({ commandTimeout: redis.htmlCommandTimeoutMs })
        : redis.url
          ? new Redis(redis.url, htmlOptions)
          : new Redis(htmlOptions);

    htmlClient.on("error", (error) => noteHtmlFailure("connection", error));
    if (htmlClient.status !== "ready" && htmlClient.status !== "connecting") {
      await htmlClient.connect();
    }
  } catch (error) {
    console.warn(
      "[redis] html connection failed — HTML stays in-process:",
      error instanceof Error ? error.message : error,
    );
    try {
      htmlClient?.disconnect();
    } catch {
      // Zaten kopmuş olabilir.
    }
    htmlClient = null;
  }
}

/**
 * pub/sub için ikinci bir bağlantı: abone olmuş bir istemci normal komut
 * kabul etmez.
 *
 * @param {Function} Redis
 * @param {RedisConfig} redis
 * @param {Record<string, unknown>} options
 */
async function subscribe(Redis, redis, options) {
  try {
    subscriber =
      typeof client.duplicate === "function"
        ? client.duplicate()
        : redis.url
          ? new Redis(redis.url, options)
          : new Redis(options);

    subscriber.on("error", (error) => noteFailure("subscriber", error));
    subscriber.on("message", (_channel, payload) => dispatch(payload));

    if (subscriber.status !== "ready" && subscriber.status !== "connecting") {
      await subscriber.connect();
    }
    await subscriber.subscribe(channel);
  } catch (error) {
    console.warn(
      "[redis] could not subscribe, invalidation will stay local:",
      error instanceof Error ? error.message : error,
    );
    subscriber = null;
  }
}

/**
 * @param {string} payload
 */
function dispatch(payload) {
  /** @type {any} */
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return;
  }

  // Kendi mesajı: yerel iş zaten yayından önce yapıldı.
  if (!event || event.originId === originId) return;

  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.warn("[redis] cache event listener threw", error);
    }
  }
}

/**
 * Önbellek olaylarına abone olur. Önbellek modülleri yükleme anında çağırır;
 * bağlantı sonradan kurulsa da kayıt geçerli kalır.
 *
 * Dinleyici **yalnızca yerel** işi yapmalı: yeniden yayın yapan bir dinleyici
 * iki node arasında sonsuz mesaj döngüsü üretir.
 *
 * @param {(event: CacheEvent) => void} listener
 */
export function onCacheEvent(listener) {
  listeners.push(listener);
}

/**
 * Olayı diğer node'lara duyurur. Ateşle-unut: yayın hatası çağıranı
 * etkilemez, yerel invalidation zaten yapıldı.
 *
 * @param {CacheEvent} event
 */
export function publishCacheEvent(event) {
  if (!usable() || !settings.events) return;

  Promise.resolve(client.publish(channel, JSON.stringify({ ...event, originId })))
    .then(noteSuccess)
    .catch((error) => noteFailure("publish", error));
}

/**
 * Bu tür için paylaşım açık mı. `html`/`data` ayrı ayrı kapatılabiliyor:
 * veri önbelleğini paylaşmak neredeyse her zaman kazançlı, HTML gövdelerini
 * paylaşmak girdi başına yüz kilobayt trafik demek.
 *
 * @param {"html" | "data"} kind
 * @returns {boolean}
 */
export function redisShares(kind) {
  if (settings[kind] !== true) return false;
  return kind === "html" ? htmlUsable() : usable();
}

/** @returns {boolean} */
export function redisSharesEncoded() {
  return settings.storeEncoded === true;
}

/**
 * @param {"html" | "data"} kind
 * @param {string} key
 * @returns {string}
 */
export function cacheKey(kind, key) {
  return `${prefix}:${kind}:${key}`;
}

/**
 * HTML kaydını parçalı yazar. Meta küçük JSON'dur; gövde ham brotli baytıdır
 * (base64 yok, JSON içinde ikinci brotli yok). `encoded` varsa her kodlama
 * `:enc:` anahtarına olduğu gibi gider.
 *
 * Ateşle-unut ve tek sayaç adımı: üç SET'ten biri düşerse bu bir hatadır,
 * veri devre kesicisine yazılmaz.
 *
 * @param {string} key Önbellek anahtarı (`yol?query`), öneksiz.
 * @param {Record<string, unknown>} meta
 * @param {Buffer} body
 * @param {Map<string, Buffer> | null} encoded
 * @param {number} ttlMs
 */
export function redisShareHtml(key, meta, body, encoded, ttlMs) {
  if (!htmlUsable() || !(ttlMs > 0)) return;

  /** @type {string} */
  let json;
  try {
    json = JSON.stringify(meta);
  } catch (error) {
    noteHtmlFailure("serialize", error);
    return;
  }

  const base = cacheKey("html", key);
  const px = Math.ceil(ttlMs);
  /** @type {Promise<unknown>[]} */
  const writes = [
    htmlClient.set(base, json, "PX", px),
    htmlClient.set(`${base}:body`, body, "PX", px),
  ];

  if (encoded) {
    for (const [encoding, buffer] of encoded) {
      if (!encoding || !Buffer.isBuffer(buffer) || !buffer.length) continue;
      writes.push(htmlClient.set(`${base}:enc:${encoding}`, buffer, "PX", px));
    }
  }

  Promise.all(writes)
    .then(() => noteHtmlSuccess())
    .catch((error) => noteHtmlFailure("set", error));
}

/**
 * Meta + gövde (+ açıksa kodlamalar) tek pipeline. Parça eksikse kayıt yok
 * sayılır; bu bir hata değildir. Bağlantı hatası HTML sayacına yazılır.
 *
 * @param {string} key Önbellek anahtarı (`yol?query`), öneksiz.
 * @returns {Promise<{ html: string, status: unknown, storedAt: unknown,
 *   expiresAt: unknown, staleUntil: unknown, produceMs: unknown, deps: unknown,
 *   encoded: Map<string, Buffer> } | null>}
 */
export async function redisGetHtml(key) {
  if (!htmlUsable()) return null;

  const base = cacheKey("html", key);
  /** @type {string[]} */
  const keys = [base, `${base}:body`];
  if (settings.storeEncoded === true) {
    for (const encoding of HTML_RESPONSE_ENCODINGS) keys.push(`${base}:enc:${encoding}`);
  }

  try {
    const values = await readHtmlBuffers(keys);
    noteHtmlSuccess();

    const metaRaw = values[0];
    const bodyRaw = values[1];
    if (metaRaw == null || bodyRaw == null) return null;

    const metaText = asText(metaRaw);
    if (!metaText) return null;
    const meta = JSON.parse(metaText);
    if (!meta || typeof meta !== "object") return null;

    const html = await inflateBrotli(bodyRaw);
    /** @type {Map<string, Buffer>} */
    const encoded = new Map();
    if (settings.storeEncoded === true) {
      HTML_RESPONSE_ENCODINGS.forEach((encoding, index) => {
        const buffer = asBuffer(values[2 + index]);
        if (buffer?.length) encoded.set(encoding, buffer);
      });
    }

    return {
      status: meta.status,
      storedAt: meta.storedAt,
      expiresAt: meta.expiresAt,
      staleUntil: meta.staleUntil,
      produceMs: meta.produceMs,
      deps: meta.deps,
      html,
      encoded,
    };
  } catch (error) {
    noteHtmlFailure("get", error);
    return null;
  }
}

/**
 * @param {string[]} keys
 * @returns {Promise<(Buffer | string | null)[]>}
 */
async function readHtmlBuffers(keys) {
  if (typeof htmlClient.pipeline === "function") {
    const pipe = htmlClient.pipeline();
    const getter = typeof pipe.getBuffer === "function" ? "getBuffer" : "get";
    for (const key of keys) pipe[getter](key);
    const rows = await pipe.exec();
    if (!Array.isArray(rows)) return keys.map(() => null);
    return rows.map((row) => {
      if (!row) return null;
      const [error, value] = row;
      if (error) throw error;
      return value ?? null;
    });
  }

  const getter = typeof htmlClient.getBuffer === "function" ? "getBuffer" : "get";
  return Promise.all(keys.map((key) => htmlClient[getter](key)));
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asText(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return null;
}

/**
 * @param {unknown} value
 * @returns {Buffer | null}
 */
function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value);
  return null;
}

/**
 * `:body` JSK sarmalayıcısı taşımaz; tamamı brotli'dir.
 *
 * @param {unknown} raw
 * @returns {Promise<string>}
 */
function inflateBrotli(raw) {
  const body = asBuffer(raw);
  if (!body?.length) return Promise.reject(new Error("empty html body"));

  return new Promise((resolve, reject) => {
    zlib.brotliDecompress(body, (error, out) => {
      if (error) reject(error);
      else resolve(out.toString("utf8"));
    });
  });
}

/**
 * `:body` ve `:enc:*` sayfa kaydı değil, gövde parçasıdır.
 *
 * @param {string} key
 * @returns {boolean}
 */
function isHtmlFragmentKey(key) {
  return key.endsWith(":body") || key.endsWith(":enc:br") || key.endsWith(":enc:gzip");
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function isHtmlMetaKey(key) {
  // `data` anahtarı da `:html:` metnini taşıyabilir; tür segmenti önekten hemen
  // sonra gelir. Parça anahtarları (`:body`, `:enc:`) ayrıca düşürülür.
  if (!prefix || !key.startsWith(`${prefix}:html:`)) return false;
  return !isHtmlFragmentKey(key);
}

/**
 * @param {string} key
 * @returns {Promise<any | null>} Girdi yoksa, ayrıştırılamıyorsa ya da Redis
 *   hata verirse `null` — hepsi "miss" sayılır.
 */
export async function redisGetJson(key) {
  if (!usable()) return null;

  try {
    // `get` dizge döndürür ve ikili gövdeyi bozar. `getBuffer` yoksa (eski
    // sahte istemci) düz JSON hâlâ `get` ile okunur.
    const raw =
      typeof client.getBuffer === "function" ? await client.getBuffer(key) : await client.get(key);
    noteSuccess();
    return raw == null ? null : await decodeCacheValueAsync(raw);
  } catch (error) {
    noteFailure("get", error);
    return null;
  }
}

/**
 * @param {string} key
 * @param {string | Buffer} payload
 * @param {number} ttlMs
 * @returns {Promise<void>}
 */
function writeRaw(key, payload, ttlMs) {
  return Promise.resolve(client.set(key, payload, "PX", Math.ceil(ttlMs)))
    .then(noteSuccess)
    .catch((error) => noteFailure("set", error));
}

/**
 * Ateşle-unut yazma. İsteğin yanıt yolunda beklenmez: HTML zaten L1'e
 * yazıldı, Redis kopyası yalnızca diğer node'lar için. 1 KB ve üstü gövdeler
 * brotli ile yazılır; okuma düz JSON'u da kabul eder.
 *
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlMs
 */
export function redisSetJson(key, value, ttlMs) {
  if (!usable() || !(ttlMs > 0)) return;

  const encoded = encodeCacheValue(value);
  if (encoded === null) {
    // Serileştirilemeyen değer (döngüsel referans, BigInt) sessizce atlanır;
    // L1 kopyası çalışmaya devam eder.
    noteFailure("serialize", new Error("not JSON"));
    return;
  }

  // Küçük gövde senkron döner ki testler `set`'ten hemen sonra kaydı okusun.
  // Büyük gövdenin brotli'si MISS yanıtını bekletmez.
  if (typeof encoded === "string" || Buffer.isBuffer(encoded)) {
    writeRaw(key, encoded, ttlMs);
    return;
  }

  encoded.then((payload) => writeRaw(key, payload, ttlMs));
}

/**
 * @param {string[]} keys
 */
export function redisDrop(keys) {
  if (!keys.length) return;

  /** @type {string[]} */
  const dataKeys = [];
  /** @type {string[]} */
  const htmlKeys = [];

  for (const key of keys) {
    if (isHtmlMetaKey(key)) {
      // Gövde ve kodlama anahtarları meta ile birlikte düşmezse 1 MB'lık
      // parça TTL'e kadar kalır. Eksik anahtarda UNLINK no-op'tur.
      htmlKeys.push(key, `${key}:body`, `${key}:enc:br`, `${key}:enc:gzip`);
    } else if (!isHtmlFragmentKey(key)) {
      dataKeys.push(key);
    }
  }

  if (dataKeys.length && usable()) unlinkKeys(client, dataKeys, noteFailure, noteSuccess);
  if (htmlKeys.length && htmlUsable()) {
    unlinkKeys(htmlClient, htmlKeys, noteHtmlFailure, noteHtmlSuccess);
  }
}

/**
 * @param {any} connection
 * @param {string[]} keys
 * @param {(action: string, error: unknown) => void} fail
 * @param {() => void} succeed
 */
function unlinkKeys(connection, keys, fail, succeed) {
  // `UNLINK` silmeyi arka plana atar: bir webhook binlerce anahtar
  // düşürdüğünde `DEL` sunucuyu bloklar.
  Promise.resolve(connection.unlink(...keys))
    .then(() => succeed())
    .catch((error) => fail("unlink", error));
}

/**
 * Bir isim alanını tarar ve eşleşen anahtarları düşürür.
 *
 * `KEYS` **kullanılmaz**: tek komutta tüm keyspace'i tarayıp sunucuyu bloklar.
 * `SCAN` kursoru parça parça döner; bu yüzden işlem atomik değil, ama
 * invalidation'ın atomik olması gerekmiyor.
 *
 * @param {"html" | "data"} kind
 * @param {(key: string) => boolean} [match] Anahtarın **önek sonrası** kısmına
 *   uygulanır; verilmezse tür altındaki her şey düşer.
 * @returns {Promise<number>} Düşürülen anahtar sayısı.
 */
export async function redisDropMatching(kind, match) {
  if (!usable()) return 0;

  const base = `${prefix}:${kind}:`;
  let cursor = "0";
  let dropped = 0;

  try {
    do {
      const [next, keys] = await client.scan(
        cursor,
        "MATCH",
        `${base}*`,
        "COUNT",
        500,
      );
      cursor = next;

      const doomed = match
        ? keys.filter((/** @type {string} */ key) => match(key.slice(base.length)))
        : keys;

      if (doomed.length) {
        await client.unlink(...doomed);
        dropped += doomed.length;
      }
    } while (cursor !== "0");

    noteSuccess();
  } catch (error) {
    noteFailure("scan", error);
  }

  return dropped;
}

/**
 * Dev raporu için durum özeti. Bağlantı yoksa da güvenle çağrılabilir.
 *
 * @returns {{ enabled: boolean, connected: boolean, keyPrefix: string,
 *   buildId: string, errors: number, bypassed: boolean, htmlErrors: number,
 *   htmlBypassed: boolean }}
 */
export function getRedisStatus() {
  const [, , buildId = ""] = prefix ? prefix.split(":") : [];

  return {
    enabled: settings.enabled === true,
    connected: Boolean(client),
    keyPrefix: prefix,
    buildId,
    errors,
    bypassed: Boolean(bypassUntil && Date.now() < bypassUntil),
    htmlErrors,
    htmlBypassed: Boolean(htmlBypassUntil && Date.now() < htmlBypassUntil),
  };
}

/**
 * Bağlantının **nereye** kurulduğu ve hangi ayarlarla çalıştığı.
 *
 * Şifre asla dönmez: bağlantı URL'i `redis://user:pass@host` biçiminde
 * olabiliyor ve panelin işi adresi göstermek, sırrı değil. Ayrıştırılamayan
 * bir URL için adres `"custom"` olur — bozuk bir değer teşhis ucunu
 * düşürmemeli.
 *
 * @returns {{ address: string, secure: boolean, db: string | null,
 *   namespace: string, keyPrefix: string, html: boolean, data: boolean,
 *   storeEncoded: boolean, events: boolean, commandTimeoutMs: number,
 *   htmlCommandTimeoutMs: number, subscribed: boolean }}
 */
export function getRedisDetails() {
  let address = "localhost:6379 (ioredis default)";
  let secure = false;
  /** @type {string | null} */
  let db = null;

  if (settings.url) {
    try {
      const parsed = new URL(settings.url);
      address = `${parsed.hostname}:${parsed.port || 6379}`;
      secure = parsed.protocol === "rediss:";
      const name = parsed.pathname.replace(/^\//, "");
      db = name || null;
    } catch {
      address = "custom";
    }
  }

  return {
    address,
    secure,
    db,
    namespace: settings.namespace,
    keyPrefix: settings.keyPrefix,
    html: settings.html === true,
    data: settings.data === true,
    storeEncoded: settings.storeEncoded === true,
    events: settings.events === true,
    commandTimeoutMs: settings.commandTimeoutMs,
    htmlCommandTimeoutMs: settings.htmlCommandTimeoutMs,
    subscribed: Boolean(subscriber),
  };
}

/**
 * Paylaşımlı kademede gerçekten **ne durduğunu** sayar: tür başına anahtar
 * sayısı ve sunucunun bildirdiği bellek kullanımı.
 *
 * Ayrı bir çağrı olması gerekiyor. Sayım `SCAN` turu demek ve panelin döküm
 * ucu birkaç saniyede bir yenileniyor; her turda tüm keyspace'i taramak
 * Redis'i teşhis uğruna yormak olurdu. Panel bunu düğmeye basınca çağırır.
 *
 * @returns {Promise<{ ok: boolean, html: number, data: number,
 *   usedMemory: string | null, totalKeys: number | null }>}
 */
export async function inspectRedis() {
  if (!usable()) return { ok: false, html: 0, data: 0, usedMemory: null, totalKeys: null };

  try {
    const [html, data] = await Promise.all([count("html"), count("data")]);

    /** @type {string | null} */
    let usedMemory = null;
    /** @type {number | null} */
    let totalKeys = null;

    try {
      const info = await client.info("memory");
      usedMemory = /used_memory_human:(\S+)/.exec(String(info))?.[1] ?? null;
      totalKeys = Number(await client.dbsize());
    } catch {
      // `INFO`/`DBSIZE` kısıtlı bir kurulumda (managed Redis) reddedilebilir;
      // anahtar sayıları yine geçerli.
    }

    noteSuccess();
    return { ok: true, html, data, usedMemory, totalKeys };
  } catch (error) {
    noteFailure("inspect", error);
    return { ok: false, html: 0, data: 0, usedMemory: null, totalKeys: null };
  }
}

/**
 * @param {"html" | "data"} kind
 * @returns {Promise<number>}
 */
async function count(kind) {
  let cursor = "0";
  let total = 0;

  do {
    const [next, keys] = await client.scan(
      cursor,
      "MATCH",
      `${prefix}:${kind}:*`,
      "COUNT",
      500,
    );
    cursor = next;
    total += kind === "html" ? keys.filter((key) => !isHtmlFragmentKey(key)).length : keys.length;
  } while (cursor !== "0");

  return total;
}

/**
 * Bağlantıları kapatır. `SIGTERM` sonrası uçuştaki komutların bitmesi
 * beklenir (`quit`), zorla kesilmez.
 *
 * @returns {Promise<void>}
 */
export async function disconnectRedis() {
  const open = [...new Set([subscriber, htmlClient, client].filter(Boolean))];
  client = null;
  htmlClient = null;
  subscriber = null;

  await Promise.all(
    open.map(async (connection) => {
      try {
        await connection.quit();
      } catch {
        try {
          connection.disconnect();
        } catch {
          // Kapanış hatası önemsiz: süreç zaten sonlanıyor.
        }
      }
    }),
  );
}

/**
 * Testler için: sahte bir istemci enjekte eder. Gerçek bir Redis'e bağlanmadan
 * serileştirme ve olay yollarının doğrulanabilmesi gerekiyor.
 *
 * @param {any} fake `null` → katman kapatılır.
 * @param {Partial<RedisConfig>} [overrides]
 * @param {any} [htmlFake] Verilmezse `fake` hem veri hem HTML istemcisidir.
 *   HTML zaman aşımını veri sayacından ayırmak için ayrı bir sahte verilir.
 */
export function setRedisClientForTests(fake, overrides = {}, htmlFake = fake) {
  client = fake;
  htmlClient = htmlFake;
  subscriber = null;
  settings = { ...DEFAULT_REDIS, enabled: Boolean(fake), ...overrides };
  prefix = fake ? `${settings.keyPrefix}:${settings.namespace}:test` : "";
  channel = `${settings.keyPrefix}:${settings.namespace}:events`;
  errors = 0;
  htmlErrors = 0;
  consecutiveFailures = 0;
  htmlConsecutiveFailures = 0;
  bypassUntil = 0;
  htmlBypassUntil = 0;
}

/**
 * Testler için: abone kanalından gelmiş gibi olay besler. `originId`
 * verilmezse uzak bir node varsayılır; kendi kimliğini taşıyan bir yayını
 * olduğu gibi geri vermek de mümkün olmalı — eleme testi buna dayanıyor.
 *
 * @param {CacheEvent} event
 */
export function emitRemoteCacheEventForTests(event) {
  dispatch(JSON.stringify({ originId: "remote", ...event }));
}
