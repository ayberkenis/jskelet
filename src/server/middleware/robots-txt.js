/**
 * Kullanıcının `robots.txt` gövdesinin altına framework uçlarını ekler.
 *
 * Panel, görsel proxy, auth handoff, dev araçları ve fragment parçaları
 * sayfa değildir; bir crawler onları dizinine alırsa indeks parçalı HTML
 * ve yönetim yollarıyla kirlenir. Uygulama dosyayı kendisi yazar (`public/`
 * ya da bir route). Framework yalnızca başarılı metin yanıtının sonuna bir
 * not ve `Disallow` grubu düşer — dosya yoksa uydurulmaz.
 *
 * Google, belirli bir user-agent grubunu `User-agent: *` ile birleştirmez;
 * aynı ajanın ikinci grubunu birleştirir. Bu yüzden alttaki grup, dosyada
 * adı geçen her ajanı tekrarlar. Aksi hâlde yalnızca `Googlebot` grubu olan
 * bir dosyada ek hiç uygulanmazdı.
 *
 * Sıkıştırılmış kopyanın (`Content-Encoding` dolu) üzerine yazılmaz: ek,
 * düz metnin sonuna konur, sıkıştırma dıştaki middleware'de olur.
 */
import crypto from "node:crypto";
import { getConfig } from "../../config/index.js";

/** İdempotency anahtarı. Marka adı değişse de ikinci kez eklenmez. */
const NOTE_MARK = "framework endpoints, not for indexing";

/** Framework'ün ayırdığı önekler. Özel bir yola taşınsalar da bunlar kalır. */
const RESERVED_PREFIXES = ["/_jskelet/", "/__jskelet/", "/_fragment/"];

/**
 * @param {string} [brandName]
 * @returns {string}
 */
export function frameworkRobotsNote(brandName = "JSkelet") {
  const name = String(brandName || "JSkelet")
    .replace(/[\r\n]+/g, " ")
    .trim();
  return `# ${name || "JSkelet"} — ${NOTE_MARK}`;
}

/**
 * `robots.txt`'e yazılacak `Disallow` yolları.
 *
 * Üç önek her zaman vardır. Panel, uzak görsel ve handoff yalnızca
 * gerçekten mount edildiklerinde ve öneklerin dışına taşındıklarında eklenir.
 * Dev araçlarının özel yolu yalnızca development'ta yazılır: production'da
 * o yol uygulamanın kendi sayfası olabilir.
 *
 * @param {object} [config]
 * @param {{ dev?: boolean }} [options]
 * @returns {string[]}
 */
export function frameworkDisallowPaths(config = {}, options = {}) {
  /** @type {string[]} */
  const paths = [...RESERVED_PREFIXES];
  const dev = options.dev ?? process.env.NODE_ENV === "development";

  /** @type {string[]} */
  const extras = [];

  const admin = /** @type {{ enabled?: boolean, basePath?: string }} */ (
    config.admin
  );
  if (admin?.enabled && typeof admin.basePath === "string") {
    extras.push(admin.basePath);
  }

  const images = /** @type {{ remote?: { enabled?: boolean, path?: string } | false } | false} */ (
    config.images
  );
  const remote = images && images !== false ? images.remote : null;
  if (remote && remote !== false && remote.enabled && typeof remote.path === "string") {
    extras.push(remote.path);
  }

  const auth = /** @type {{ crossSubdomainHandoff?: boolean | { enabled?: boolean, path?: string } }} */ (
    config.auth
  );
  const handoff = auth?.crossSubdomainHandoff;
  const handoffOn =
    handoff === true ||
    (Boolean(handoff) &&
      typeof handoff === "object" &&
      handoff.enabled !== false);
  if (handoffOn && handoff && typeof handoff === "object" && typeof handoff.path === "string") {
    extras.push(handoff.path);
  }

  const brand = /** @type {{ devBasePath?: string }} */ (config.brand);
  if (dev && typeof brand?.devBasePath === "string") {
    extras.push(brand.devBasePath);
  }

  for (const raw of extras) {
    const path = cleanDisallowPath(raw);
    if (!path) continue;
    if (paths.some((existing) => coveredBy(existing, path))) continue;
    paths.push(path);
  }

  return paths;
}

/**
 * @param {string} body
 * @param {{ brandName?: string, paths: string[] }} options
 * @returns {string}
 */
export function appendFrameworkRobots(body, options) {
  const text = String(body ?? "").replace(/^\uFEFF/, "");
  const paths = options.paths.filter((path) => cleanDisallowPath(path) || isReserved(path));
  if (paths.length === 0 || text.includes(NOTE_MARK)) return text;

  const agents = collectUserAgents(text);
  const block = [
    frameworkRobotsNote(options.brandName),
    ...agents.map((agent) => `User-agent: ${agent}`),
    ...paths.map((path) => `Disallow: ${path}`),
    "",
  ].join("\n");

  const base = text.replace(/\s*$/, "");
  return base ? `${base}\n\n${block}` : block;
}

/**
 * @returns {import('express').RequestHandler}
 */
