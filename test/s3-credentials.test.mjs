/**
 * S3 credential zinciri — env + ECS metadata (ağ mock).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  readS3CredentialsFromEcs,
  readS3CredentialsFromEnv,
  resolveS3Credentials,
} from "../src/server/logs/s3-credentials.js";

const savedEnv = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
  globalThis.fetch = originalFetch;
});

function clearCredEnv() {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.JSKELET_S3_ACCESS_KEY_ID;
  delete process.env.JSKELET_S3_SECRET_ACCESS_KEY;
  delete process.env.JSKELET_S3_SESSION_TOKEN;
  delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  delete process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  delete process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
}

test("readS3CredentialsFromEnv prefers AWS_*", () => {
  clearCredEnv();
  process.env.JSKELET_S3_ACCESS_KEY_ID = "jsk";
  process.env.JSKELET_S3_SECRET_ACCESS_KEY = "jsk-secret";
  assert.equal(readS3CredentialsFromEnv()?.accessKeyId, "jsk");

  process.env.AWS_ACCESS_KEY_ID = "aws";
  process.env.AWS_SECRET_ACCESS_KEY = "aws-secret";
  assert.equal(readS3CredentialsFromEnv()?.accessKeyId, "aws");
});

test("readS3CredentialsFromEcs uses container metadata URI", async () => {
  clearCredEnv();
  process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = "/v2/credentials/abc";

  /** @type {string[]} */
  const urls = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(
      JSON.stringify({
        AccessKeyId: "ASIATASK",
        SecretAccessKey: "task-secret",
        Token: "task-token",
      }),
      { status: 200 },
    );
  };

  const creds = await readS3CredentialsFromEcs();
  assert.deepEqual(creds, {
    accessKeyId: "ASIATASK",
    secretAccessKey: "task-secret",
    sessionToken: "task-token",
  });
  assert.equal(urls[0], "http://169.254.170.2/v2/credentials/abc");
});

test("resolveS3Credentials falls through to ECS when env empty", async () => {
  clearCredEnv();
  process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI =
    "http://127.0.0.1:9/creds";

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        AccessKeyId: "ASIAECS",
        SecretAccessKey: "ecs-secret",
        Token: "ecs-token",
      }),
      { status: 200 },
    );

  const creds = await resolveS3Credentials();
  assert.equal(creds?.accessKeyId, "ASIAECS");
  assert.equal(creds?.sessionToken, "ecs-token");
});
