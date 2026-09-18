/**
 * Codemod apply: pages / components / islands → JSkelet ağacı.
 */
import fs from "node:fs";
import path from "node:path";
import { scanProject } from "./scan.mjs";
import { splitPage } from "./transform/page-split.mjs";
import { transformComponent } from "./transform/jsx-to-component.mjs";
import { transformIsland } from "./transform/island.mjs";
import { jsxToJsk } from "./transform/jsx-to-jsk.mjs";
import { parseSource } from "./parse.mjs";
import { t } from "./babel.mjs";
import { commitWrites } from "./write.mjs";

/**
 * @typedef {{
 *   file: string,
 *   kind: string,
 *   status: 'ok' | 'partial' | 'skipped',
 *   notes: string[],
 *   outputs: string[],
 * }} FileReport
 */

/**
 * @param {string} sourceRoot Next projesi
 * @param {string} outRoot JSkelet hedefi
 * @param {{ write?: boolean, only?: Set<string>, strict?: boolean }} options
 * @returns {Promise<{ reports: FileReport[], writes: object[] }>}
 */
export async function applyMigrate(sourceRoot, outRoot, options = {}) {
  const scan = scanProject(sourceRoot);
  /** @type {FileReport[]} */
  const reports = [];
  /** @type {{ path: string, contents: string }[]} */
  const pending = [];

  const only = options.only ?? null;
  const want = (/** @type {string} */ k) => !only || only.has(k);

  if (want("pages")) {
    for (const page of scan.pages) {
      const code = fs.readFileSync(page.abs, "utf8");
      if (page.classification?.isClient || page.classification?.hasHooks) {
        reports.push({
          file: page.rel,
          kind: "page",
          status: "skipped",
          notes: ["page is a client component — convert to island + server shell manually"],
          outputs: [],
        });
        continue;
      }
      const viewId = `pages/${page.page}`;
      const result = splitPage(code, page.rel, {
        url: page.url,
        feature: page.feature,
        page: page.page,
        viewId,
      });
      /** @type {string[]} */
      const outputs = [];
      if (result.controller) {
        const dest = path.join(outRoot, "features", page.feature, "index.js");
        pending.push({ path: dest, contents: result.controller });
        outputs.push(path.relative(outRoot, dest).replace(/\\/g, "/"));
      }
      if (result.jsk) {
        const dest = path.join(
          outRoot,
          "features",
          page.feature,
          "views",
          "pages",
          `${page.page}.jsk`,
        );
        pending.push({ path: dest, contents: result.jsk });
        outputs.push(path.relative(outRoot, dest).replace(/\\/g, "/"));
      }
      reports.push({
        file: page.rel,
        kind: "page",
        status: result.status,
        notes: result.notes,
        outputs,
      });
    }

    // Root layout only (depth 0)
    const rootLayout = scan.layouts.find((l) => l.depth === 0);
    if (rootLayout) {
      const code = fs.readFileSync(rootLayout.abs, "utf8");
      const layoutResult = transformRootLayout(code, rootLayout.rel);
      if (layoutResult.jsk) {
        const dest = path.join(outRoot, "views", "layout.jsk");
        pending.push({ path: dest, contents: layoutResult.jsk });
        reports.push({
          file: rootLayout.rel,
          kind: "layout",
          status: layoutResult.status,
          notes: layoutResult.notes,
          outputs: ["views/layout.jsk"],
        });
      } else {
        reports.push({
          file: rootLayout.rel,
          kind: "layout",
          status: layoutResult.status,
          notes: layoutResult.notes,
          outputs: [],
        });
      }
    }
  }

  if (want("components")) {
    for (const comp of scan.components) {
      const code = fs.readFileSync(comp.abs, "utf8");
      const result = transformComponent(code, comp.rel);
      /** @type {string[]} */
      const outputs = [];
      if (result.code && result.name) {
        const fileName = camelToKebab(result.name) + ".js";
        const dest = path.join(outRoot, "views", "components", fileName);
        pending.push({ path: dest, contents: result.code });
        outputs.push(path.relative(outRoot, dest).replace(/\\/g, "/"));
      }
      reports.push({
        file: comp.rel,
        kind: "component",
        status: result.status,
        notes: result.notes,
        outputs,
      });
    }
  }

  if (want("islands")) {
    for (const client of scan.clients) {
      const code = fs.readFileSync(client.abs, "utf8");
      const result = transformIsland(code, client.rel);
      /** @type {string[]} */
      const outputs = [];
      if (result.code) {
        const dest = path.join(outRoot, "features", "migrated", "client", `${result.islandName}.js`);
        pending.push({ path: dest, contents: result.code });
        outputs.push(path.relative(outRoot, dest).replace(/\\/g, "/"));
      }
      reports.push({
        file: client.rel,
        kind: "island",
        status: result.status,
        notes: result.notes,
        outputs,
      });
    }
  }

  const writes = commitWrites(
    pending.map((p) => ({ path: p.path, contents: p.contents, action: /** @type {const} */ ("create") })),
    { write: Boolean(options.write), cwd: outRoot },
  );

  return { reports, writes, scan };
}

