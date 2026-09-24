/**
 * Redis yokken L2: aynı brotli gövde `.jskelet/cache/<buildId>/` altına yazılır.
 *
 * Tek makinenin yeniden açılışını karşılar. Birden fazla instance aynı
 * dizini paylaşmaz — o iş Redis'te kalır. Redis o türü paylaşıyorsa disk
 * devreye girmez; iki kopya birbirini ezmesin.
 *
 * Dosya adı anahtarın sha256'sı. Başta anahtarın kendisi durur ki desenle
 * silmek için gövdeyi çözmek gerekmesin. Süre Redis'teki `PX` yerine
 * girdinin `expiresAt` alanındadır; süresi dolmuş dosya okununca silinir.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config/index.js";
import { getBuildId } from "./assets.js";
import { decodeCacheValue, encodeCacheValue } from "./cache-blob.js";
import { redisShares } from "./redis.js";

/** @type {string | null} `null` → config'den çöz. Testler mutlak yol verir. */
let testRoot = null;

let pruned = false;

/**
 * @param {string | null} root Mutlak dizin, ya da config yoluna dönmek için `null`.
 */
export function setDiskCacheRootForTests(root) {
  testRoot = root;
  pruned = false;
}

/**
 * @returns {string | null}
 */
function directory() {
  if (typeof testRoot === "string") return testRoot;

  try {
    return path.join(getConfig().dirs.generated, "cache", getBuildId());
  } catch {
    // Birim testleri config yüklemez. Disk yazısı o zaman da kapalı kalır.
    return null;
  }
}

/**
 * @param {"html" | "data"} kind
 * @returns {boolean}
 */
export function diskShares(kind) {
  if (redisShares(kind)) return false;
  return directory() !== null;
}

/**
 * @param {string} key
 * @returns {string}
 */
function fileName(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * @param {"html" | "data"} kind
 * @param {string} key
 * @returns {string | null}
 */
function filePath(kind, key) {
  const root = directory();
  if (!root) return null;
  return path.join(root, kind, fileName(key));
}

/**
 * @param {string} key
 * @param {string | Buffer} payload
 * @returns {Buffer}
 */
function frame(key, payload) {
  const keyBuf = Buffer.from(key);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(keyBuf.length);
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return Buffer.concat([header, keyBuf, body]);
}

/**
 * @param {Buffer} raw
 * @returns {{ key: string, body: Buffer } | null}
 */
function unframe(raw) {
  if (raw.length < 4) return null;
  const keyLen = raw.readUInt32BE(0);
  if (keyLen < 1 || keyLen > 65536 || raw.length < 4 + keyLen) return null;
  return {
    key: raw.subarray(4, 4 + keyLen).toString("utf8"),
    body: raw.subarray(4 + keyLen),
  };
}

/**
 * Eski build kimliğinin dizinini siler. Redis'te o anahtarlar TTL ile ölür;
 * dosyada karşılığı bu. Dev'de kimlik `dev` kaldığı için prune bir şey silmez.
 *
 * @param {string} dir
 */
function pruneOldBuilds(dir) {
  if (pruned || testRoot) return;
  pruned = true;

  const parent = path.dirname(dir);
  const current = path.basename(dir);

  fs.readdir(parent, { withFileTypes: true })
    .then((entries) =>
      Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && entry.name !== current)
          .map((entry) => fs.rm(path.join(parent, entry.name), { recursive: true, force: true })),
      ),
    )
    .catch(() => {
      // Dizin henüz yoksa ya da silinemiyorsa L1 çalışmaya devam eder.
    });
}

/**
 * @param {"html" | "data"} kind
 * @param {string} key
 * @returns {Promise<unknown | null>}
 */
export async function diskGetJson(kind, key) {
  const file = filePath(kind, key);
  if (!file) return null;

  try {
    const framed = unframe(await fs.readFile(file));
    if (!framed) return null;
    return decodeCacheValue(framed.body);
  } catch {
    return null;
  }
}

/**
 * Ateşle-unut. Dönüş değeri testler bekleyebilsin diye durur; istek yolu
 * beklemez.
 *
 * @param {"html" | "data"} kind
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export function diskSetJson(kind, key, value) {
  const root = directory();
  const file = filePath(kind, key);
  if (!root || !file) return Promise.resolve();

  pruneOldBuilds(root);

  const encoded = encodeCacheValue(value);
  if (encoded === null) return Promise.resolve();

  const write = (/** @type {string | Buffer} */ payload) => {
    const tmp = `${file}.${process.pid}.tmp`;
    return fs
      .mkdir(path.dirname(file), { recursive: true })
      .then(() => fs.writeFile(tmp, frame(key, payload)))
      .then(() => fs.rename(tmp, file))
      .catch((error) => {
        console.warn(
          "[disk-cache] write failed",
          error instanceof Error ? error.message : error,
        );
      });
  };

  if (typeof encoded === "string" || Buffer.isBuffer(encoded)) return write(encoded);
  return encoded.then(write);
}

/**
 * @param {"html" | "data"} kind
 * @param {string[]} keys
 */
export function diskDrop(kind, keys) {
  if (!directory() || !keys.length) return;

  for (const key of keys) {
    const file = filePath(kind, key);
    if (file) fs.rm(file, { force: true }).catch(() => {});
  }
}

/**
 * @param {"html" | "data"} kind
 * @param {(key: string) => boolean} [match] Verilmezse türün tamamı silinir.
 * @returns {Promise<number>}
 */
export async function diskDropMatching(kind, match) {
  const root = directory();
  if (!root) return 0;

  const folder = path.join(root, kind);
  /** @type {string[]} */
  let names;
  try {
    names = await fs.readdir(folder);
  } catch {
    return 0;
  }

  let dropped = 0;

  await Promise.all(
    names.map(async (name) => {
      const file = path.join(folder, name);
      try {
        if (match) {
          const framed = unframe(await fs.readFile(file));
          if (!framed || !match(framed.key)) return;
        }
        await fs.rm(file, { force: true });
        dropped += 1;
      } catch {
        // Yarışta silinmiş dosya sorun değil.
      }
    }),
  );

  return dropped;
}
