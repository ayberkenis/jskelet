/**
 * Minimal S3 PutObject — yalnızca SigV4 + `fetch`.
 *
 * `@aws-sdk/client-s3` taşınmıyor: tek operasyon için SDK'nın maliyeti ve
 * peer yüzeyi gereksiz. Credential `resolveS3Credentials` ile gelir
 * (env → ECS task role → EC2 IMDS).
 */
import crypto from "node:crypto";

/**
 * @typedef {{ accessKeyId: string, secretAccessKey: string,
 *   sessionToken?: string | null }} AwsCredentials
 *
 * @typedef {{ bucket: string, key: string, body: string | Buffer,
 *   region: string, endpoint?: string | null, credentials: AwsCredentials,
 *   contentType?: string, cacheControl?: string | null, now?: Date }} PutObjectInput
 *
 * @typedef {{ bucket: string, region: string, endpoint?: string | null,
 *   credentials: AwsCredentials, allowedOrigin: string, now?: Date }} PutBucketCorsInput
 */

/**
 * @param {string} algorithm
 * @param {string | Buffer} key
 * @param {string | Buffer} data
 * @returns {Buffer}
 */
function hmac(algorithm, key, data) {
  return crypto.createHmac(algorithm, key).update(data).digest();
}

/**
 * @param {string | Buffer} data
 * @returns {string}
 */
export function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * @param {Date} date
 * @returns {{ amzDate: string, dateStamp: string }}
 */
export function formatAmzDates(date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

/**
 * @param {string} secretAccessKey
 * @param {string} dateStamp
 * @param {string} region
 * @param {string} service
 * @returns {Buffer}
 */
export function deriveSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac("sha256", `AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac("sha256", kDate, region);
  const kService = hmac("sha256", kRegion, service);
  return hmac("sha256", kService, "aws4_request");
}

/**
 * @param {{ method: string, canonicalUri: string, canonicalQuerystring?: string,
 *   headers: Record<string, string>, payloadHash: string }} parts
 * @returns {{ canonicalRequest: string, signedHeaders: string }}
 */
export function buildCanonicalRequest(parts) {
  const names = Object.keys(parts.headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${parts.headers[name].trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [
    parts.method,
    parts.canonicalUri,
    parts.canonicalQuerystring ?? "",
    canonicalHeaders,
    signedHeaders,
    parts.payloadHash,
  ].join("\n");

  return { canonicalRequest, signedHeaders };
}

/**
 * @param {{ amzDate: string, dateStamp: string, region: string, service: string,
 *   canonicalRequest: string }} parts
 * @returns {string}
 */
export function buildStringToSign(parts) {
  const scope = `${parts.dateStamp}/${parts.region}/${parts.service}/aws4_request`;
  return [
    "AWS4-HMAC-SHA256",
    parts.amzDate,
    scope,
    sha256Hex(parts.canonicalRequest),
  ].join("\n");
}

/**
 * URI path encode (S3 key segment'leri). `/` korunur.
 *
 * @param {string} value
 * @returns {string}
 */
export function encodeS3Path(value) {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    ))
    .join("/");
}

/**
 * Virtual-hosted (`bucket.s3.region…`) TLS sertifikası `*.s3.region…` —
 * yalnızca **tek** etiket. `static.investvio.dev` gibi noktalı bucket'lar
 * `Host: static.investvio.dev.s3.…` üretir ve `ERR_TLS_CERT_ALTNAME_INVALID`
 * verir. Path-style (`s3.region…/bucket/key`) bunu çözer.
 *
 * @param {string} bucket
 * @param {string | null | undefined} endpoint
 * @returns {boolean}
 */
export function useS3PathStyle(bucket, endpoint) {
  if (endpoint) return true;
  return bucket.includes(".");
}

/**
 * @param {{ bucket: string, region: string, endpoint?: string | null }} input
 * @returns {{ host: string, base: string, pathStyle: boolean }}
 */
function s3EndpointParts(input) {
  const pathStyle = useS3PathStyle(input.bucket, input.endpoint);
  if (input.endpoint) {
    const base = String(input.endpoint).replace(/\/+$/, "");
    return { host: new URL(input.endpoint).host, base, pathStyle: true };
  }
  if (pathStyle) {
    const host = `s3.${input.region}.amazonaws.com`;
    return { host, base: `https://${host}`, pathStyle: true };
  }
  const host = `${input.bucket}.s3.${input.region}.amazonaws.com`;
  return { host, base: `https://${host}`, pathStyle: false };
}

/**
 * PutObject isteğini imzalar; ağ çağrısı yapmaz — test edilebilir olsun diye.
 *
 * @param {PutObjectInput} input
 * @returns {{ url: string, headers: Record<string, string>, body: Buffer }}
 */