/**
 * @param {string} code
 * @param {string} filename
 * @returns {{ status: 'ok' | 'partial' | 'skipped', notes: string[], jsk: string | null }}
 */
function transformRootLayout(code, filename) {
  /** @type {string[]} */
  const notes = [];
  try {
    const ast = parseSource(code, filename);
    const pageFn = findDefaultExportJsx(ast);
    if (!pageFn) {
      return {
        status: "skipped",
        notes: ["root layout: no default export JSX (children slot?) — copy framework layout and edit"],
        jsk: null,
      };
    }
    // Replace {children} with {{{ body }}}
    const { source, report } = jsxToJsk(pageFn);
    let jsk = source.replace(/\{\{\s*children\s*\}\}/g, "{{{ body }}}");
    notes.push(...report.notes);
    notes.push("review layout: wire <Stylesheets />, <BodyScripts />, hooks.layoutContext");
    return {
      status: report.status === "ok" ? "partial" : report.status,
      notes,
      jsk: `{# Migrated from ${filename} — prefer jskelet/layout as a starting point #}\n${jsk.trim()}\n`,
    };
  } catch (error) {
    return {
      status: "skipped",
      notes: [error instanceof Error ? error.message : String(error)],
      jsk: null,
    };
  }
}

/**
 * @param {import('@babel/types').File} ast
 * @returns {import('@babel/types').JSXElement | import('@babel/types').JSXFragment | null}
 */
function findDefaultExportJsx(ast) {
  for (const node of ast.program.body) {
    if (!t.isExportDefaultDeclaration(node)) continue;
    const d = node.declaration;
    let body = null;
    if (t.isFunctionDeclaration(d)) body = d.body;
    else if ((t.isArrowFunctionExpression(d) || t.isFunctionExpression(d)) && t.isBlockStatement(d.body)) {
      body = d.body;
    } else if ((t.isArrowFunctionExpression(d) || t.isFunctionExpression(d)) && (t.isJSXElement(d.body) || t.isJSXFragment(d.body))) {
      return d.body;
    }
    if (!body) continue;
    for (const stmt of body.body) {
      if (t.isReturnStatement(stmt) && stmt.argument) {
        let arg = stmt.argument;
        if (t.isParenthesizedExpression(arg)) arg = arg.expression;
        if (t.isJSXElement(arg) || t.isJSXFragment(arg)) return arg;
      }
    }
  }
  return null;
}

/**
 * @param {string} name
 * @returns {string}
 */
function camelToKebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

/**
 * @param {FileReport[]} reports
 * @returns {string}
 */
export function formatApplyReport(reports) {
  const lines = ["Migrate apply report", ""];
  let ok = 0;
  let partial = 0;
  let skipped = 0;
  for (const r of reports) {
    if (r.status === "ok") ok++;
    else if (r.status === "partial") partial++;
    else skipped++;
    const outs = r.outputs.length ? ` → ${r.outputs.join(", ")}` : "";
    lines.push(`[${r.status}] ${r.kind} ${r.file}${outs}`);
    for (const n of r.notes) lines.push(`    - ${n}`);
  }
  lines.push("");
  lines.push(`Summary: ${ok} ok, ${partial} partial, ${skipped} skipped`);
  return lines.join("\n");
}
