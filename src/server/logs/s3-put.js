/**
 * Minimal S3 PutObject — yalnızca SigV4 + `fetch`.
 *
 * `@aws-sdk/client-s3` taşınmıyor: tek operasyon için SDK'nın maliyeti ve
 * peer yüzeyi gereksiz. Credential zinciri env'den okunur
 * (`JSKELET_S3_ACCESS_KEY_ID` / `JSKELET_S3_SECRET_ACCESS_KEY` /
 * `JSKELET_S3_SESSION_TOKEN`); IAM role / instance metadata yok —
 * container'a key vermeyen kurulumlar için sink zaten açılışta no-op'a düşer.
 */
import crypto from "node:crypto";

/**
 * @typedef {{ accessKeyId: string, secretAccessKey: string,
 *   sessionToken?: string | null }} AwsCredentials
 *
 * @typedef {{ bucket: string, key: string, body: string | Buffer,
 *   region: string, endpoint?: string | null, credentials: AwsCredentials,
 *   now?: Date }} PutObjectInput
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
  const usePathStyle = Boolean(input.endpoint);
  const endpointHost = input.endpoint
    ? new URL(input.endpoint).host
    : `${input.bucket}.s3.${input.region}.amazonaws.com`;
  const host = usePathStyle ? new URL(input.endpoint ?? "").host : endpointHost;

  const canonicalUri = usePathStyle
    ? `/${encodeS3Path(input.bucket)}/${keyPath}`
    : `/${keyPath}`;

  /** @type {Record<string, string>} */
  const headers = {
    host,
    "content-type": "application/x-ndjson",
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

  const base = usePathStyle
    ? String(input.endpoint).replace(/\/+$/, "")
    : `https://${host}`;
  const url = usePathStyle
    ? `${base}/${encodeS3Path(input.bucket)}/${keyPath}`
    : `${base}/${keyPath}`;

  return { url, headers, body };
}

/**
 * @param {PutObjectInput} input
 * @returns {Promise<void>}
 */
export async function putObject(input) {
  const signed = buildSignedPutObject(input);
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: signed.body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `S3 PutObject ${response.status}: ${text.slice(0, 200) || response.statusText}`,
    );
  }
}
