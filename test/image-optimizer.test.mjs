import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertResolvedHostSafe,
  clampWidth,
  isBlockedAddress,
  isHostAllowed,
  isRemoteUrlShapeAllowed,
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

test("isRemoteUrlShapeAllowed rejects private redirect targets", () => {
  const allow = ["cdn.example.com"];
  assert.equal(
    isRemoteUrlShapeAllowed(new URL("https://cdn.example.com/a.jpg"), allow),
    true,
  );
  assert.equal(
    isRemoteUrlShapeAllowed(new URL("http://169.254.169.254/latest"), allow),
    false,
  );
  assert.equal(
    isRemoteUrlShapeAllowed(new URL("http://127.0.0.1/x"), allow),
    false,
  );
  assert.equal(
    isRemoteUrlShapeAllowed(new URL("https://evil.com/x"), allow),
    false,
  );
});

test("assertResolvedHostSafe rejects literal private hosts", async () => {
  assert.equal(await assertResolvedHostSafe("127.0.0.1"), false);
  assert.equal(await assertResolvedHostSafe("169.254.169.254"), false);
  assert.equal(await assertResolvedHostSafe("8.8.8.8"), true);
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
