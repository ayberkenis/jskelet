/**
 * Yanıt sıkıştırma — Next.js'in varsayılan `compress: true` davranışının yerine.
 *
 * `compression` paketi brotli desteklemiyor ve yedi geçişli bağımlılık
 * getiriyor; `node:zlib` ile brotli + gzip pazarlığı yapmak yeterli.
 * Brotli tercih edilir: ana sayfa HTML'inde gzip'e göre ~%35 daha küçük.
 */
import zlib from "node:zlib";
import { Writable } from "node:stream";

/** Bu eşiğin altındaki gövdelerde sıkıştırma kazancı yok. */
const THRESHOLD_BYTES = 1024;

const COMPRESSIBLE =
  /^(?:text\/|application\/(?:json|javascript|xml|xhtml\+xml|rss\+xml|atom\+xml|ld\+json|manifest\+json)|image\/svg\+xml)/i;

const BROTLI_OPTIONS = {
  params: {
    // Metin için 5, varsayılan 11'e göre çok daha hızlı ve neredeyse aynı boyut.
    [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
  },
};

/**
 * @param {string} header
 * @returns {"br" | "gzip" | null}
 */
function negotiate(header) {
  if (!header) return null;

  /** @type {Map<string, number>} */
  const weights = new Map();

  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().split(";");
    const q = params
      .map((p) => p.trim())
      .find((p) => p.startsWith("q="));

    weights.set(name.toLowerCase(), q ? Number(q.slice(2)) : 1);
  }

  if ((weights.get("br") ?? 0) > 0) return "br";
  if ((weights.get("gzip") ?? 0) > 0) return "gzip";
  return null;
}

/**
 * İçeriği bir kez sıkıştırıp saklamak isteyen çağıranlar için (HTML cache).
 *
 * @param {string | undefined} acceptEncoding
 * @returns {"br" | "gzip" | null}
 */
export function negotiateEncoding(acceptEncoding) {
  return negotiate(acceptEncoding ?? "");
}

/**
 * @param {string} text
 * @param {"br" | "gzip"} encoding
 * @returns {Promise<Buffer>}
 */
export function encodeText(text, encoding) {
  const input = Buffer.from(text, "utf8");

  return new Promise((resolve, reject) => {
    const done = (error, result) => (error ? reject(error) : resolve(result));

    if (encoding === "br") zlib.brotliCompress(input, BROTLI_OPTIONS, done);
    else zlib.gzip(input, done);
  });
}

/**
 * @param {import('http').ServerResponse} res
 * @returns {boolean}
 */
function shouldCompress(res) {
  if (res.getHeader("content-encoding")) return false;
  if (res.getHeader("cache-control")?.toString().includes("no-transform")) {
    return false;
  }

  const type = res.getHeader("content-type")?.toString() ?? "";
  if (type.includes("text/event-stream")) return false;
  if (!COMPRESSIBLE.test(type)) return false;

  const length = Number(res.getHeader("content-length"));
  return Number.isNaN(length) || length >= THRESHOLD_BYTES;
}

/**
 * @returns {import('express').RequestHandler}
 */
export function compression() {
  return (req, res, next) => {
    // HEAD gövdesi yok; zaten sıkışık ikili içerik boşuna CPU yakar.
    const encoding = req.method === "HEAD" ? null : negotiate(req.headers["accept-encoding"]);

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    /** @type {import('zlib').Gzip | import('zlib').BrotliCompress | null} */
    let stream = null;
    let decided = false;
    let passthrough = false;

    function decide() {
      if (decided) return;
      decided = true;

      // SSE gibi akışlar başlıkları kendileri yazar (`writeHead`); bu noktada
      // başlık eklemek çökme sebebi olur, sıkıştırma da anlamsızdır.
      if (res.headersSent) {
        passthrough = true;
        return;
      }

      // Vary her durumda: aynı URL farklı encoding ile cache'lenebilir.
      res.setHeader("Vary", appendVary(res.getHeader("Vary"), "Accept-Encoding"));

      if (!encoding || !shouldCompress(res)) {
        passthrough = true;
        return;
      }

      res.setHeader("Content-Encoding", encoding);
      res.removeHeader("Content-Length");

      stream =
        encoding === "br"
          ? zlib.createBrotliCompress(BROTLI_OPTIONS)
          : zlib.createGzip({ level: 6 });

      // Sıkıştırılmış çıktıyı sokete geri baskıya saygı duyarak aktar.
      stream.pipe(
        new Writable({
          write(chunk, chunkEncoding, callback) {
            originalWrite(chunk, chunkEncoding, callback);
          },
          final(callback) {
            originalEnd();
            callback();
          },
        }),
      );

      // `express.static` gövdeyi `pipe` ile yazar ve `res.write()` false
      // dönerse `drain` bekler; zlib doldu-boşaldı sinyalini yansıtmazsak
      // aktarım sessizce askıda kalır.
      stream.on("drain", () => res.emit("drain"));
      stream.on("error", () => originalEnd());
    }

    res.write = function write(chunk, encodingArg, callback) {
      decide();
      if (passthrough) return originalWrite(chunk, encodingArg, callback);
      if (!chunk) return true;

      return stream.write(toBuffer(chunk, encodingArg), callback);
    };

    res.end = function end(chunk, encodingArg, callback) {
      decide();
      if (passthrough) return originalEnd(chunk, encodingArg, callback);

      if (chunk && typeof chunk !== "function") {
        stream.end(toBuffer(chunk, encodingArg), callback);
      } else {
        stream.end();
      }

      return res;
    };

    next();
  };
}

/**
 * @param {unknown} chunk
 * @param {unknown} encodingArg
 * @returns {Buffer}
 */
function toBuffer(chunk, encodingArg) {
  if (Buffer.isBuffer(chunk)) return chunk;
  return Buffer.from(
    /** @type {string} */ (chunk),
    typeof encodingArg === "string" ? /** @type {BufferEncoding} */ (encodingArg) : "utf8",
  );
}

/**
 * @param {unknown} current
 * @param {string} field
 * @returns {string}
 */
function appendVary(current, field) {
  const existing = current ? String(current) : "";
  if (!existing) return field;

  const parts = existing.split(",").map((p) => p.trim().toLowerCase());
  return parts.includes(field.toLowerCase()) ? existing : `${existing}, ${field}`;
}
