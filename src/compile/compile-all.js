/**
 * Tüm `.jsk` dosyalarını derleyip `.jskelet/templates/` altına yazar.
 */
import fs from "node:fs";
import path from "node:path";
import { parseTemplate } from "./parse.js";
import { codegen, normalizeIncludeId } from "./codegen.js";
import { CompileError } from "./errors.js";
import {
  collectKnownComponents,
  componentNameFromViewId,
  discoverJskFiles,
  getComponentDirs,
  getViewRoots,
} from "./resolve.js";

/**
 * @param {{ root: string, dirs: Record<string, string> }} config
 * @param {{ quiet?: boolean }} [options]
 * @returns {Promise<{ count: number, manifest: Record<string, string>, outDir: string }>}
 */
export async function compileAll(config, options = {}) {
  const outDir = path.join(config.dirs.generated, "templates");
  const viewRoots = getViewRoots(config);
  const jskFiles = discoverJskFiles(viewRoots);
  const componentDirs = getComponentDirs(config);
  const knownComponents = collectKnownComponents(componentDirs, jskFiles);

  // Önceki çıktıyı temizle — silinmiş şablonlar kalmasın.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  /** @type {Record<string, string>} */
  const manifest = {};
  /** @type {Map<string, { code: string, includes: string[] }>} */
  const compiled = new Map();

  for (const [viewId, file] of jskFiles) {
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(config.root, file).split(path.sep).join("/");

    let ast;
    try {
      ast = parseTemplate(source, { file: relative });
    } catch (error) {
      if (error instanceof CompileError) throw error;
      throw error;
    }

    const { code, includes, components: usedComponents } = codegen(ast, {
      viewId,
      file: relative,
      knownComponents: null,
    });

    for (const name of usedComponents) {
      if (knownComponents.has(name)) continue;
      const camel = name.charAt(0).toLowerCase() + name.slice(1);
      if (knownComponents.has(camel)) continue;
      if (!options.quiet) {
        console.warn(`[jsk] ${relative}: component "${name}" was not found at compile time`);
      }
    }

    compiled.set(viewId, { code, includes });
  }

  // Include hedefleri mevcut mu?
  for (const [viewId, { includes }] of compiled) {
    for (const id of includes) {
      const normalized = normalizeIncludeId(id);
      if (!compiled.has(normalized) && !jskFiles.has(normalized)) {
        const file = jskFiles.get(viewId);
        const relative = file
          ? path.relative(config.root, file).split(path.sep).join("/")
          : viewId;
        throw new CompileError(`Unknown include "${id}"`, { file: relative });
      }
    }
  }

  for (const [viewId, { code }] of compiled) {
    const outFile = path.join(outDir, `${viewId}.mjs`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, code, "utf8");
    manifest[viewId] = `${viewId}.mjs`.split(path.sep).join("/");
  }

  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // Bileşen adı → view id haritası (runtime kayıt için)
  /** @type {Record<string, string>} */
  const components = {};
  for (const viewId of Object.keys(manifest)) {
    const name = componentNameFromViewId(viewId);
    if (name) components[name] = viewId;
  }
  fs.writeFileSync(
    path.join(outDir, "components.json"),
    `${JSON.stringify(components, null, 2)}\n`,
    "utf8",
  );

  return { count: compiled.size, manifest, outDir };
}

/**
 * Manifest yoksa veya herhangi bir `.jsk` daha yeniyse yeniden derler.
 * Dev sunucu restart'ında build watch kaçırmış olsa bile şablonlar güncel kalır.
 *
 * @param {{ root: string, dirs: Record<string, string> }} config
 * @returns {Promise<{ count: number, rebuilt: boolean }>}
 */
export async function ensureTemplatesCompiled(config) {
  const viewRoots = getViewRoots(config);
  const jskFiles = discoverJskFiles(viewRoots);
  if (jskFiles.size === 0) {
    return { count: 0, rebuilt: false };
  }

  const outDir = path.join(config.dirs.generated, "templates");
  const manifestPath = path.join(outDir, "manifest.json");
  let needs = !fs.existsSync(manifestPath);

  if (!needs) {
    const manifestMtime = fs.statSync(manifestPath).mtimeMs;
    for (const file of jskFiles.values()) {
      if (fs.statSync(file).mtimeMs > manifestMtime) {
        needs = true;
        break;
      }
    }
  }

  if (!needs) {
    return { count: jskFiles.size, rebuilt: false };
  }

  const result = await compileAll(config, { quiet: true });
  return { count: result.count, rebuilt: true };
}

/**
 * Tek kaynak dizgisini derler (birim testleri).
 * @param {string} source
 * @param {{ viewId?: string, file?: string, knownComponents?: Set<string> }} [options]
 * @returns {{ code: string, includes: string[], components: string[] }}
 */
export function compileSource(source, options = {}) {
  const viewId = options.viewId ?? "test";
  const ast = parseTemplate(source, { file: options.file ?? "test.jsk" });
  return codegen(ast, {
    viewId,
    file: options.file ?? "test.jsk",
    knownComponents: options.knownComponents ?? null,
  });
}
