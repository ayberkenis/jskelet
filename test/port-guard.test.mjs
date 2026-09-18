import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseLsofPids,
  parseSsPids,
  parseWindowsNetstat,
} from "../src/server/port-guard.js";

describe("parseWindowsNetstat", () => {
  it("collects LISTENING pids for the exact port", () => {
    const stdout = [
      "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1111",
      "  TCP    [::]:3000              [::]:0                 LISTENING       1111",
      "  TCP    127.0.0.1:30001         0.0.0.0:0              LISTENING       2222",
      "  TCP    127.0.0.1:3000          127.0.0.1:51234        ESTABLISHED     3333",
      "",
    ].join("\r\n");

    assert.deepEqual(parseWindowsNetstat(stdout, 3000), [1111, 1111]);
    assert.deepEqual(parseWindowsNetstat(stdout, 30001), [2222]);
  });
});

describe("parseLsofPids", () => {
  it("reads one pid per line", () => {
    assert.deepEqual(parseLsofPids("4242\n"), [4242]);
    assert.deepEqual(parseLsofPids("10\n20\n\n"), [10, 20]);
  });
});

describe("parseSsPids", () => {
  it("extracts pid= values", () => {
    const stdout =
      'LISTEN 0 511 *:3000 users:(("node",pid=4242,fd=23))\n';
    assert.deepEqual(parseSsPids(stdout), [4242]);
  });
});
