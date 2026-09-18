import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseIconFileName } from "../src/build/tasks/icons.mjs";

describe("parseIconFileName", () => {
  it("maps bare kebab to regular", () => {
    assert.deepEqual(parseIconFileName("house.svg"), {
      name: "house",
      weight: "regular",
    });
    assert.deepEqual(parseIconFileName("arrow-right"), {
      name: "arrow-right",
      weight: "regular",
    });
  });

  it("strips a trailing weight suffix", () => {
    assert.deepEqual(parseIconFileName("house-bold.svg"), {
      name: "house",
      weight: "bold",
    });
    assert.deepEqual(parseIconFileName("arrow-right-fill.svg"), {
      name: "arrow-right",
      weight: "fill",
    });
    assert.deepEqual(parseIconFileName("moon-regular.svg"), {
      name: "moon",
      weight: "regular",
    });
  });

  it("rejects empty or invalid names", () => {
    assert.equal(parseIconFileName(".svg"), null);
    assert.equal(parseIconFileName("-bold.svg"), null);
    assert.equal(parseIconFileName("House.svg"), null);
  });
});
