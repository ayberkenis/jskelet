import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { initBuildPaths } from "../src/build/paths.mjs";
import { buildCss } from "../src/build/tasks/css.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-css-pages-"));

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writePeer(name, source) {
  const dir = path.join(root, "node_modules", ...name.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, type: "module", exports: "./index.js" }),
  );
  fs.writeFileSync(path.join(dir, "index.js"), source);
}

test("page stylesheets contain global and page CSS in one asset", async () => {
  writePeer(
    "postcss",
    "export default function postcss() { return { async process(css) { return { css }; } }; }\n",
  );
  writePeer("@tailwindcss/postcss", "export default function tailwindcss() { return {}; }\n");

  const styles = path.join(root, "styles", "globals.css");
  const pages = path.join(root, "styles", "pages");
  const generated = path.join(root, ".jskelet");
  const publicDir = path.join(root, "public");
  const assets = path.join(publicDir, "assets");
  fs.mkdirSync(pages, { recursive: true });
  fs.writeFileSync(styles, ".global { color: blue; }\n");
  fs.writeFileSync(path.join(pages, "home.css"), ".home { color: red; }\n");

  const config = {
    root,
    dirs: {
      root,
      generated,
      public: publicDir,
      assets,
      fonts: path.join(publicDir, "fonts"),
      client: path.join(root, "client"),
      views: path.join(root, "views"),
      routes: path.join(root, "routes"),
      styles,
    },
    build: { assets: { prefix: "" } },
    static: { prefixes: ["/assets/", "/fonts/"] },
  };
  initBuildPaths(config);

  const urls = await buildCss(config);
  const app = fs.readFileSync(path.join(publicDir, urls["app.css"]), "utf8");
  const home = fs.readFileSync(path.join(publicDir, urls["home.css"]), "utf8");

  assert.equal(app, ".global { color: blue; }\n");
  assert.equal(home, ".global { color: blue; }\n\n.home { color: red; }\n");
});
