/**
 * `jskelet migrate` — Next.js App Router → JSkelet codemod.
 *
 *   jskelet migrate              scan + apply --dry-run özeti
 *   jskelet migrate scan [dir]
 *   jskelet migrate apply [dir] [--out .] [--write] [--only pages|components|islands] [--strict] [--json]
 *   jskelet migrate config [dir] [--out .] [--write] [--json]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as log from "./log.mjs";
import { scanProject, formatScanReport } from "./migrate/scan.mjs";
import { draftConfig } from "./migrate/config.mjs";
import { applyMigrate, formatApplyReport } from "./migrate/apply.mjs";
import { commitWrites } from "./migrate/write.mjs";

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<void>}
 */
export async function migrate(cwd, args) {
  const { command, positionals, flags } = parseArgs(args);

  if (command === "help" || flags.help) {
    printUsage();
    return;
  }

  const sourceRoot = path.resolve(cwd, positionals[0] ?? ".");
  const outRoot = path.resolve(cwd, flags.out ?? (command === "apply" || command === "config" ? "." : sourceRoot));

  if (command === "scan" || command === "default") {
    const report = scanProject(sourceRoot);
    if (flags.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      process.stdout.write(formatScanReport(report) + "\n");
    }
    if (command === "default") {
      process.stdout.write("\n--- apply (dry-run) ---\n");
      const { reports } = await applyMigrate(sourceRoot, outRoot, {
        write: false,
        only: flags.only,
      });
      if (flags.json) {
        process.stdout.write(JSON.stringify({ apply: reports }, null, 2) + "\n");
      } else {
        process.stdout.write(formatApplyReport(reports) + "\n");
      }
      exitStrict(reports, flags.strict);
    }
    return;
  }

  if (command === "config") {
    const draft = await draftConfig(sourceRoot);
    if (flags.json) {
      process.stdout.write(JSON.stringify(draft, null, 2) + "\n");
    } else {
      for (const n of draft.notes) log.warn(n);
      if (!flags.write) {
        process.stdout.write(draft.code ?? "");
      }
    }
    if (draft.code) {
      const dest = path.join(outRoot, "jskelet.config.mjs");
      commitWrites([{ path: dest, contents: draft.code, action: "create" }], {
        write: Boolean(flags.write),
        cwd: outRoot,
      });
    }
    if (flags.strict && draft.status !== "ok") process.exitCode = 1;
    return;
  }

  if (command === "apply") {
    if (!fs.existsSync(sourceRoot)) {
      throw new Error(`source not found: ${sourceRoot}`);
    }
    const { reports } = await applyMigrate(sourceRoot, outRoot, {
      write: Boolean(flags.write),
      only: flags.only,
      strict: flags.strict,
    });
    if (flags.json) {
      process.stdout.write(JSON.stringify({ reports }, null, 2) + "\n");
    } else {
      process.stdout.write(formatApplyReport(reports) + "\n");
      if (!flags.write) {
        log.line("dry-run only — pass --write to create files (never overwrites; conflicts get .migrate suffix)");
      }
    }
    exitStrict(reports, flags.strict);
    return;
  }

  throw new Error(`unknown migrate command: ${command}\n\n${usageText()}`);
}

/**
 * @param {string[]} args
 */
function parseArgs(args) {
  /** @type {string[]} */
  const positionals = [];
  /** @type {{ write?: boolean, json?: boolean, strict?: boolean, help?: boolean, out?: string, only?: Set<string> }} */
  const flags = {};
  let command = "default";
  let i = 0;
  if (args[0] && !args[0].startsWith("-")) {
    if (["scan", "apply", "config", "help"].includes(args[0])) {
      command = args[0];
      i = 1;
    }
  }
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === "--write") flags.write = true;
    else if (a === "--dry-run") flags.write = false;
    else if (a === "--json") flags.json = true;
    else if (a === "--strict") flags.strict = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--out") {
      flags.out = args[++i];
    } else if (a.startsWith("--out=")) {
      flags.out = a.slice(6);
    } else if (a === "--only") {
      const raw = args[++i] ?? "";
      flags.only = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
    } else if (a.startsWith("--only=")) {
      flags.only = new Set(a.slice(7).split(",").map((s) => s.trim()).filter(Boolean));
    } else if (a.startsWith("-")) {
      throw new Error(`unknown flag: ${a}`);
    } else {
      positionals.push(a);
    }
  }
  return { command, positionals, flags };
}

/**
 * @param {{ status: string }[]} reports
 * @param {boolean} [strict]
 */
function exitStrict(reports, strict) {
  if (!strict) return;
  if (reports.some((r) => r.status !== "ok")) process.exitCode = 1;
}

function printUsage() {
  process.stdout.write(usageText() + "\n");
}

function usageText() {
  return (
    "usage: jskelet migrate [scan|apply|config] [dir] [options]\n\n" +
    "  scan    Inventory App Router pages, layouts, blockers\n" +
    "  apply   Codemod: JSX pages → controller + .jsk, components, islands\n" +
    "  config  Draft jskelet.config.mjs from next.config\n\n" +
    "Options:\n" +
    "  --out <dir>     Output root (default: cwd)\n" +
    "  --write         Write files (default: dry-run)\n" +
    "  --only <list>   pages,components,islands (comma-separated)\n" +
    "  --json          Machine-readable report\n" +
    "  --strict        Exit 1 if any partial/skipped\n\n" +
    "Requires optional peers (install in the project you migrate):\n" +
    "  npm i -D @babel/parser @babel/types\n"
  );
}
