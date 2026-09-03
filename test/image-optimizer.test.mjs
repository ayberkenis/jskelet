import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampWidth,
  isBlockedAddress,
  isHostAllowed,
  srcsetWidths,
} from "../src/server/image-optimizer.js";

test("isHostAllowed matches exact and *.suffix patterns", () => {
  assert.equal(isHostAllowed("cdn.example.com", ["cdn.example.com"]), true);
  assert.equal(isHostAllowed("CDN.Example.COM", ["cdn.example.com"]), true);
  assert.equal(isHostAllowed("img.cdn.example.com", ["*.cdn.example.com"]), true);
  assert.equal(isHostAllowed("cdn.example.com", ["*.cdn.example.com"]), true);
  assert.equal(isHostAllowed("evil.com", ["cdn.example.com"]), false);
  assert.equal(isHostAllowed("notcdn.example.com", ["cdn.example.com"]), false);
});

test("isBlockedAddress rejects loopback and private IPv4", () => {
  assert.equal(isBlockedAddress("localhost"), true);
  assert.equal(isBlockedAddress("127.0.0.1"), true);
  assert.equal(isBlockedAddress("10.0.0.5"), true);
  assert.equal(isBlockedAddress("192.168.1.1"), true);
  assert.equal(isBlockedAddress("172.16.0.1"), true);
  assert.equal(isBlockedAddress("169.254.1.1"), true);
  assert.equal(isBlockedAddress("::1"), true);
  assert.equal(isBlockedAddress("static.investvio.dev"), false);
  assert.equal(isBlockedAddress("8.8.8.8"), false);
});

test("clampWidth respects max and falls back for bad input", () => {
  assert.equal(clampWidth(96, 1920), 96);
  assert.equal(clampWidth(4000, 1920), 1920);
  assert.equal(clampWidth("nope", 1920), 640);
});

test("srcsetWidths includes 1x, 2x and configured breakpoints", () => {
  assert.deepEqual(srcsetWidths(96, [400, 640, 960], 1920), [96, 192, 400, 640, 960]);
  assert.deepEqual(srcsetWidths(800, [400, 640, 960], 1920), [800, 960, 1600]);
});
