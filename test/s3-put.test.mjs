/**
 * SigV4 PutObject imza birim testleri — ağ yok.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCanonicalRequest,
  buildSignedPutObject,
  buildStringToSign,
  deriveSigningKey,
  encodeS3Path,
  formatAmzDates,
  sha256Hex,
} from "../src/server/logs/s3-put.js";

test("formatAmzDates and sha256Hex are stable", () => {
  const { amzDate, dateStamp } = formatAmzDates(
    new Date("2013-05-24T00:00:00.000Z"),
  );
  assert.equal(amzDate, "20130524T000000Z");
  assert.equal(dateStamp, "20130524");
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("encodeS3Path keeps slashes and encodes spaces", () => {
  assert.equal(encodeS3Path("a/b c/d"), "a/b%20c/d");
});

test("deriveSigningKey matches AWS example shape (hex length)", () => {
  const key = deriveSigningKey("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "20130524", "us-east-1", "s3");
  assert.equal(key.length, 32);
});

test("buildCanonicalRequest orders headers", () => {
  const { canonicalRequest, signedHeaders } = buildCanonicalRequest({
    method: "PUT",
    canonicalUri: "/key",
    headers: {
      host: "bucket.s3.us-east-1.amazonaws.com",
      "x-amz-date": "20130524T000000Z",
      "x-amz-content-sha256": "abc",
    },
    payloadHash: "abc",
  });

  assert.equal(signedHeaders, "host;x-amz-content-sha256;x-amz-date");
  assert.match(canonicalRequest, /^PUT\n\/key\n\n/);
  assert.match(canonicalRequest, /host:bucket\.s3\.us-east-1\.amazonaws\.com\n/);
});

test("buildSignedPutObject produces Authorization and deterministic URL", () => {
  const signed = buildSignedPutObject({
    bucket: "examplebucket",
    key: "jskelet/logs/2026/09/02/test.ndjson",
    body: '{"kind":"http"}\n',
    region: "us-east-1",
    credentials: {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
    now: new Date("2013-05-24T00:00:00.000Z"),
  });

  assert.equal(
    signed.url,
    "https://examplebucket.s3.us-east-1.amazonaws.com/jskelet/logs/2026/09/02/test.ndjson",
  );
  assert.match(signed.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request,/);
  assert.match(signed.headers.authorization, /SignedHeaders=/);
  assert.match(signed.headers.authorization, /Signature=[a-f0-9]{64}$/);
  assert.equal(signed.headers["x-amz-date"], "20130524T000000Z");
  assert.equal(signed.headers["x-amz-content-sha256"], sha256Hex(signed.body));
});

test("buildSignedPutObject path-style with custom endpoint", () => {
  const signed = buildSignedPutObject({
    bucket: "local",
    key: "a/b.ndjson",
    body: "x",
    region: "us-east-1",
    endpoint: "http://127.0.0.1:9000",
    credentials: {
      accessKeyId: "minio",
      secretAccessKey: "minio123",
    },
    now: new Date("2020-01-01T00:00:00.000Z"),
  });

  assert.equal(signed.url, "http://127.0.0.1:9000/local/a/b.ndjson");
  assert.equal(signed.headers.host, "127.0.0.1:9000");
});

test("buildStringToSign wraps hashed canonical request", () => {
  const text = buildStringToSign({
    amzDate: "20130524T000000Z",
    dateStamp: "20130524",
    region: "us-east-1",
    service: "s3",
    canonicalRequest: "PUT\n/\n\nhost:x\n\nhost\nabc",
  });
  assert.match(text, /^AWS4-HMAC-SHA256\n20130524T000000Z\n20130524\/us-east-1\/s3\/aws4_request\n/);
});
