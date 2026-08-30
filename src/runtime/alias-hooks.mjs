/**
 * Node ESM resolve hook'ları. İki iş yapar:
 *
 * 1. `jsconfig.json` / `tsconfig.json` içindeki `compilerOptions.paths`
 *    alias'larını çözer (`@/lib/x` → `<root>/lib/x`). Editör ve çalışma zamanı
 *    aynı dosyadan beslendiği için ikisi birbirinden ayrışmaz.
 * 2. Uzantısız göreli import'lara uzantı ekler (`./cache` → `./cache.js`).
 *    Node ESM bunu yapmaz; bundler'dan taşınan kodda en sık karşılaşılan
 *    kırılma noktası bu.
 *
 * `node --import jskelet/register` ile kurulur.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = process.cwd();

/** Uzantısız hedefler için denenecek sıra. */
const EXTENSIONS = [".js", ".mjs", ".json", "/index.js", "/index.mjs"];

/**
 * @returns {{ prefix: string, target: string }[]}
 */
function readAliases() {
  for (const name of ["jsconfig.json", "tsconfig.json"]) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;

    try {
      // Yorum içerebilen tsconfig'ler için kaba ama yeterli bir temizlik;
      // tam bir JSON5 ayrıştırıcısı bağımlılık eklemeye değmiyor.
      const raw = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      const config = JSON.parse(raw);
      const baseUrl = path.resolve(ROOT, config.compilerOptions?.baseUrl ?? ".");
      const paths = config.compilerOptions?.paths ?? {};

      /** @type {{ prefix: string, target: string }[]} */
      const aliases = [];

      for (const [pattern, targets] of Object.entries(paths)) {
        const target = Array.isArray(targets) ? targets[0] : targets;
        if (!pattern.endsWith("/*") || typeof target !== "string") continue;

        aliases.push({
          prefix: pattern.slice(0, -1),
          target: path.resolve(baseUrl, target.slice(0, -1)),
        });
      }

      // Uzun önek önce: `@flags/` `@/`den önce denenmeli, yoksa `@/` yakalar.
      return aliases.sort((a, b) => b.prefix.length - a.prefix.length);
    } catch (error) {
      console.warn(`[alias] could not read ${name}, aliases disabled`, error);
      return [];
    }
  }

  return [];
}

const ALIASES = readAliases();

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} filePath
 * @returns {string | null}
 */
function resolveFile(filePath) {
  if (path.extname(filePath) && isFile(filePath)) return filePath;

  for (const suffix of EXTENSIONS) {
    const candidate = `${filePath}${suffix}`;
    if (isFile(candidate)) return candidate;
  }

  return isFile(filePath) ? filePath : null;
}

export async function resolve(specifier, context, nextResolve) {
  for (const { prefix, target } of ALIASES) {
    if (!specifier.startsWith(prefix)) continue;

    const base = path.join(target, specifier.slice(prefix.length));
    const resolved = resolveFile(base);

    return nextResolve(pathToFileURL(resolved ?? base).href, context);
  }

  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !path.extname(specifier) &&
    context.parentURL?.startsWith("file:")
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const base = path.resolve(parentDir, specifier);
    const resolved = resolveFile(base);

    if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
  }

  return nextResolve(specifier, context);
}
