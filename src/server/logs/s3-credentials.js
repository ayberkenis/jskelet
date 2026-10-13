/**
 * S3 imza credential zinciri — SDK yok.
 *
 * 1. Env: `AWS_*` sonra `JSKELET_S3_*`
 * 2. ECS/Fargate task role: `AWS_CONTAINER_CREDENTIALS_*`
 * 3. EC2 instance profile: IMDSv2 (kısa timeout; local'de asılı kalmaz)
 *
 * EKS IRSA (`AWS_WEB_IDENTITY_TOKEN_FILE`) bilinçli olarak yok — STS çağrısı
 * ayrı yüzey; CI genelde zaten `AWS_*` basar.
 */
import fs from "node:fs";
import process from "node:process";

/**
 * @typedef {{ accessKeyId: string, secretAccessKey: string,
 *   sessionToken: string | null }} AwsCredentials
 */

// Local'de IMDS yokken hızlı vazgeç; ECS'te URI varken biraz daha sabır.
const IMDS_TIMEOUT_MS = 400;
const ECS_TIMEOUT_MS = 2_000;
const ECS_METADATA_HOST = "http://169.254.170.2";
const EC2_METADATA_HOST = "http://169.254.169.254";

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function envText(value) {
  return typeof value === "string" && value ? value : null;
}

/**
 * @returns {AwsCredentials | null}
 */
export function readS3CredentialsFromEnv() {
  const accessKeyId =
    envText(process.env.AWS_ACCESS_KEY_ID) ??
    envText(process.env.JSKELET_S3_ACCESS_KEY_ID);
  const secretAccessKey =
    envText(process.env.AWS_SECRET_ACCESS_KEY) ??
    envText(process.env.JSKELET_S3_SECRET_ACCESS_KEY) ??
    envText(process.env.JSKELET_S3_ACCESS_SECRET);
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken:
      envText(process.env.AWS_SESSION_TOKEN) ??
      envText(process.env.JSKELET_S3_SESSION_TOKEN),
  };
}

/**
 * @param {Record<string, unknown>} data
 * @returns {AwsCredentials | null}
 */
function fromAwsCredentialJson(data) {
  const accessKeyId =
    typeof data.AccessKeyId === "string" ? data.AccessKeyId : null;
  const secretAccessKey =
    typeof data.SecretAccessKey === "string" ? data.SecretAccessKey : null;
  if (!accessKeyId || !secretAccessKey) return null;
  const token =
    (typeof data.Token === "string" && data.Token) ||
    (typeof data.SessionToken === "string" && data.SessionToken) ||
    null;
  return { accessKeyId, secretAccessKey, sessionToken: token };
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 * @returns {Promise<unknown | null>}
 */
async function fetchJson(url, init = {}, timeoutMs = IMDS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {number} [timeoutMs]
 * @returns {Promise<string | null>}
 */
async function fetchText(url, init = {}, timeoutMs = IMDS_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return (await response.text()).trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ECS task role / container credential provider.
 *
 * @returns {Promise<AwsCredentials | null>}
 */
export async function readS3CredentialsFromEcs() {
  const relative = envText(process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI);
  const full = envText(process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI);
  if (!relative && !full) return null;

  const url = full ?? `${ECS_METADATA_HOST}${relative}`;

  /** @type {Record<string, string>} */
  const headers = {};
  const token =
    envText(process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN) ??
    readTokenFile(process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE);
  if (token) headers.Authorization = token;

  const data = await fetchJson(url, { headers }, ECS_TIMEOUT_MS);
  if (!data || typeof data !== "object") return null;
  return fromAwsCredentialJson(/** @type {Record<string, unknown>} */ (data));
}

/**
 * @param {unknown} pathValue
 * @returns {string | null}
 */
function readTokenFile(pathValue) {
  const file = envText(pathValue);
  if (!file) return null;
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * EC2 instance profile via IMDSv2 (IMDSv1'e düşmez).
 *
 * @returns {Promise<AwsCredentials | null>}
 */
export async function readS3CredentialsFromImds() {
  const token = await fetchText(
    `${EC2_METADATA_HOST}/latest/api/token`,
    {
      method: "PUT",
      headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" },
    },
  );
  if (!token) return null;

  const headers = { "X-aws-ec2-metadata-token": token };
  const roleName = await fetchText(
    `${EC2_METADATA_HOST}/latest/meta-data/iam/security-credentials/`,
    { headers },
  );
  if (!roleName) return null;

  // Birden fazla satır olursa ilki.
  const role = roleName.split("\n")[0]?.trim();
  if (!role || role.includes("..") || role.includes("/")) return null;

  const data = await fetchJson(
    `${EC2_METADATA_HOST}/latest/meta-data/iam/security-credentials/${encodeURIComponent(role)}`,
    { headers },
  );
  if (!data || typeof data !== "object") return null;
  return fromAwsCredentialJson(/** @type {Record<string, unknown>} */ (data));
}

/**
 * Credential neden bulunamadı — upload skip satırı için.
 *
 * @returns {string}
 */
export function s3CredentialsMissingReason() {
  if (
    envText(process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) ||
    envText(process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI)
  ) {
    return "credentials missing (ECS metadata failed)";
  }
  return "credentials missing (no env keys, no ECS task role — upload needs runtime/CI role, not docker build)";
}

/**
 * Env → ECS task role → EC2 instance profile.
 *
 * @returns {Promise<AwsCredentials | null>}
 */
export async function resolveS3Credentials() {
  const fromEnv = readS3CredentialsFromEnv();
  if (fromEnv) return fromEnv;

  const fromEcs = await readS3CredentialsFromEcs();
  if (fromEcs) return fromEcs;

  return readS3CredentialsFromImds();
}
