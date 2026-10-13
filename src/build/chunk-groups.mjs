/**
 * esbuild manualChunks karşılığı: `build.client.groups` / `chunkGroup`.
 *
 * esbuild native grup ataması sunmaz. Bir gruba düşen import, re-export
 * sarmalayıcısı üzerinden gider; sarmalayıcı gruba ait barrel'ı side-effect
 * olarak çeker. Barrel tüm bilinen üyeleri statik import eder — gruba
 * dokunan entry'ler aynı üye kümesine ulaşır ve paylaşılan tek chunk oluşur.
 *
 * Bedel: grup içi tree-shaking zayıflar (webpack manualChunks ile aynı
 * takas). `splitting: false` iken plugin hiç eklenmez.
 */
import fs from "node:fs";
import path from "node:path";

const GROUP_NS = "jskelet-group";
const REEXPORT_NS = "jskelet-group-reexport";
const GROUP_PREFIX = `${GROUP_NS}:`;

/** Barrel / re-export sarmalayıcısının kendi import'ları tekrar sarılmasın. */
const SKIP_NS = new Set([GROUP_NS, REEXPORT_NS]);

/**
 * @typedef {object} ChunkGroupOptions
 * @property {string} root
 * @property {Record<string, string[]>} groups
 * @property {((id: string) => string | null | undefined) | null} [chunkGroup]
 */

/**
 * Grup adı dosya yoluna uygun mu (`chunks/<name>.[hash]`).
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isSafeGroupName(name) {
  return typeof name === "string" && /^[A-Za-z0-9_-]+$/.test(name);
}

/**
 * Matcher'ın bare paket, `@/` veya göreli yol öneki olup olmadığını ayırır.
 *
 * @param {string} matcher
 * @returns {"bare" | "path"}
 */
export function matcherKind(matcher) {
  if (matcher.startsWith("./") || matcher.startsWith("../") || matcher.startsWith("@/")) {
    return "path";
  }
  return "bare";
}

/**
 * Yol önekini proje köküne göre mutlak dizin / dosya önekine çevirir.
 *
 * @param {string} root
 * @param {string} matcher
 * @returns {string}
 */
export function resolvePathMatcher(root, matcher) {
  if (matcher.startsWith("@/")) {
    return path.resolve(root, matcher.slice(2));
  }
  return path.resolve(root, matcher);
}

/**
 * Bare paket: exact veya `pkg/...` alt yolu.
 *
 * @param {string} matcher
 * @param {string} importPath
 * @returns {boolean}
 */
export function matchBarePackage(matcher, importPath) {
  return importPath === matcher || importPath.startsWith(`${matcher}/`);
}

/**
 * Mutlak yol, matcher önekiyle başlıyor mu (dizin sınırı korunur).
 *
 * @param {string} absMatcher
 * @param {string} absPath
 * @returns {boolean}
 */
export function matchPathPrefix(absMatcher, absPath) {
  const normalizedMatcher = path.resolve(absMatcher);
  const normalizedPath = path.resolve(absPath);
  if (normalizedPath === normalizedMatcher) return true;
  const prefix = normalizedMatcher.endsWith(path.sep)
    ? normalizedMatcher
    : normalizedMatcher + path.sep;
  return normalizedPath.startsWith(prefix);
}

/**
 * Declarative path matcher altındaki `.{js,ts,mts}` dosyalarını listeler.
 *
 * @param {string} root
 * @param {string} matcher
 * @returns {string[]}
 */
export function listPathMatcherMembers(root, matcher) {
  const base = resolvePathMatcher(root, matcher);
  if (!fs.existsSync(base)) return [];

  const stat = fs.statSync(base);
  if (stat.isFile()) return [base];

  /** @type {string[]} */
  const out = [];
  walkJsFiles(base, out);
  return out;
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
function walkJsFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walkJsFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (ext === ".js" || ext === ".ts" || ext === ".mts" || ext === ".mjs") {
      out.push(full);
    }
  }
}

/**
 * Import yolu / çözümlenmiş dosya için grup adını bulur.
 * `chunkGroup` hook'u `groups` map'inden önce gelir.
 *
 * @param {string} importPath
 * @param {string | null} resolvedPath
 * @param {ChunkGroupOptions} options
 * @returns {string | null}
 */
export function resolveGroupName(importPath, resolvedPath, options) {
  const { root, groups, chunkGroup } = options;

  if (typeof chunkGroup === "function") {
    for (const id of [resolvedPath, importPath].filter(Boolean)) {
      try {
        const result = chunkGroup(/** @type {string} */ (id));
        if (typeof result === "string" && isSafeGroupName(result.trim())) {
          return result.trim();
        }
      } catch (error) {
        console.warn(
          "[build] build.client.chunkGroup() threw, ignoring this module",
          error,
        );
      }
    }
  }

  for (const [name, matchers] of Object.entries(groups)) {
    for (const matcher of matchers) {
      if (matcherKind(matcher) === "bare") {
        if (matchBarePackage(matcher, importPath)) return name;
        continue;
      }
      const absMatcher = resolvePathMatcher(root, matcher);
      if (resolvedPath && matchPathPrefix(absMatcher, resolvedPath)) return name;
      if (
        importPath.startsWith("./") ||
        importPath.startsWith("../") ||
        importPath.startsWith("@/")
      ) {
        // resolveDir bilinmeden göreli yolu kesinleştiremeyiz; @/ yeter.
        if (importPath.startsWith("@/")) {
          const absImport = path.resolve(root, importPath.slice(2));
          if (matchPathPrefix(absMatcher, absImport)) return name;
        }
      }
    }
  }

  return null;
}

