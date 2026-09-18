/**
 * Next App Router envanteri + engel listesi.
 */
import fs from "node:fs";
import path from "node:path";
import {
  findAppDir,
  findNextConfig,
  inventoryApp,
  findClientEnvKeys,
  walkFiles,
} from "./fs-walk.mjs";
import { ensureBabel } from "./babel.mjs";
import { classifySource } from "./classify.mjs";

/**
 * @param {string} root
 * @returns {object}
 */
export function scanProject(root) {
  // Babel yoksa yüzlerce "parse error" yerine tek net kurulum mesajı.
  ensureBabel(root);

  const appDir = findAppDir(root);
  const nextConfig = findNextConfig(root);
  const clientEnv = findClientEnvKeys(root);

  if (!appDir) {
    return {
      root,
      appDir: null,
      nextConfig,
      clientEnv,
      pages: [],
      layouts: [],
      clients: [],
      components: [],
      blockers: [
        {
          kind: "no-app-dir",
          message: "No app/ or src/app/ directory found (App Router required).",
        },
      ],
      pagesRouter: fs.existsSync(path.join(root, "pages")),
    };
  }

  const inv = inventoryApp(appDir);
  /** @type {object[]} */
  const pages = [];
  /** @type {object[]} */
  const clients = [];
  /** @type {object[]} */
  const components = [];
  /** @type {object[]} */
  const blockers = [];

  if (fs.existsSync(path.join(root, "pages"))) {
    blockers.push({
      kind: "pages-router",
      message: "pages/ directory present — Pages Router is out of scope for this codemod.",
    });
  }

  const nestedLayouts = inv.layouts.filter((l) => l.depth > 0);
  if (nestedLayouts.length) {
    blockers.push({
      kind: "nested-layouts",
      message: `${nestedLayouts.length} nested layout(s); JSkelet has a single layout — flatten manually.`,
      files: nestedLayouts.map((l) => l.rel),
    });
  }

  for (const page of inv.pages) {
    const code = fs.readFileSync(page.abs, "utf8");
    const classification = classifySource(code, page.rel);
    pages.push({ ...page, classification });
    if (classification.hasServerAction) {
      blockers.push({
        kind: "server-action",
        file: page.rel,
        message: "Server Actions have no equivalent — use app.post handlers.",
      });
    }
    if (classification.hasSuspense) {
      blockers.push({
        kind: "suspense",
        file: page.rel,
        message: "Suspense / streaming is not supported — use fragment endpoints.",
      });
    }
  }

  for (const layout of inv.layouts) {
    const code = fs.readFileSync(layout.abs, "utf8");
    layout.classification = classifySource(code, layout.rel);
  }

  for (const src of inv.sources) {
    const code = fs.readFileSync(src.abs, "utf8");
    const classification = classifySource(code, src.rel);
    if (classification.kind === "client" || classification.isClient) {
      clients.push({ ...src, classification });
    } else if (classification.kind === "server-component") {
      components.push({ ...src, classification });
    }
  }

  for (const dir of ["components", "src/components", "lib/components"]) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    walkFiles(abs, (_rel, fileAbs) => {
      if (!/\.(jsx?|tsx?)$/.test(fileAbs)) return;
      const fromRoot = path.relative(root, fileAbs).replace(/\\/g, "/");
      const code = fs.readFileSync(fileAbs, "utf8");
      const classification = classifySource(code, fromRoot);
      if (classification.kind === "client" || classification.isClient) {
        clients.push({ abs: fileAbs, rel: fromRoot, classification });
      } else if (classification.kind === "server-component") {
        components.push({ abs: fileAbs, rel: fromRoot, classification });
      }
    });
  }

  return {
    root,
    appDir: path.relative(root, appDir).replace(/\\/g, "/"),
    nextConfig: nextConfig ? path.relative(root, nextConfig).replace(/\\/g, "/") : null,
    clientEnv,
    pages,
    layouts: inv.layouts,
    clients,
    components,
    blockers,
    pagesRouter: fs.existsSync(path.join(root, "pages")),
  };
}

/**
 * İnsan-okur özet.
 * @param {ReturnType<typeof scanProject>} report
 * @returns {string}
 */
export function formatScanReport(report) {
  const lines = [];
  lines.push(`Next.js → JSkelet scan`);
  lines.push(`  app: ${report.appDir ?? "(missing)"}`);
  lines.push(`  config: ${report.nextConfig ?? "(none)"}`);
  lines.push(`  pages: ${report.pages.length}`);
  lines.push(`  layouts: ${report.layouts.length}`);
  lines.push(`  client modules: ${report.clients.length}`);
  lines.push(`  server components: ${report.components.length}`);
  if (report.clientEnv.length) {
    lines.push(`  NEXT_PUBLIC_* → clientEnv candidates: ${report.clientEnv.join(", ")}`);
  }
  if (report.pages.length) {
    lines.push("");
    lines.push("Pages:");
    for (const p of report.pages) {
      const flags = [];
      if (p.classification?.revalidate != null) flags.push(`revalidate=${p.classification.revalidate}`);
      if (p.classification?.hasGenerateMetadata) flags.push("metadata");
      if (p.classification?.hasGenerateStaticParams) flags.push("staticParams");
      lines.push(`  ${p.url}  ←  ${p.rel}${flags.length ? `  (${flags.join(", ")})` : ""}`);
    }
  }
  if (report.blockers.length) {
    lines.push("");
    lines.push("Blockers:");
    for (const b of report.blockers) {
      lines.push(`  ⚠ ${b.message}${b.file ? ` [${b.file}]` : ""}`);
    }
  }
  lines.push("");
  lines.push("Next: jskelet migrate apply [--write]  |  jskelet migrate config [--write]");
  return lines.join("\n");
}
