/**
 * Presentational React bileşeni → `views/components/*.js` HTML-string fonksiyon.
 */
import { t } from "../babel.mjs";
import { parseSource } from "../parse.mjs";
import { exprToSource } from "./expr-source.mjs";

/**
 * @typedef {{ status: 'ok' | 'partial' | 'skipped', notes: string[], name: string | null, code: string | null }} ComponentResult
 */

/**
 * @param {string} code
 * @param {string} filename
 * @returns {ComponentResult}
 */
export function transformComponent(code, filename) {
  /** @type {ComponentResult} */
  const result = { status: "ok", notes: [], name: null, code: null };

  if (/["']use client["']/.test(code) || /\buse(State|Effect|Memo|Callback|Ref|Context)\s*\(/.test(code)) {
    result.status = "skipped";
    result.notes.push("client / hooks — use island transform");
    return result;
  }

  let ast;
  try {
    ast = parseSource(code, filename);
  } catch (error) {
    result.status = "skipped";
    result.notes.push(error instanceof Error ? error.message : String(error));
    return result;
  }

  const fn = findComponentFunction(ast);
  if (!fn) {
    result.status = "skipped";
    result.notes.push("no exported function component with JSX return found");
    return result;
  }

  result.name = fn.name;
  const props = fn.props;
  const jsx = fn.jsx;
  const body = renderJsxToTemplate(jsx, result);
  if (result.status === "skipped") return result;

  const propsParam = props.length
    ? `{ ${props.map((p) => (p === "className" ? "class: className" : p)).join(", ")} }`
    : "props = {}";

  const needsCn = body.includes("cn(");
  const imports = ["esc", "attrs", ...(needsCn ? ["cn"] : [])];
  const preamble = extractPreamble(ast);

  result.code =
    `import { ${imports.join(", ")} } from "jskelet/html";\n` +
    (preamble ? `\n${preamble}\n` : "\n") +
    `export function ${camelName(fn.name)}(${propsParam}) {\n` +
    `  return ${body};\n` +
    `}\n`;

  if (result.notes.length && result.status === "ok") result.status = "partial";
  return result;
}

/**
 * Import dışı üst seviye const'ları (TONES vb.) kopyala.
 * @param {import('@babel/types').File} ast
 * @returns {string}
 */
function extractPreamble(ast) {
  /** @type {string[]} */
  const lines = [];
  for (const node of ast.program.body) {
    if (t.isImportDeclaration(node)) continue;
    if (t.isExportNamedDeclaration(node) || t.isExportDefaultDeclaration(node)) continue;
    if (t.isVariableDeclaration(node)) {
      lines.push(printVar(node));
    }
  }
  return lines.join("\n");
}

/**
 * @param {import('@babel/types').VariableDeclaration} stmt
 * @returns {string}
 */
function printVar(stmt) {
  const decls = stmt.declarations
    .map((d) => {
      const id = t.isIdentifier(d.id) ? d.id.name : "/* pat */";
      const init = d.init ? ` = ${exprToSource(d.init)}` : "";
      return id + init;
    })
    .join(", ");
  return `${stmt.kind} ${decls};`;
}

/**
 * @param {import('@babel/types').File} ast
 * @returns {{ name: string, props: string[], jsx: import('@babel/types').JSXElement | import('@babel/types').JSXFragment } | null}
 */
function findComponentFunction(ast) {
  for (const node of ast.program.body) {
    // export function Badge(...) { return <...> }
    if (t.isExportNamedDeclaration(node) && t.isFunctionDeclaration(node.declaration)) {
      const decl = node.declaration;
      if (!decl.id) continue;
      const jsx = findReturnJsx(decl.body);
      if (!jsx) continue;
      return { name: decl.id.name, props: propsFromParams(decl.params), jsx };
    }
    // export const Badge = (...) => <...>
    if (
      t.isExportNamedDeclaration(node) &&
      node.declaration &&
      t.isVariableDeclaration(node.declaration)
    ) {
      for (const d of node.declaration.declarations) {
        if (!t.isIdentifier(d.id)) continue;
        if (!d.init) continue;
        if (t.isArrowFunctionExpression(d.init) || t.isFunctionExpression(d.init)) {
          let jsx = null;
          if (t.isJSXElement(d.init.body) || t.isJSXFragment(d.init.body)) {
            jsx = d.init.body;
          } else if (t.isBlockStatement(d.init.body)) {
            jsx = findReturnJsx(d.init.body);
          }
          if (!jsx) continue;
          return { name: d.id.name, props: propsFromParams(d.init.params), jsx };
        }
      }
    }
    // export default function
    if (t.isExportDefaultDeclaration(node) && t.isFunctionDeclaration(node.declaration)) {
      const decl = node.declaration;
      const name = decl.id?.name ?? "Component";
      const jsx = findReturnJsx(decl.body);
      if (!jsx) continue;
      return { name, props: propsFromParams(decl.params), jsx };
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
    if (t.isReturnStatement(stmt) && stmt.argument) {
      if (t.isJSXElement(stmt.argument) || t.isJSXFragment(stmt.argument)) {
        return stmt.argument;
      }
      if (t.isParenthesizedExpression(stmt.argument)) {
        const inner = stmt.argument.expression;
        if (t.isJSXElement(inner) || t.isJSXFragment(inner)) return inner;
      }
    }
  }
  return null;
}

/**
 * @param {import('@babel/types').FunctionDeclaration['params']} params
 * @returns {string[]}
 */
function propsFromParams(params) {
  if (params.length === 0) return [];
  const first = params[0];
  if (t.isObjectPattern(first)) {
    return first.properties
      .map((p) => {
        if (t.isObjectProperty(p) && t.isIdentifier(p.key)) return p.key.name;
        if (t.isRestElement(p) && t.isIdentifier(p.argument)) return p.argument.name;
        return null;
      })
      .filter(Boolean);
  }
  return [];
}

/**
 * @param {import('@babel/types').JSXElement | import('@babel/types').JSXFragment} node
 * @param {ComponentResult} result
 * @returns {string} template literal expression (with backticks)
 */
function renderJsxToTemplate(node, result) {
  const inner = renderNode(node, result);
  return `\`${inner}\``;
}

/**
 * @param {import('@babel/types').Node} node
 * @param {ComponentResult} result
 * @returns {string}
 */
function renderNode(node, result) {
  if (t.isJSXFragment(node)) {
    return node.children.map((c) => renderNode(c, result)).join("");
  }
  if (t.isJSXText(node)) {
    return escapeTemplate(node.value);
  }
  if (t.isJSXExpressionContainer(node)) {
    if (t.isJSXEmptyExpression(node.expression)) return "";
    return `\${esc(${exprToSource(node.expression)})}`;
  }
  if (t.isJSXElement(node)) {
    return renderElement(node, result);
  }
  result.notes.push(`unsupported node ${node.type}`);
  result.status = "partial";
  return "";
}

/**
 * @param {import('@babel/types').JSXElement} el
 * @param {ComponentResult} result
 * @returns {string}
 */
function renderElement(el, result) {
  const nameNode = el.openingElement.name;
  if (!t.isJSXIdentifier(nameNode)) {
    result.notes.push("namespaced JSX not supported");
    result.status = "partial";
    return "";
  }
  const tag = nameNode.name;
  /** @type {Record<string, string>} */
  const staticAttrs = {};
  /** @type {string[]} */
  const dynamicParts = [];

  for (const attr of el.openingElement.attributes) {
    if (t.isJSXSpreadAttribute(attr)) {
      result.notes.push("spread attributes");
      result.status = "partial";
      continue;
    }
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) continue;
    let key = attr.name.name;
    if (key === "className") key = "class";
    if (key === "htmlFor") key = "for";
    if (key === "dangerouslySetInnerHTML") {
      result.notes.push("dangerouslySetInnerHTML in component — use raw html prop");
      result.status = "partial";
      continue;
    }

    if (attr.value === null) {
      staticAttrs[key] = "true";
      continue;
    }
    if (t.isStringLiteral(attr.value)) {
      staticAttrs[key] = attr.value.value;
      continue;
    }
    if (t.isJSXExpressionContainer(attr.value) && t.isExpression(attr.value.expression)) {
      const src = exprToSource(attr.value.expression);
      if (key === "class" && src.startsWith("cn(")) {
        dynamicParts.push(`class: ${src}`);
      } else {
        dynamicParts.push(`${JSON.stringify(key)}: ${src}`);
      }
    }
  }

  const attrsCall =
    Object.keys(staticAttrs).length || dynamicParts.length
      ? `\${attrs({ ${[
          ...Object.entries(staticAttrs).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`),
          ...dynamicParts,
        ].join(", ")} })}`
      : "";

  const children = el.children.map((c) => renderNode(c, result)).join("");
  if (el.openingElement.selfClosing && !children) {
    return `<${tag}${attrsCall} />`;
  }
  return `<${tag}${attrsCall}>${children}</${tag}>`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeTemplate(text) {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/**
 * @param {string} name
 * @returns {string}
 */
function camelName(name) {
  if (!name) return "component";
  return name.charAt(0).toLowerCase() + name.slice(1);
}
