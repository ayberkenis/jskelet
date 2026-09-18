/**
 * Bir kaynak dosyasını page / layout / client / server-component olarak sınıflandırır.
 */
import path from "node:path";
import { t } from "./babel.mjs";
import { parseSource } from "./parse.mjs";

/**
 * @typedef {'page' | 'layout' | 'client' | 'server-component' | 'unknown'} FileKind
 * @typedef {{
 *   kind: FileKind,
 *   isClient: boolean,
 *   hasHooks: boolean,
 *   hasServerAction: boolean,
 *   hasSuspense: boolean,
 *   revalidate: number | null,
 *   hasGenerateMetadata: boolean,
 *   hasGenerateStaticParams: boolean,
 *   reasons: string[],
 * }} Classification
 */

/**
 * @param {string} code
 * @param {string} filename
 * @returns {Classification}
 */
export function classifySource(code, filename) {
  const base = path.basename(filename);
  /** @type {Classification} */
  const out = {
    kind: "unknown",
    isClient: false,
    hasHooks: false,
    hasServerAction: false,
    hasSuspense: false,
    revalidate: null,
    hasGenerateMetadata: false,
    hasGenerateStaticParams: false,
    reasons: [],
  };

  if (/^["']use client["'];?/.test(code.trim()) || /\n["']use client["'];?/.test(code)) {
    out.isClient = true;
  }
  if (code.includes('"use server"') || code.includes("'use server'")) {
    out.hasServerAction = true;
    out.reasons.push("contains \"use server\"");
  }

  let ast;
  try {
    ast = parseSource(code, filename);
  } catch (error) {
    out.reasons.push(
      `parse error: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (out.isClient) out.kind = "client";
    else if (/^page\./.test(base)) out.kind = "page";
    else if (/^layout\./.test(base)) out.kind = "layout";
    return out;
  }

  for (const node of ast.program.directives ?? []) {
    if (node.value?.value === "use client") out.isClient = true;
    if (node.value?.value === "use server") {
      out.hasServerAction = true;
      out.reasons.push("directive \"use server\"");
    }
  }

  for (const node of ast.program.body) {
    if (t.isImportDeclaration(node)) {
      const src = node.source.value;
      if (src === "react" || src === "react/jsx-runtime") {
        for (const spec of node.specifiers) {
          const name =
            (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported)
              ? spec.imported.name
              : null) ||
            (t.isImportDefaultSpecifier(spec) ? "default" : null);
          if (name === "Suspense") out.hasSuspense = true;
          if (
            name &&
            /^(use[A-Z]|useState|useEffect|useMemo|useCallback|useRef|useContext|useReducer|useLayoutEffect|useId|useTransition|useDeferredValue|useSyncExternalStore)/.test(
              name,
            )
          ) {
            out.hasHooks = true;
          }
        }
      }
    }

    if (
      t.isExportNamedDeclaration(node) &&
      node.declaration &&
      t.isVariableDeclaration(node.declaration)
    ) {
      for (const decl of node.declaration.declarations) {
        if (t.isIdentifier(decl.id) && decl.id.name === "revalidate") {
          if (t.isNumericLiteral(decl.init)) out.revalidate = decl.init.value;
          else if (t.isLiteral(decl.init) && typeof decl.init.value === "number") {
            out.revalidate = /** @type {number} */ (decl.init.value);
          }
        }
      }
    }

    if (t.isExportNamedDeclaration(node)) {
      const id = namedExportName(node);
      if (id === "generateMetadata") out.hasGenerateMetadata = true;
      if (id === "generateStaticParams") out.hasGenerateStaticParams = true;
    }
  }

  // Hook çağrıları (import alias olmadan da)
  if (/\buse(State|Effect|Memo|Callback|Ref|Context|Reducer)\s*\(/.test(code)) {
    out.hasHooks = true;
  }

  if (out.isClient || out.hasHooks) {
    out.kind = "client";
  } else if (/^page\./.test(base)) {
    out.kind = "page";
  } else if (/^layout\./.test(base)) {
    out.kind = "layout";
  } else {
    out.kind = "server-component";
  }

  return out;
}

/**
 * @param {import('@babel/types').ExportNamedDeclaration} node
 * @returns {string | null}
 */
function namedExportName(node) {
  if (node.declaration) {
    if (t.isFunctionDeclaration(node.declaration) && node.declaration.id) {
      return node.declaration.id.name;
    }
    if (t.isVariableDeclaration(node.declaration)) {
      const id = node.declaration.declarations[0]?.id;
      if (t.isIdentifier(id)) return id.name;
    }
  }
  for (const spec of node.specifiers) {
    if (t.isExportSpecifier(spec) && t.isIdentifier(spec.exported)) {
      return spec.exported.name;
    }
  }
  return null;
}
