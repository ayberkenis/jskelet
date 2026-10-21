/**
 * `modulePreload()`: metafile → preload haritası ve `<link rel="modulepreload">`
 * çıktısı (CDN prefix, tekilleştirme, uzantısız eşleşme, build yokken boş).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { loadConfig } from "../src/config/index.js";
import { toPreloadMap } from "../src/build/tasks/client.mjs";
import { modulePreload } from "../src/views/helpers/tags.js";
import { createRequestContext, withRequestContext } from "../src/http/request-context.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-modulepreload-"));

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const metafile = {
  inputs: {},
  outputs: {
    "public/assets/js/main.AAA.js": {
      entryPoint: "client/entries/main.js",
      imports: [
        { path: "public/assets/js/chunks/chunk.SHARED.js", kind: "import-statement" },
        { path: "public/assets/js/chunks/chrome.CCC.js", kind: "dynamic-import" },
      ],
    },
    "public/assets/js/chunks/chrome.CCC.js": {
      entryPoint: "client/bundles/chrome.js",
      imports: [
        { path: "public/assets/js/chunks/chunk.SHARED.js", kind: "import-statement" },
        { path: "public/assets/js/chunks/chunk.UI.js", kind: "import-statement" },
        { path: "public/assets/js/chunks/heavy.HHH.js", kind: "dynamic-import" },
      ],
    },
    "public/assets/js/chunks/search.SSS.ts.js": {
      entryPoint: "client/islands/search.ts",
      imports: [{ path: "public/assets/js/chunks/chunk.UI.js", kind: "import-statement" }],
    },
    "public/assets/js/chunks/chunk.UI.js": {
      imports: [{ path: "public/assets/js/chunks/chunk.SHARED.js", kind: "import-statement" }],
    },
    "public/assets/js/chunks/chunk.SHARED.js": { imports: [] },
    "public/assets/js/chunks/group.GGG.js": { entryPoint: "jskelet-group:vendor", imports: [] },
    "public/assets/js/chunks/chrome.CCC.js.map": { imports: [] },
  },
};

test("preload map follows static imports only", () => {
  const map = toPreloadMap(metafile, root, path.join(root, "public"));

  assert.deepEqual(map["client/bundles/chrome.js"], [
    "/assets/js/chunks/chrome.CCC.js",
    "/assets/js/chunks/chunk.SHARED.js",
    "/assets/js/chunks/chunk.UI.js",
  ]);
  assert.deepEqual(map["client/entries/main.js"], [
    "/assets/js/main.AAA.js",
    "/assets/js/chunks/chunk.SHARED.js",
  ]);
  assert.equal(Object.keys(map).some((key) => key.startsWith("jskelet-group:")), false);
});

test("modulePreload emits CDN-prefixed, de-duplicated links", async () => {
  fs.mkdirSync(path.join(root, ".jskelet"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".jskelet", "preload.json"),
    JSON.stringify(toPreloadMap(metafile, root, path.join(root, "public"))),
  );
  fs.writeFileSync(
    path.join(root, "jskelet.config.mjs"),
    'export default { build: { assets: { prefix: "https://cdn.example.com/js" } } };\n',
  );
  await loadConfig({ root, force: true });

  const cdn = "https://cdn.example.com/js/assets/js";
  const link = (url) => `<link rel="modulepreload" href="${cdn}/${url}">`;

  assert.equal(
    modulePreload("client/bundles/chrome.js"),
    [link("chunks/chrome.CCC.js"), link("chunks/chunk.SHARED.js"), link("chunks/chunk.UI.js")].join(
      "\n    ",
    ),
  );

  // Ortak chunk'lar tek çağrıda bir kez; `.ts` kaynak `.js` diye ve `./` önekiyle istenebilir.
  assert.equal(
    modulePreload({ src: ["./client/bundles/chrome.js", "client/islands/search.js"] }),
    [
      link("chunks/chrome.CCC.js"),
      link("chunks/chunk.SHARED.js"),
      link("chunks/chunk.UI.js"),
      link("chunks/search.SSS.ts.js"),
    ].join("\n    "),
  );

  // Aynı istekteki ikinci çağrı daha önce basılanı tekrarlamaz.
  const context = createRequestContext();
  const [first, second] = withRequestContext(context, () => [
    modulePreload("client/bundles/chrome.js"),
    modulePreload("client/islands/search.ts"),
  ]);
  assert.equal(first.split("\n").length, 3);
  assert.equal(second, link("chunks/search.SSS.ts.js"));

  assert.equal(modulePreload("client/bundles/missing.js"), "");
  assert.equal(modulePreload(""), "");
  assert.equal(modulePreload(undefined), "");
});

test("modulePreload is empty without a client build", async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-modulepreload-bare-"));
  try {
    fs.writeFileSync(path.join(bare, "jskelet.config.mjs"), "export default {};\n");
    await loadConfig({ root: bare, force: true });
    assert.equal(modulePreload("client/bundles/chrome.js"), "");
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});
