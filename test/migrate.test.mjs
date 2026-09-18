import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseSource } from "../src/migrate/parse.mjs";
import { classifySource } from "../src/migrate/classify.mjs";
import { jsxToJsk } from "../src/migrate/transform/jsx-to-jsk.mjs";
import { transformComponent } from "../src/migrate/transform/jsx-to-component.mjs";
import { splitPage } from "../src/migrate/transform/page-split.mjs";
import { transformIsland } from "../src/migrate/transform/island.mjs";
import { scanProject } from "../src/migrate/scan.mjs";
import { draftConfig } from "../src/migrate/config.mjs";
import { applyMigrate } from "../src/migrate/apply.mjs";
import { segmentToExpressPath } from "../src/migrate/fs-walk.mjs";
import * as t from "@babel/types";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "next-app",
);

describe("migrate fs-walk", () => {
  it("maps App Router segments to Express paths", () => {
    assert.equal(segmentToExpressPath(""), "/");
    assert.equal(segmentToExpressPath("news/[slug]"), "/news/:slug");
    assert.equal(segmentToExpressPath("docs/[...slug]"), "/docs/:slug*");
    assert.equal(segmentToExpressPath("(marketing)/about"), "/about");
  });
});

describe("migrate classify", () => {
  it("detects page metadata and revalidate", () => {
    const code = fs.readFileSync(
      path.join(FIXTURE, "app", "news", "[slug]", "page.jsx"),
      "utf8",
    );
    const c = classifySource(code, "app/news/[slug]/page.jsx");
    assert.equal(c.kind, "page");
    assert.equal(c.revalidate, 300);
    assert.equal(c.hasGenerateMetadata, true);
  });

  it("detects client hooks", () => {
    const code = fs.readFileSync(path.join(FIXTURE, "components", "counter.jsx"), "utf8");
    const c = classifySource(code, "components/counter.jsx");
    assert.equal(c.kind, "client");
    assert.equal(c.hasHooks, true);
  });
});

describe("migrate jsx-to-jsk", () => {
  it("converts className, interpolation, Image, dangerouslySetInnerHTML", () => {
    const code = `
      const el = (
        <article className="wrapper">
          <h1>{article.title}</h1>
          <Image src={article.cover} alt={article.title} priority />
          <div dangerouslySetInnerHTML={{ __html: article.body }} />
        </article>
      );
    `;
    const ast = parseSource(code, "x.jsx");
    const decl = ast.program.body[0];
    assert.ok(t.isVariableDeclaration(decl));
    const jsx = decl.declarations[0].init;
    const { source, report } = jsxToJsk(jsx);
    assert.match(source, /class="wrapper"/);
    assert.match(source, /\{\{\s*article\.title\s*\}\}/);
    assert.match(source, /<Image/);
    assert.match(source, /\{\{\{\s*article\.body\s*\}\}\}/);
    assert.equal(report.status, "ok");
  });

  it("converts map and conditional", () => {
    const code = `
      const el = (
        <ul>
          {items.map((item, i) => <li data-i={i}>{item}</li>)}
          {open && <span>Hi</span>}
        </ul>
      );
    `;
    const ast = parseSource(code, "x.jsx");
    const jsx = ast.program.body[0].declarations[0].init;
    const { source } = jsxToJsk(jsx);
    assert.match(source, /\{#each items as item, i\}/);
    assert.match(source, /\{#if open\}/);
  });
});

describe("migrate jsx-to-component", () => {
  it("ports Badge to esc/attrs HTML string", () => {
    const code = fs.readFileSync(path.join(FIXTURE, "components", "badge.jsx"), "utf8");
    const result = transformComponent(code, "components/badge.jsx");
    assert.ok(result.code);
    assert.match(result.code, /export function badge/);
    assert.match(result.code, /esc\(label\)/);
    assert.match(result.code, /class: className/);
    assert.match(result.code, /TONES/);
  });
});

describe("migrate page-split", () => {
  it("splits news slug page into controller + jsk", () => {
    const code = fs.readFileSync(
      path.join(FIXTURE, "app", "news", "[slug]", "page.jsx"),
      "utf8",
    );
    const result = splitPage(code, "app/news/[slug]/page.jsx", {
      url: "/news/:slug",
      feature: "news",
      page: "news",
      viewId: "pages/news",
    });
    assert.ok(result.controller);
    assert.ok(result.jsk);
    assert.match(result.controller, /revalidate: 300/);
    assert.match(result.controller, /getArticle/);
    assert.match(result.controller, /view: "pages\/news"/);
    assert.match(result.jsk, /article\.title/);
    assert.match(result.jsk, /\{\{\{\s*article\.body\s*\}\}\}/);
  });
});

describe("migrate island", () => {
  it("emits mount stub with TODO for hooks", () => {
    const code = fs.readFileSync(path.join(FIXTURE, "components", "counter.jsx"), "utf8");
    const result = transformIsland(code, "components/counter.jsx");
    assert.equal(result.status, "partial");
    assert.match(result.code, /export function mount/);
    assert.match(result.code, /TODO\[jskelet-migrate\]/);
  });
});

describe("migrate scan + config + apply", () => {
  it("scans fixture inventory and blockers", () => {
    const report = scanProject(FIXTURE);
    assert.ok(report.pages.length >= 2);
    assert.ok(report.blockers.some((b) => b.kind === "nested-layouts"));
    assert.ok(report.clientEnv.includes("API_URL"));
    const news = report.pages.find((p) => p.url === "/news/:slug");
    assert.ok(news);
  });

  it("drafts jskelet.config from next.config", async () => {
    const draft = await draftConfig(FIXTURE);
    assert.ok(draft.code);
    assert.match(draft.code, /clientEnv/);
    assert.match(draft.code, /API_URL/);
    assert.match(draft.code, /widths/);
    assert.match(draft.code, /redirects/);
  });

  it("apply dry-run produces outputs without writing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-migrate-"));
    try {
      const { reports } = await applyMigrate(FIXTURE, tmp, { write: false });
      assert.ok(reports.some((r) => r.kind === "page" && r.outputs.length));
      assert.ok(reports.some((r) => r.kind === "component"));
      assert.ok(reports.some((r) => r.kind === "island"));
      assert.equal(fs.readdirSync(tmp).length, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("apply --write creates feature files", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-migrate-w-"));
    try {
      const { reports } = await applyMigrate(FIXTURE, tmp, {
        write: true,
        only: new Set(["pages"]),
      });
      const news = reports.find((r) => r.file.includes("news") && r.kind === "page");
      assert.ok(news);
      assert.ok(news.outputs.some((o) => o.endsWith(".jsk")));
      const jskPath = path.join(tmp, news.outputs.find((o) => o.endsWith(".jsk")));
      assert.ok(fs.existsSync(jskPath));
      const body = fs.readFileSync(jskPath, "utf8");
      assert.match(body, /article\.title/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
