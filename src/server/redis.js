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
import { DEFAULT_REDIS } from "../config/defaults.js";
import { tryImportFromApp } from "../build/resolve-peer.mjs";
import { getBuildId } from "./assets.js";

/**
 * @typedef {import('../config/index.js').RedisConfig} RedisConfig
 *
 * @typedef {{ type: string, [key: string]: unknown }} CacheEvent
 */

/** @type {any} */
let client = null;
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

/**
 * Devre kesici. Redis düştüğünde her istek `commandTimeoutMs` beklemesin:
 * art arda gelen hatalardan sonra istemci bir süre baypas edilir. Süre
 * dolduğunda tek bir komut denenir ve başarılıysa sayaç sıfırlanır.
 */
let consecutiveFailures = 0;
let bypassUntil = 0;

const MAX_FAILURES = 5;
const BYPASS_MS = 5000;

/** @returns {boolean} */
function usable() {
  if (!client) return false;
  if (bypassUntil && Date.now() < bypassUntil) return false;
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

  if (redis.events) await subscribe(Redis, redis, options);

  console.log(`[redis] connected — keys under \`${prefix}:\``);
  return true;
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
  return usable() && settings[kind] === true;
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
 * @param {string} key
 * @returns {Promise<any | null>} Girdi yoksa, ayrıştırılamıyorsa ya da Redis
 *   hata verirse `null` — hepsi "miss" sayılır.
 */
export async function redisGetJson(key) {
  if (!usable()) return null;

  try {
    const raw = await client.get(key);
    noteSuccess();
    return raw === null ? null : JSON.parse(raw);
  } catch (error) {
    noteFailure("get", error);
    return null;
  }
}

/**
 * Ateşle-unut yazma. İsteğin yanıt yolunda beklenmez: HTML zaten L1'e
 * yazıldı, Redis kopyası yalnızca diğer node'lar için.
 *
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlMs
 */
export function redisSetJson(key, value, ttlMs) {
  if (!usable() || !(ttlMs > 0)) return;

  /** @type {string} */
  let payload;
  try {
    payload = JSON.stringify(value);
  } catch (error) {
    // Serileştirilemeyen değer (döngüsel referans, BigInt) sessizce atlanır;
    // L1 kopyası çalışmaya devam eder.
    noteFailure("serialize", error);
    return;
  }

  Promise.resolve(client.set(key, payload, "PX", Math.ceil(ttlMs)))
    .then(noteSuccess)
    .catch((error) => noteFailure("set", error));
}

/**
 * @param {string[]} keys
 */
export function redisDrop(keys) {
  if (!usable() || !keys.length) return;

  // `UNLINK` silmeyi arka plana atar: bir webhook binlerce anahtar
  // düşürdüğünde `DEL` sunucuyu bloklar.
  Promise.resolve(client.unlink(...keys))
    .then(noteSuccess)
    .catch((error) => noteFailure("unlink", error));
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
 *   buildId: string, errors: number, bypassed: boolean }}
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
  };
}

/**
 * Bağlantıları kapatır. `SIGTERM` sonrası uçuştaki komutların bitmesi
 * beklenir (`quit`), zorla kesilmez.
 *
 * @returns {Promise<void>}
 */
export async function disconnectRedis() {
  const open = [subscriber, client].filter(Boolean);
  client = null;
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
 */
export function setRedisClientForTests(fake, overrides = {}) {
  client = fake;
  subscriber = null;
  settings = { ...DEFAULT_REDIS, enabled: Boolean(fake), ...overrides };
  prefix = fake ? `${settings.keyPrefix}:${settings.namespace}:test` : "";
  channel = `${settings.keyPrefix}:${settings.namespace}:events`;
  errors = 0;
  consecutiveFailures = 0;
  bypassUntil = 0;
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
