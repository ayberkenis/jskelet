/**
 * clientEnv secret-benzeri anahtar koruması.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isSecretLikeClientEnvKey } from "../src/build/tasks/client.mjs";

test("secret-like clientEnv keys are rejected", () => {
  assert.equal(isSecretLikeClientEnvKey("API_KEY"), true);
  assert.equal(isSecretLikeClientEnvKey("JSKELET_SECRET"), true);
  assert.equal(isSecretLikeClientEnvKey("DB_PASSWORD"), true);
  assert.equal(isSecretLikeClientEnvKey("AUTH_TOKEN"), true);
  assert.equal(isSecretLikeClientEnvKey("PRIVATE_KEY"), true);
});

test("public and ordinary keys are allowed", () => {
  assert.equal(isSecretLikeClientEnvKey("PUBLIC_WS_URL"), false);
  assert.equal(isSecretLikeClientEnvKey("STRIPE_PUBLISHABLE_KEY"), false);
  assert.equal(isSecretLikeClientEnvKey("PUBLIC_CDN_ORIGIN"), false);
  assert.equal(isSecretLikeClientEnvKey("SITE_LOCALE"), false);
});
