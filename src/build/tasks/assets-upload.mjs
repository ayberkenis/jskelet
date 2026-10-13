/**
 * Production build sonunda hash'li varlıkları S3'e PutObject ile kopyalar.
 *
 * Watch turunda çalışmaz (çağıran sorumlu). Credential: env (`AWS_*` /
 * `JSKELET_S3_*`) → ECS task role → EC2 instance profile. Bucket yoksa veya
 * upload kapalıysa adım yine görünür: `skipped (…)` ile sebep basılır.
 * Credential yalnızca env+metadata zinciri boşsa skip; task role varken
 * env key şart değil.
 *
 * `.br` / `.gz` kardeşleri yüklenmez: edge kendi sıkıştırmasını yapsın;
 * origin precompress Express için kalır.
 */
import fs from "node:fs";
import path from "node:path";
import {
  resolveS3Credentials,
  s3CredentialsMissingReason,
} from "../../server/logs/s3-credentials.js";
import { putBucketCors, putObject } from "../../server/logs/s3-put.js";
import * as log from "../../log.mjs";
import { paths } from "../paths.mjs";

const CONCURRENCY = 8;

/** Font MIME — CDN'den HTML çapraz origin yüklerken CORS gerekir. */
const FONT_MIME = new Set([
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
  "application/font-woff",
  "application/font-woff2",
]);

/** @type {Record<string, string>} */
const MIME = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".json": "application/json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * @param {string} filePath
 * @returns {string}
 */
export function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

/**
 * @param {string} dir
 * @returns {string[]} Mutlak dosya yolları
 */
export function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];

  /** @type {string[]} */
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      // Precompress kardeşleri origin'e özel; S3'e basma.
      if (entry.name.endsWith(".br") || entry.name.endsWith(".gz")) continue;
      out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * `include` adını `public/` altı mutlak dizine çevirir.
 *
 * @param {string} name
 * @returns {string | null}
 */
function resolveIncludeDir(name) {
  if (name === "assets") return paths.assets;
  if (name === "fonts") return paths.fonts;
  if (!name || name.includes("..") || path.isAbsolute(name)) return null;
  return path.join(paths.public, name);
}

/**
 * Config kapısı — credential burada bakılmaz (task role async).
 *
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @returns {string | null}
 */
export function assetsUploadSkipReason(config) {
  const upload = config.build?.assets?.upload;

  if (!upload?.enabled) {
    // Bucket yoksa asıl eksik alanı söyle — `enabled: false` çoğu zaman
    // bucket tanımlanmadığı için dolaylıdır.
    if (!upload?.bucket) return "no build.assets.upload.bucket";
    return "build.assets.upload.enabled is false";
  }

  if (!upload.bucket) return "no build.assets.upload.bucket";

  return null;
}

/**
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @param {{ put?: typeof putObject,
 *   putCors?: typeof putBucketCors,
 *   resolveCredentials?: typeof resolveS3Credentials }} [options]
 * @returns {Promise<void>}
 */
export async function uploadAssets(config, options = {}) {
  const reason = assetsUploadSkipReason(config);
  if (reason) {
    log.detail(`skipped (${reason})`);
    return;
  }

  const upload = config.build.assets.upload;
  const resolve = options.resolveCredentials ?? resolveS3Credentials;
  const credentials = await resolve();
  if (!upload.bucket || !credentials) {
    log.detail(`skipped (${s3CredentialsMissingReason()})`);
    return;
  }

  const put = options.put ?? putObject;
  const putCors = options.putCors ?? putBucketCors;
  // Normalize bazen atlanır (test / elle config); önek `/` ile bitsin.
  let keyPrefix = (upload.keyPrefix || "").replace(/^\/+/, "");
  if (keyPrefix && !keyPrefix.endsWith("/")) keyPrefix += "/";

  /** @type {{ file: string, key: string }[]} */
  const jobs = [];
  for (const name of upload.include) {
    const dir = resolveIncludeDir(name);
    if (!dir) {
      console.warn(`[assets] upload.include "${name}" is invalid, skipping`);
      continue;
    }
    for (const file of listFilesRecursive(dir)) {
      const relative = path
        .relative(paths.public, file)
        .split(path.sep)
        .join("/");
      if (relative.startsWith("..")) continue;
      jobs.push({ file, key: `${keyPrefix}${relative}` });
    }
  }

  if (!jobs.length) {
    log.detail("0 files");
    return;
  }

  const uploadsFonts = jobs.some((job) =>
    FONT_MIME.has(contentTypeFor(job.file)),
  );
  if (uploadsFonts && upload.corsOrigin) {
    try {
      await putCors({
        bucket: upload.bucket,
        region: upload.region,
        endpoint: upload.endpoint,
        credentials,
        allowedOrigin: upload.corsOrigin,
      });
      log.detail(`cors ${upload.corsOrigin}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[assets] PutBucketCors failed (${message}) — set CDN/bucket CORS manually for cross-origin fonts`,
      );
    }
  }

  let uploaded = 0;
  let index = 0;

  /** @returns {Promise<void>} */
  const worker = async () => {
    while (index < jobs.length) {
      const job = jobs[index++];
      const body = fs.readFileSync(job.file);
      await put({
        bucket: upload.bucket,
        key: job.key,
        body,
        region: upload.region,
        endpoint: upload.endpoint,
        credentials,
        contentType: contentTypeFor(job.file),
        cacheControl: upload.cacheControl,
      });
      uploaded += 1;
    }
  };

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, jobs.length) },
    () => worker(),
  );
  await Promise.all(workers);

  const target = `${upload.bucket}/${keyPrefix}`.replace(/\/+/g, "/");
  const via = upload.endpoint ? ` @ ${upload.endpoint}` : "";
  log.detail(`${uploaded} → s3://${target}${via}`);
}
