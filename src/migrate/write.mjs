/**
 * Dry-run / no-overwrite yazıcı.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as log from "../log.mjs";

/**
 * @typedef {{ path: string, contents: string, action: 'create' | 'skip' | 'conflict' }} WritePlan
 */

/**
 * @param {string} absPath
 * @param {string} contents
 * @param {{ write?: boolean, cwd?: string }} options
 * @returns {WritePlan}
 */
export function planWrite(absPath, contents, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const rel = path.relative(cwd, absPath).replace(/\\/g, "/");
  if (fs.existsSync(absPath)) {
    return { path: rel, contents, action: "conflict" };
  }
  return { path: rel, contents, action: options.write ? "create" : "create" };
}

/**
 * @param {WritePlan[]} plans
 * @param {{ write?: boolean, cwd?: string }} options
 * @returns {WritePlan[]}
 */
export function commitWrites(plans, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  /** @type {WritePlan[]} */
  const out = [];
  for (const plan of plans) {
    const abs = path.isAbsolute(plan.path) ? plan.path : path.join(cwd, plan.path);
    if (fs.existsSync(abs)) {
      const conflict = {
        path: path.relative(cwd, abs).replace(/\\/g, "/"),
        contents: plan.contents,
        action: /** @type {const} */ ("conflict"),
      };
      // .migrate soneki dene
      const alt = abs.replace(/(\.\w+)?$/, (m) => `.migrate${m || ""}`);
      if (!fs.existsSync(alt) && options.write) {
        fs.mkdirSync(path.dirname(alt), { recursive: true });
        fs.writeFileSync(alt, plan.contents, "utf8");
        log.line(`create ${path.relative(cwd, alt).replace(/\\/g, "/")} (conflict → .migrate)`);
        out.push({
          path: path.relative(cwd, alt).replace(/\\/g, "/"),
          contents: plan.contents,
          action: "create",
        });
        continue;
      }
      log.line(`skip ${conflict.path} (exists)`);
      out.push(conflict);
      continue;
    }
    if (options.write) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, plan.contents, "utf8");
      log.line(`create ${path.relative(cwd, abs).replace(/\\/g, "/")}`);
      out.push({
        path: path.relative(cwd, abs).replace(/\\/g, "/"),
        contents: plan.contents,
        action: "create",
      });
    } else {
      log.line(`would create ${path.relative(cwd, abs).replace(/\\/g, "/")}`);
      out.push({
        path: path.relative(cwd, abs).replace(/\\/g, "/"),
        contents: plan.contents,
        action: "create",
      });
    }
  }
  return out;
}