/**
 * @param {ChunkGroupOptions} options
 * @returns {import('esbuild').Plugin | null}
 */
export function chunkGroupsPlugin(options) {
  const { root, groups, chunkGroup } = options;
  const hasGroups = Object.keys(groups).length > 0;
  if (!hasGroups && typeof chunkGroup !== "function") return null;

  /** @type {Map<string, Set<string>>} */
  const members = new Map();

  for (const name of Object.keys(groups)) {
    if (!isSafeGroupName(name)) continue;
    members.set(name, new Set());
  }

  // Declarative matcher'lardan bilinen üyeleri önceden doldur.
  for (const [name, matchers] of Object.entries(groups)) {
    if (!isSafeGroupName(name)) continue;
    const set = members.get(name) ?? new Set();
    members.set(name, set);
    for (const matcher of matchers) {
      if (matcherKind(matcher) === "bare") {
        set.add(matcher);
      } else {
        for (const file of listPathMatcherMembers(root, matcher)) {
          set.add(file);
        }
      }
    }
  }

  /**
   * @param {string} group
   * @param {string} member
   */
  function addMember(group, member) {
    if (!isSafeGroupName(group)) return;
    let set = members.get(group);
    if (!set) {
      set = new Set();
      members.set(group, set);
    }
    set.add(member);
  }

  return {
    name: "jskelet-chunk-groups",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.jskeletChunkGroupSkip) return undefined;

        // Re-export sarmalayıcısı ve entry `jskelet-group:name` ister; namespace
        // SKIP olsa bile bu specifier'ı biz çözmeliyiz.
        if (args.path.startsWith(GROUP_PREFIX)) {
          const name = args.path.slice(GROUP_PREFIX.length);
          if (!isSafeGroupName(name)) return undefined;
          if (!members.has(name)) members.set(name, new Set());
          return { path: name, namespace: GROUP_NS };
        }

        // Barrel / re-export içindeki gerçek üye import'ları tekrar sarılmasın.
        if (SKIP_NS.has(args.namespace)) return undefined;

        // data:/http: vb. ve entry-point'leri dokunma.
        if (args.kind === "entry-point") return undefined;
        if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(args.path)) return undefined;

        // Önce hook / bare matcher ile ucuz eşleşme; path önekleri resolve ister.
        let group = resolveGroupName(args.path, null, options);

        const resolved = await build.resolve(args.path, {
          importer: args.importer,
          namespace: args.namespace,
          resolveDir: args.resolveDir,
          kind: args.kind,
          pluginData: { jskeletChunkGroupSkip: true },
        });

        if (resolved.errors?.length || !resolved.path) {
          return undefined;
        }

        // Virtual / zaten bizim namespace.
        if (resolved.namespace && SKIP_NS.has(resolved.namespace)) {
          return undefined;
        }

        group = resolveGroupName(args.path, resolved.path, options) ?? group;
        if (!group) return undefined;

        // Üye olarak çözümlenmiş yolu yaz — barrel aynı dosyayı çeker.
        addMember(group, resolved.path);

        return {
          path: `${group}::${resolved.path}`,
          namespace: REEXPORT_NS,
        };
      });

      build.onLoad({ filter: /.*/, namespace: GROUP_NS }, (args) => {
        const set = members.get(args.path) ?? new Set();
        const lines = [...set].map((member) => `import ${JSON.stringify(member)};`);
        return {
          contents: lines.length ? `${lines.join("\n")}\n` : "export {}\n",
          resolveDir: root,
          loader: "js",
        };
      });

      build.onLoad({ filter: /.*/, namespace: REEXPORT_NS }, (args) => {
        const sep = args.path.indexOf("::");
        if (sep === -1) {
          return { contents: "export {}\n", loader: "js" };
        }
        const group = args.path.slice(0, sep);
        const target = args.path.slice(sep + 2);
        const targetLit = JSON.stringify(target);
        const groupLit = JSON.stringify(`${GROUP_PREFIX}${group}`);

        // Side-effect barrel + re-export. Named-only modüllerde
        // `__ns.default` undefined olur (uyarı → logOverride ile susturulur);
        // `export { default } from` ise hard error verdiği için kullanılmaz.
        return {
          contents: `
import ${groupLit};
import * as __ns from ${targetLit};
export * from ${targetLit};
export default __ns.default;
`,
          resolveDir: root,
          loader: "js",
        };
      });
    },
  };
}

