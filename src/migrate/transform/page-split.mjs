/**
 * Next `page.*` → controller + `.jsk` gövde.
 */
import { t } from "../babel.mjs";
import { parseSource } from "../parse.mjs";
import { jsxToJsk } from "./jsx-to-jsk.mjs";
import { exprToSource } from "./expr-source.mjs";

/**
 * @typedef {{
 *   status: 'ok' | 'partial' | 'skipped',
 *   notes: string[],
 *   controller: string | null,
 *   jsk: string | null,
 *   viewId: string,
 *   dataKeys: string[],
 * }} PageSplitResult
 */

/**
 * @param {string} code
 * @param {string} filename
 * @param {{ url: string, feature: string, page: string, viewId?: string }} meta
 * @returns {PageSplitResult}
 */
export function splitPage(code, filename, meta) {
  const viewId = meta.viewId ?? `pages/${meta.page}`;
  /** @type {PageSplitResult} */
  const result = {
    status: "ok",
    notes: [],
    controller: null,
    jsk: null,
    viewId,
    dataKeys: [],
  };

  let ast;
  try {
    ast = parseSource(code, filename);
  } catch (error) {
    result.status = "skipped";
    result.notes.push(error instanceof Error ? error.message : String(error));
    return result;
  }

  const revalidate = readRevalidate(ast);
  const pageFn = findDefaultPage(ast);
  if (!pageFn) {
    result.status = "skipped";
    result.notes.push("no default export page function found");
    return result;
  }

  const jsx = findReturnJsx(pageFn.body);
  if (!jsx) {
    result.status = "skipped";
    result.notes.push("page does not return JSX");
    return result;
  }

  // Import map: Image from next/image, Link from next/link → keep tag names
  const { source: jsk, report } = jsxToJsk(jsx);
  result.jsk = `{# Migrated from ${filename.replace(/\\/g, "/")} #}\n${jsk.trim()}\n`;
  result.notes.push(...report.notes);
  if (report.status === "partial") result.status = "partial";
  if (report.status === "skipped") result.status = "skipped";

  const locals = extractControllerLocals(pageFn.body);
  const dataKeys = [...new Set([...locals.dataKeys, ...report.bindings])].filter(
    (k) => !["params", "searchParams", "props", "query"].includes(k),
  );
  result.dataKeys = dataKeys;

  const metadataExpr = trySimpleMetadata(ast);
  const imports = collectDataImports(ast);

  const usesNotFound = code.includes("notFound(");
  const usesRedirect = /\bredirect\s*\(/.test(code);
  const jskeletImports = [];
  if (usesNotFound) jskeletImports.push("notFound");
  if (usesRedirect) jskeletImports.push("redirect");

  /** @type {string[]} */
  const controllerLines = [];
  controllerLines.push(`/** Migrated from ${filename.replace(/\\/g, "/")} */`);
  for (const line of imports) controllerLines.push(line);
  if (jskeletImports.length) {
    controllerLines.push(`import { ${jskeletImports.join(", ")} } from "jskelet";`);
  }
  controllerLines.push("");
  controllerLines.push("export default function register(app, { route }) {");
  const routeOpts = revalidate != null ? `, { revalidate: ${revalidate} }` : "";
  controllerLines.push(`  app.get(`);
  controllerLines.push(`    ${JSON.stringify(meta.url)},`);
  controllerLines.push(`    route(`);
  controllerLines.push(`      async ({ params, query }) => {`);
  for (const stmt of locals.prelude) {
    controllerLines.push(`        ${stmt}`);
  }
  const dataObj = dataKeys.length > 0 ? `{ ${dataKeys.join(", ")} }` : "{}";
  controllerLines.push(`        return {`);
  controllerLines.push(`          view: ${JSON.stringify(viewId)},`);
  controllerLines.push(`          data: ${dataObj},`);
  if (metadataExpr) {
    controllerLines.push(`          metadata: ${metadataExpr},`);
  } else if (code.includes("generateMetadata")) {
    controllerLines.push(
      `          // TODO[jskelet-migrate]: port generateMetadata() into metadata`,
    );
    if (result.status !== "skipped") result.status = "partial";
    result.notes.push("generateMetadata needs manual port");
  }
  controllerLines.push(`        };`);
  controllerLines.push(`      }${routeOpts},`);
  controllerLines.push(`    ),`);
  controllerLines.push(`  );`);
  controllerLines.push(`}`);
  controllerLines.push("");

  result.controller = controllerLines.join("\n");
  if (result.notes.length && result.status === "ok") result.status = "partial";
  return result;
}

/**
 * @param {import('@babel/types').File} ast
 * @returns {number | null}
 */
function readRevalidate(ast) {
  for (const node of ast.program.body) {
    if (
      t.isExportNamedDeclaration(node) &&
      node.declaration &&
      t.isVariableDeclaration(node.declaration)
    ) {
      for (const d of node.declaration.declarations) {
        if (t.isIdentifier(d.id) && d.id.name === "revalidate" && t.isNumericLiteral(d.init)) {
          return d.init.value;
        }
      }
    }
  }
  return null;
}

/**
 * @param {import('@babel/types').File} ast
 * @returns {{ body: import('@babel/types').BlockStatement, params: import('@babel/types').FunctionDeclaration['params'] } | null}
 */
function findDefaultPage(ast) {
  for (const node of ast.program.body) {
    if (t.isExportDefaultDeclaration(node)) {
      const d = node.declaration;
      if (t.isFunctionDeclaration(d) && d.body) {
        return { body: d.body, params: d.params };
      }
      if (t.isArrowFunctionExpression(d) || t.isFunctionExpression(d)) {
        if (t.isBlockStatement(d.body)) return { body: d.body, params: d.params };
      }
      if (t.isIdentifier(d)) {
        // export default Page — find function Page
        const name = d.name;
        for (const other of ast.program.body) {
          if (t.isFunctionDeclaration(other) && other.id?.name === name && other.body) {
            return { body: other.body, params: other.params };
          }
          if (t.isVariableDeclaration(other)) {
            for (const decl of other.declarations) {
              if (t.isIdentifier(decl.id) && decl.id.name === name && decl.init) {
                if (
                  (t.isArrowFunctionExpression(decl.init) || t.isFunctionExpression(decl.init)) &&
                  t.isBlockStatement(decl.init.body)
                ) {
                  return { body: decl.init.body, params: decl.init.params };
                }
              }
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * @param {import('@babel/types').BlockStatement} body
 * @returns {import('@babel/types').JSXElement | import('@babel/types').JSXFragment | null}
 */
function findReturnJsx(body) {
  for (const stmt of body.body) {
    if (!t.isReturnStatement(stmt) || !stmt.argument) continue;
    let arg = stmt.argument;
    if (t.isParenthesizedExpression(arg)) arg = arg.expression;
    if (t.isJSXElement(arg) || t.isJSXFragment(arg)) return arg;
  }
  return null;
}

/**
 * Return JSX'ten önceki await/const satırlarını controller'a kopyala.
 *
 * @param {import('@babel/types').BlockStatement} body
 * @returns {{ prelude: string[], dataKeys: string[] }}
 */
function extractControllerLocals(body) {
  /** @type {string[]} */
  const prelude = [];
  /** @type {string[]} */
  const dataKeys = [];

  for (const stmt of body.body) {
    if (t.isReturnStatement(stmt)) break;

    if (t.isVariableDeclaration(stmt)) {
      for (const d of stmt.declarations) {
        if (t.isIdentifier(d.id)) dataKeys.push(d.id.name);
        else if (t.isObjectPattern(d.id)) {
          for (const p of d.id.properties) {
            if (!t.isObjectProperty(p)) continue;
            if (t.isIdentifier(p.value)) dataKeys.push(p.value.name);
            else if (p.shorthand && t.isIdentifier(p.key)) dataKeys.push(p.key.name);
          }
        }
      }
      // params destructure: const { slug } = await params / = params
      const rewritten = rewriteParamsAccess(stmtToSource(stmt));
      prelude.push(rewritten);
      continue;
    }

    if (t.isIfStatement(stmt) || t.isExpressionStatement(stmt)) {
      prelude.push(stmtToSource(stmt));
    }
  }

  return { prelude, dataKeys };
}

/**
 * Next 15 `await params` → JSkelet `params` (zaten düz obje).
 * @param {string} src
 * @returns {string}
 */
function rewriteParamsAccess(src) {
  return src
    .replace(/=\s*await\s+params\b/g, "= params")
    .replace(/=\s*await\s+searchParams\b/g, "= query");
}

/**
 * VariableDeclaration için exprToSource yeterli değil — basit printer.
 * @param {import('@babel/types').Statement} stmt
 * @returns {string}
 */
function stmtToSource(stmt) {
  if (t.isIfStatement(stmt)) {
    const test = exprToSource(stmt.test);
    let cons = "";
    if (t.isBlockStatement(stmt.consequent)) {
      cons = stmt.consequent.body.map((s) => stmtToSource(s)).join(" ");
    } else {
      cons = stmtToSource(stmt.consequent);
    }
    return `if (${test}) { ${cons} }`;
  }
  if (t.isExpressionStatement(stmt)) {
    return exprToSource(stmt.expression) + ";";
  }
  if (t.isVariableDeclaration(stmt)) {
    const kind = stmt.kind;
    const decls = stmt.declarations
      .map((d) => {
        const id = t.isIdentifier(d.id)
          ? d.id.name
          : t.isObjectPattern(d.id)
            ? `{ ${d.id.properties
                .map((p) => {
                  if (t.isObjectProperty(p) && t.isIdentifier(p.key)) {
                    if (p.shorthand) return p.key.name;
                    if (t.isIdentifier(p.value)) return `${p.key.name}: ${p.value.name}`;
                  }
                  return "...";
                })
                .join(", ")} }`
            : "/* pat */";
        const init = d.init ? ` = ${exprToSource(d.init)}` : "";
        return id + init;
      })
      .join(", ");
    return `${kind} ${decls};`;
  }
  return `/* TODO[jskelet-migrate]: ${stmt.type} */`;
}

/**
 * @param {import('@babel/types').File} ast
 * @returns {string[]}
 */
function collectDataImports(ast) {
  /** @type {string[]} */
  const lines = [];
  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue;
    const src = node.source.value;
    if (
      src.startsWith("next/") ||
      src === "react" ||
      src === "react/jsx-runtime" ||
      src === "react/jsx-dev-runtime"
    ) {
      continue;
    }
    // Keep app data imports; rewrite @/ if present (same in JSkelet)
    const specs = node.specifiers
      .map((s) => {
        if (t.isImportDefaultSpecifier(s)) return s.local.name;
        if (t.isImportNamespaceSpecifier(s)) return `* as ${s.local.name}`;
        if (t.isImportSpecifier(s) && t.isIdentifier(s.imported)) {
          return s.imported.name === s.local.name
            ? s.local.name
            : `${s.imported.name} as ${s.local.name}`;
        }
        return null;
      })
      .filter(Boolean);
    if (specs.length === 0) continue;
    const hasDefault = node.specifiers.some((s) => t.isImportDefaultSpecifier(s));
    const hasNs = node.specifiers.some((s) => t.isImportNamespaceSpecifier(s));
    const named = node.specifiers.filter((s) => t.isImportSpecifier(s));
    if (hasNs) {
      lines.push(`import ${specs[0]} from ${JSON.stringify(src)};`);
    } else if (hasDefault && named.length === 0) {
      lines.push(`import ${specs[0]} from ${JSON.stringify(ensureJsExt(src))};`);
    } else if (hasDefault) {
      const def = node.specifiers.find((s) => t.isImportDefaultSpecifier(s));
      const n = named
        .map((s) => {
          if (!t.isImportSpecifier(s) || !t.isIdentifier(s.imported)) return null;
          return s.imported.name === s.local.name
            ? s.local.name
            : `${s.imported.name} as ${s.local.name}`;
        })
        .filter(Boolean);
      lines.push(
        `import ${def && t.isImportDefaultSpecifier(def) ? def.local.name : "X"}, { ${n.join(", ")} } from ${JSON.stringify(ensureJsExt(src))};`,
      );
    } else {
      lines.push(`import { ${specs.join(", ")} } from ${JSON.stringify(ensureJsExt(src))};`);
    }
  }
  return lines;
}

/**
 * @param {string} src
 * @returns {string}
 */
function ensureJsExt(src) {
  if (src.startsWith(".") || src.startsWith("@/")) {
    if (!/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(src)) return src + ".js";
  }
  return src;
}

/**
 * generateMetadata basit obje return ediyorsa metadata literal'e çevir.
 *
 * @param {import('@babel/types').File} ast
 * @returns {string | null}
 */
function trySimpleMetadata(ast) {
  for (const node of ast.program.body) {
    if (!t.isExportNamedDeclaration(node)) continue;
    let fn = null;
    if (t.isFunctionDeclaration(node.declaration) && node.declaration.id?.name === "generateMetadata") {
      fn = node.declaration;
    }
    if (
      node.declaration &&
      t.isVariableDeclaration(node.declaration)
    ) {
      for (const d of node.declaration.declarations) {
        if (t.isIdentifier(d.id) && d.id.name === "generateMetadata" && d.init) {
          if (t.isArrowFunctionExpression(d.init) || t.isFunctionExpression(d.init)) {
            fn = d.init;
          }
        }
      }
    }
    if (!fn) continue;
    const body = t.isBlockStatement(fn.body) ? fn.body : null;
    if (!body) continue;
    for (const stmt of body.body) {
      if (t.isReturnStatement(stmt) && stmt.argument && t.isObjectExpression(stmt.argument)) {
        // Only if no await in function and object is simple enough
        const hasAwait = body.body.some(
          (s) => t.isVariableDeclaration(s) && s.declarations.some((d) => d.init && t.isAwaitExpression(d.init)),
        );
        if (hasAwait) return null;
        return objectToMetadata(stmt.argument);
      }
    }
  }
  return null;
}

/**
 * @param {import('@babel/types').ObjectExpression} obj
 * @returns {string}
 */
function objectToMetadata(obj) {
  /** @type {string[]} */
  const parts = [];
  for (const p of obj.properties) {
    if (!t.isObjectProperty(p)) continue;
    const key = t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : null;
    if (!key || !t.isExpression(p.value)) continue;
    if (key === "alternates" && t.isObjectExpression(p.value)) {
      const canon = p.value.properties.find(
        (x) =>
          t.isObjectProperty(x) &&
          ((t.isIdentifier(x.key) && x.key.name === "canonical") ||
            (t.isStringLiteral(x.key) && x.key.value === "canonical")),
      );
      if (canon && t.isObjectProperty(canon) && t.isExpression(canon.value)) {
        parts.push(`canonical: ${exprToSource(canon.value)}`);
      }
      continue;
    }
    parts.push(`${key}: ${exprToSource(/** @type {import('@babel/types').Expression} */ (p.value))}`);
  }
  return `{ ${parts.join(", ")} }`;
}