export function robotsTxtMiddleware() {
  return function robotsTxt(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    const pathname = req.path || "";
    if (pathname !== "/robots.txt") {
      next();
      return;
    }

    // Handler'ın kendi ETag'i eklenmemiş gövdeye aittir. 304, crawler'ın
    // framework bloğu olmayan kopyayı tutmasına yol açardı.
    const previousEtag = req.headers["if-none-match"];
    delete req.headers["if-none-match"];
    delete req.headers["if-modified-since"];

    /** @type {Buffer[]} */
    const chunks = [];
    const originalEnd = res.end;
    let finished = false;

    res.write = function write(chunk, encoding, callback) {
      const enc = typeof encoding === "function" ? undefined : encoding;
      const done = typeof encoding === "function" ? encoding : callback;
      const buf = takeChunk(chunk, enc);
      if (buf && buf.length) chunks.push(buf);
      if (typeof done === "function") done();
      return true;
    };

    res.end = function end(chunk, encoding, callback) {
      if (finished) return originalEnd.call(this);
      finished = true;

      const enc = typeof encoding === "function" ? undefined : encoding;
      const done =
        typeof chunk === "function"
          ? chunk
          : typeof encoding === "function"
            ? encoding
            : callback;
      const buf = takeChunk(chunk, enc);
      if (buf && buf.length) chunks.push(buf);

      const body = chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);

      if (!shouldRewrite(req, res, body)) {
        return typeof done === "function"
          ? originalEnd.call(this, body, done)
          : originalEnd.call(this, body);
      }

      const context = readRobotsContext();
      const nextBody = Buffer.from(
        appendFrameworkRobots(body.toString("utf8"), context),
        "utf8",
      );
      const tag = `"${crypto.createHash("sha1").update(nextBody).digest("base64url")}"`;

      if (previousEtag && etagMatches(previousEtag, tag)) {
        res.statusCode = 304;
        res.setHeader("ETag", tag);
        res.setHeader("Content-Length", "0");
        res.removeHeader("Last-Modified");
        return originalEnd.call(this);
      }

      const type = String(res.getHeader("content-type") || "");
      if (!/^text\/plain\b/i.test(type)) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      res.setHeader("ETag", tag);
      res.setHeader("Content-Length", String(nextBody.length));
      res.removeHeader("Last-Modified");

      return typeof done === "function"
        ? originalEnd.call(this, nextBody, done)
        : originalEnd.call(this, nextBody);
    };

    next();
  };
}

/**
 * @returns {{ brandName: string, paths: string[] }}
 */
function readRobotsContext() {
  try {
    const config = getConfig();
    const brand = /** @type {{ name?: string }} */ (config.brand);
    return {
      brandName: typeof brand?.name === "string" && brand.name ? brand.name : "JSkelet",
      paths: frameworkDisallowPaths(config),
    };
  } catch {
    return { brandName: "JSkelet", paths: frameworkDisallowPaths({}) };
  }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Buffer} body
 * @returns {boolean}
 */
function shouldRewrite(req, res, body) {
  if (req.method !== "GET") return false;
  if (res.headersSent) return false;

  const status = res.statusCode || 200;
  if (status < 200 || status >= 300) return false;
  if (res.getHeader("content-encoding")) return false;

  const type = String(res.getHeader("content-type") || "");
  if (type && !/^text\/(?:plain|html)\b/i.test(type)) return false;

  const sample = body.subarray(0, 64).toString("utf8");
  if (/^\s*<(!doctype|html)\b/i.test(sample)) return false;
  return true;
}

/**
 * @param {string | string[] | undefined} header
 * @param {string} tag
 * @returns {boolean}
 */
function etagMatches(header, tag) {
  const value = Array.isArray(header) ? header.join(",") : String(header);
  return value.split(",").some((part) => {
    const token = part.trim().replace(/^W\//i, "");
    return token === "*" || token === tag;
  });
}

/**
 * @param {unknown} chunk
 * @param {unknown} encoding
 * @returns {Buffer | null}
 */
function takeChunk(chunk, encoding) {
  if (chunk == null || typeof chunk === "function") return null;
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (typeof chunk === "string") {
    const enc = typeof encoding === "string" ? encoding : "utf8";
    return Buffer.from(chunk, /** @type {BufferEncoding} */ (enc));
  }
  return null;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function collectUserAgents(text) {
  /** @type {string[]} */
  const agents = [];
  const seen = new Set();

  for (const line of text.split(/\r?\n/)) {
    const match = /^[ \t]*user-agent[ \t]*:[ \t]*(.*?)[ \t]*$/i.exec(line);
    if (!match) continue;
    const agent = match[1].trim();
    if (!agent || /[\r\n]/.test(agent)) continue;
    const key = agent.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    agents.push(agent);
  }

  const star = agents.findIndex((agent) => agent === "*");
  if (star === -1) agents.unshift("*");
  else if (star > 0) {
    agents.splice(star, 1);
    agents.unshift("*");
  }

  return agents;
}

/**
 * @param {string} raw
 * @returns {string | null}
 */
function cleanDisallowPath(raw) {
  if (typeof raw !== "string") return null;
  const pathOnly = raw.split("?")[0].trim();
  if (!pathOnly.startsWith("/") || /[\s#]/.test(pathOnly)) return null;
  const trimmed = pathOnly.replace(/\/+$/, "");
  return trimmed || null;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isReserved(path) {
  return RESERVED_PREFIXES.includes(path);
}

/**
 * @param {string} rule
 * @param {string} candidate
 * @returns {boolean}
 */
function coveredBy(rule, candidate) {
  const ruleExact = rule.replace(/\/+$/, "");
  const candExact = candidate.replace(/\/+$/, "");
  if (candExact === ruleExact) return true;
  const prefix = rule.endsWith("/") ? rule : `${ruleExact}/`;
  return candidate.startsWith(prefix) || `${candExact}/`.startsWith(prefix);
}