export function buildSignedPutObject(input) {
  const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
  const now = input.now ?? new Date();
  const { amzDate, dateStamp } = formatAmzDates(now);
  const service = "s3";
  const payloadHash = sha256Hex(body);

  const keyPath = encodeS3Path(input.key.replace(/^\/+/, ""));
  const { host, base, pathStyle } = s3EndpointParts(input);

  const canonicalUri = pathStyle
    ? `/${encodeS3Path(input.bucket)}/${keyPath}`
    : `/${keyPath}`;

  /** @type {Record<string, string>} */
  const headers = {
    host,
    // Log sink varsayılanı; asset upload `contentType` geçirir.
    "content-type": input.contentType ?? "application/x-ndjson",
    "content-length": String(body.length),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  if (input.cacheControl) {
    headers["cache-control"] = input.cacheControl;
  }

  if (input.credentials.sessionToken) {
    headers["x-amz-security-token"] = input.credentials.sessionToken;
  }

  const { canonicalRequest, signedHeaders } = buildCanonicalRequest({
    method: "PUT",
    canonicalUri,
    headers,
    payloadHash,
  });

  const stringToSign = buildStringToSign({
    amzDate,
    dateStamp,
    region: input.region,
    service,
    canonicalRequest,
  });

  const signingKey = deriveSigningKey(
    input.credentials.secretAccessKey,
    dateStamp,
    input.region,
    service,
  );
  const signature = hmac("sha256", signingKey, stringToSign).toString("hex");
  const credentialScope = `${dateStamp}/${input.region}/${service}/aws4_request`;

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = pathStyle
    ? `${base}/${encodeS3Path(input.bucket)}/${keyPath}`
    : `${base}/${keyPath}`;

  return { url, headers, body };
}

/**
 * PutBucketCors gövdesi — tek kural, GET/HEAD.
 *
 * @param {string} allowedOrigin
 * @returns {string}
 */
export function corsConfigurationXml(allowedOrigin) {
  const origin = String(allowedOrigin)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    `<CORSRule>` +
    `<AllowedOrigin>${origin}</AllowedOrigin>` +
    `<AllowedMethod>GET</AllowedMethod>` +
    `<AllowedMethod>HEAD</AllowedMethod>` +
    `<AllowedHeader>*</AllowedHeader>` +
    `<ExposeHeader>ETag</ExposeHeader>` +
    `<ExposeHeader>Content-Type</ExposeHeader>` +
    `<MaxAgeSeconds>86400</MaxAgeSeconds>` +
    `</CORSRule>` +
    `</CORSConfiguration>`
  );
}

/**
 * PutBucketCors isteğini imzalar (`PUT /?cors` veya path-style `/bucket?cors`).
 *
 * @param {PutBucketCorsInput} input
 * @returns {{ url: string, headers: Record<string, string>, body: Buffer }}
 */
export function buildSignedPutBucketCors(input) {
  const body = Buffer.from(corsConfigurationXml(input.allowedOrigin), "utf8");
  const now = input.now ?? new Date();
  const { amzDate, dateStamp } = formatAmzDates(now);
  const payloadHash = sha256Hex(body);
  const { host, base, pathStyle } = s3EndpointParts(input);

  // AWS: cors alt kaynağının canonical query'si `cors=` (boş değer).
  const canonicalQuerystring = "cors=";
  const canonicalUri = pathStyle ? `/${encodeS3Path(input.bucket)}` : "/";

  /** @type {Record<string, string>} */
  const headers = {
    host,
    "content-type": "application/xml",
    "content-length": String(body.length),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };

  if (input.credentials.sessionToken) {
    headers["x-amz-security-token"] = input.credentials.sessionToken;
  }

  const { canonicalRequest, signedHeaders } = buildCanonicalRequest({
    method: "PUT",
    canonicalUri,
    canonicalQuerystring,
    headers,
    payloadHash,
  });

  const stringToSign = buildStringToSign({
    amzDate,
    dateStamp,
    region: input.region,
    service: "s3",
    canonicalRequest,
  });

  const signingKey = deriveSigningKey(
    input.credentials.secretAccessKey,
    dateStamp,
    input.region,
    "s3",
  );
  const signature = hmac("sha256", signingKey, stringToSign).toString("hex");
  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = pathStyle
    ? `${base}/${encodeS3Path(input.bucket)}?cors`
    : `${base}/?cors`;

  return { url, headers, body };
}

/**
 * Bucket CORS yazar. Mevcut kuralların **üzerine** yazar; paylaşımlı
 * kovada bilinçli kullanılmalı. İzin yoksa çağıran uyarır, upload sürer.
 *
 * @param {PutBucketCorsInput} input
 * @returns {Promise<void>}
 */
export async function putBucketCors(input) {
  const signed = buildSignedPutBucketCors(input);
  /** @type {Response} */
  let response;
  try {
    response = await fetch(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body: signed.body,
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : String(error);
    throw new Error(`S3 PutBucketCors fetch failed (${signed.url}): ${detail}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `S3 PutBucketCors ${response.status}: ${text.slice(0, 200) || response.statusText}`,
    );
  }
}

/**
 * @param {PutObjectInput} input
 * @returns {Promise<void>}
 */
export async function putObject(input) {
  const signed = buildSignedPutObject(input);
  /** @type {Response} */
  let response;
  try {
    response = await fetch(signed.url, {
      method: "PUT",
      headers: signed.headers,
      body: signed.body,
    });
  } catch (error) {
    const cause =
      error && typeof error === "object" && "cause" in error && error.cause
        ? /** @type {{ message?: string, code?: string }} */ (error.cause)
        : null;
    const detail =
      cause?.code ||
      cause?.message ||
      (error instanceof Error ? error.message : String(error));
    throw new Error(`S3 PutObject fetch failed (${signed.url}): ${detail}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `S3 PutObject ${response.status}: ${text.slice(0, 200) || response.statusText}`,
    );
  }
}
