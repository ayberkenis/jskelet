/**
 * Derlenmiş `.jsk` SSR fixture testleri.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import ejs from "ejs";
import { compileAll } from "../src/compile/index.js";
import { loadConfig } from "../src/config/index.js";
import { renderView, resetRenderEngine } from "../src/server/render.js";
import { esc } from "../src/views/helpers/html.js";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "jsk-app",
);

before(async () => {
  resetRenderEngine();
  const config = await loadConfig({ root: FIXTURE, force: true });
  await compileAll(config);
  resetRenderEngine();
});

describe("jsk SSR", () => {
  it("renderView uses compiled .jsk", async () => {
    const html = await renderView("pages/home", {
      heading: "Hello",
      items: ["a", "b"],
    });
    assert.match(html, /<h1>Hello<\/h1>/);
    assert.match(html, /<li>a<\/li>/);
    assert.match(html, /<li>b<\/li>/);
  });

  it("falls back to EJS for .ejs views", async () => {
    const html = await renderView("pages/legacy", {
      heading: "EJS",
      items: ["x"],
    });
    assert.match(html, /<h1>EJS<\/h1>/);
    assert.match(html, /<li>x<\/li>/);
  });

  it("matches EJS output for equivalent templates (normalized)", async () => {
    const data = { heading: "Hi & bye", items: ["1", "2"] };
    const jsk = await renderView("pages/home", data);
    const ejsHtml = await ejs.render(
      `<section>
  <h1><%= heading %></h1>
  <%- list({ items }) %>
</section>
`,
      {
        ...data,
        list: ({ items }) =>
          "<ul>" + items.map((i) => "<li>" + esc(i) + "</li>").join("") + "</ul>",
      },
      { async: false, rmWhitespace: true },
    );

    const norm = (s) => s.replace(/\s+/g, " ").trim();
    assert.equal(norm(jsk), norm(ejsHtml));
  });
});
