/**
 * Redis ve disk L2'nin ortak gövdesi.
 *
 * 1 KB altı düz JSON kalır (`redis-cli` ve küçük veri kayıtları okunaklı
 * kalsın). Üstü `JSK\\x01` + brotli. zstd `node:zlib`'de 22.15'ten itibaren
 * var; motor `>=22` olduğu için brotli — yanıt sıkıştırmasıyla aynı kalite.
 */
import zlib from "node:zlib";

const COMPRESS_THRESHOLD = 1024;
const CACHE_MAGIC = Buffer.from([0x4a, 0x53, 0x4b, 0x01]);
const BROTLI_OPTIONS = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
  },
};

/**
 * @param {string} json
 * @param {Buffer} compressed
 * @returns {string | Buffer}
 */
function pickPayload(json, compressed) {
  const packed = Buffer.concat([CACHE_MAGIC, compressed]);
  return packed.length < Buffer.byteLength(json) ? packed : json;
}

/**
 * Küçük gövde düz `string` döner (çağıran senkron yazabilsin). Büyük gövde
 * brotli bitince çözülen bir Promise.
 *
 * @param {unknown} value
 * @returns {string | Buffer | Promise<string | Buffer> | null}
 */
export function encodeCacheValue(value) {
  /** @type {string} */
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }

  if (Buffer.byteLength(json) < COMPRESS_THRESHOLD) return json;

  return new Promise((resolve) => {
    zlib.brotliCompress(Buffer.from(json), BROTLI_OPTIONS, (error, compressed) => {
      if (error) resolve(json);
      else resolve(pickPayload(json, compressed));
    });
  });
}

/**
 * @param {Buffer | string} raw
 * @returns {unknown}
 */
export function decodeCacheValue(raw) {
  if (
    Buffer.isBuffer(raw) &&
    raw.length > CACHE_MAGIC.length &&
    raw.subarray(0, CACHE_MAGIC.length).equals(CACHE_MAGIC)
  ) {
    return JSON.parse(zlib.brotliDecompressSync(raw.subarray(CACHE_MAGIC.length)).toString("utf8"));
  }

  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
  return JSON.parse(text);
}
