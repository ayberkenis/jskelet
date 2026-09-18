/**
 * JSX AST → `.jsk` şablon metni.
 */
import { t } from "../babel.mjs";
import { tryJskExpr, collectRootIdents, exprToSource } from "./expr-source.mjs";

/**
 * @typedef {{ status: 'ok' | 'partial' | 'skipped', notes: string[], bindings: Set<string> }} TransformReport
 */

/**
 * @param {import('@babel/types').Node} jsx
 * @returns {{ source: string, report: TransformReport }}
 */
export function jsxToJsk(jsx) {
  /** @type {TransformReport} */
  const report = { status: "ok", notes: [], bindings: new Set() };
  const source = renderNode(jsx, report);
  if (report.notes.length && report.status === "ok") report.status = "partial";
  return { source, report };
}

/**
 * @param {import('@babel/types').Node | null | undefined} node
 * @param {TransformReport} report
 * @returns {string}
 */
function renderNode(node, report) {
  if (!node) return "";

  if (t.isJSXFragment(node)) {
    return node.children.map((c) => renderNode(c, report)).join("");
  }

  if (t.isJSXElement(node)) {
    return renderElement(node, report);
  }

  if (t.isJSXText(node)) {
    return node.value.replace(/\s+/g, (m) => (m.includes("\n") ? "\n" : m));
  }

  if (t.isJSXExpressionContainer(node)) {
    return renderExpression(node.expression, report);
  }

  if (t.isJSXEmptyExpression(node)) return "";

  report.notes.push(`unsupported JSX node: ${node.type}`);
  report.status = "partial";
  return `{# /* TODO[jskelet-migrate]: unsupported ${node.type} */ #}`;
}

/**
 * @param {import('@babel/types').JSXElement} el
 * @param {TransformReport} report
 * @returns {string}
 */
function renderElement(el, report) {
  const name = jsxName(el.openingElement.name);
  if (!name) {
    report.notes.push("unsupported JSX name");
    report.status = "partial";
    return "";
  }

  // dangerouslySetInnerHTML={{ __html: x }} → {{{ x }}}
  const dsi = findAttr(el.openingElement.attributes, "dangerouslySetInnerHTML");
  if (dsi && t.isJSXAttribute(dsi) && t.isJSXExpressionContainer(dsi.value)) {
    const expr = dsi.value.expression;
    if (t.isObjectExpression(expr)) {
      const htmlProp = expr.properties.find(
        (p) =>
          t.isObjectProperty(p) &&
          ((t.isIdentifier(p.key) && p.key.name === "__html") ||
            (t.isStringLiteral(p.key) && p.key.value === "__html")),
      );
      if (htmlProp && t.isObjectProperty(htmlProp) && t.isExpression(htmlProp.value)) {
        const tried = tryJskExpr(htmlProp.value);
        if (tried.ok) {
          collectRootIdents(htmlProp.value, report.bindings);
          return `{{{ ${tried.source} }}}`;
        }
        report.notes.push(tried.reason);
        report.status = "partial";
        return `{# /* TODO[jskelet-migrate]: ${tried.reason} */ #}`;
      }
    }
  }

  // next/image → Image, next/link → Link (name already resolved by caller imports)
  const tag = rewriteBuiltinTag(name);
  const attrs = renderAttrs(el.openingElement.attributes, report, tag);
  const children = el.children.map((c) => renderNode(c, report)).join("");

  // <Link href="..." >text</Link> → text= when single text child
  if (tag === "Link" && !hasAttr(el.openingElement.attributes, "text")) {
    const textChild = singleTextChild(el.children);
    if (textChild !== null) {
      const quoted = JSON.stringify(textChild);
      const hrefPart = attrs ? " " + attrs : "";
      return `<Link${hrefPart} text=${quoted} />`;
    }
  }

  if (el.openingElement.selfClosing || children.trim() === "") {
    return `<${tag}${attrs ? " " + attrs : ""} />`;
  }
  return `<${tag}${attrs ? " " + attrs : ""}>${children}</${tag}>`;
}

/**
 * @param {import('@babel/types').JSXAttribute[] | import('@babel/types').JSXSpreadAttribute[]} attributes
 * @param {TransformReport} report
 * @param {string} tag
 * @returns {string}
 */
function renderAttrs(attributes, report, tag) {
  /** @type {string[]} */
  const parts = [];
  for (const attr of attributes) {
    if (t.isJSXSpreadAttribute(attr)) {
      report.notes.push("spread attributes are not supported in .jsk");
      report.status = "partial";
      continue;
    }
    if (!t.isJSXAttribute(attr)) continue;
    const rawName = jsxName(attr.name);
    if (!rawName) continue;
    if (rawName === "dangerouslySetInnerHTML") continue;

    let name = rawName === "className" ? "class" : rawName;
    // React reserved → HTML
    if (name === "htmlFor") name = "for";
    if (name === "key") continue;

    if (attr.value === null) {
      parts.push(name);
      continue;
    }

    if (t.isStringLiteral(attr.value)) {
      parts.push(`${name}=${JSON.stringify(attr.value.value)}`);
      continue;
    }

    if (t.isJSXExpressionContainer(attr.value)) {
      const expr = attr.value.expression;
      if (t.isJSXEmptyExpression(expr)) continue;

      // boolean true
      if (t.isBooleanLiteral(expr) && expr.value === true) {
        parts.push(name);
        continue;
      }
      if (t.isBooleanLiteral(expr) && expr.value === false) {
        continue;
      }

      const tried = tryJskExpr(expr);
      if (!tried.ok) {
        report.notes.push(`${tag} ${name}: ${tried.reason}`);
        report.status = "partial";
        continue;
      }
      collectRootIdents(expr, report.bindings);
      parts.push(`:${name}="${tried.source}"`);
      continue;
    }
  }
  return parts.join(" ");
}

/**
 * @param {import('@babel/types').Node} expression
 * @param {TransformReport} report
 * @returns {string}
 */
function renderExpression(expression, report) {
  if (t.isJSXEmptyExpression(expression)) return "";

  // {cond && <El/>} or {cond ? <A/> : <B/>}
  if (t.isLogicalExpression(expression) && expression.operator === "&&") {
    const right = expression.right;
    if (t.isJSXElement(right) || t.isJSXFragment(right)) {
      const tried = tryJskExpr(expression.left);
      if (!tried.ok) {
        report.notes.push(tried.reason);
        report.status = "partial";
        return `{# /* TODO[jskelet-migrate]: ${tried.reason} */ #}`;
      }
      collectRootIdents(expression.left, report.bindings);
      const body = renderNode(right, report);
      return `{#if ${tried.source}}${body}{/if}`;
    }
  }

  if (t.isConditionalExpression(expression)) {
    const { test, consequent, alternate } = expression;
    if (
      (t.isJSXElement(consequent) || t.isJSXFragment(consequent)) &&
      (t.isJSXElement(alternate) || t.isJSXFragment(alternate) || t.isNullLiteral(alternate))
    ) {
      const tried = tryJskExpr(test);
      if (!tried.ok) {
        report.notes.push(tried.reason);
        report.status = "partial";
        return `{# /* TODO[jskelet-migrate]: ${tried.reason} */ #}`;
      }
      collectRootIdents(test, report.bindings);
      const a = renderNode(consequent, report);
      const b = t.isNullLiteral(alternate) ? "" : renderNode(alternate, report);
      if (b) return `{#if ${tried.source}}${a}{#else}${b}{/if}`;
      return `{#if ${tried.source}}${a}{/if}`;
    }
  }

  // {items.map((item, i) => <li>...</li>)}
  if (t.isCallExpression(expression) && t.isMemberExpression(expression.callee)) {
    const prop = expression.callee.property;
    if (t.isIdentifier(prop) && prop.name === "map" && expression.arguments.length >= 1) {
      const fn = expression.arguments[0];
      if (t.isArrowFunctionExpression(fn) || t.isFunctionExpression(fn)) {
        const params = fn.params;
        const itemName = t.isIdentifier(params[0]) ? params[0].name : "item";
        const indexName = t.isIdentifier(params[1]) ? params[1].name : null;
        const collection = tryJskExpr(
          /** @type {import('@babel/types').Expression} */ (expression.callee.object),
        );
        if (!collection.ok) {
          report.notes.push(collection.reason);
          report.status = "partial";
          return `{# /* TODO[jskelet-migrate]: ${collection.reason} */ #}`;
        }
        collectRootIdents(
          /** @type {import('@babel/types').Expression} */ (expression.callee.object),
          report.bindings,
        );
        let bodyNode = fn.body;
        if (t.isBlockStatement(bodyNode)) {
          const ret = bodyNode.body.find((s) => t.isReturnStatement(s));
          bodyNode = ret && ret.argument ? ret.argument : null;
        }
        if (!bodyNode || !(t.isJSXElement(bodyNode) || t.isJSXFragment(bodyNode))) {
          report.notes.push("map callback must return JSX");
          report.status = "partial";
          return `{# /* TODO[jskelet-migrate]: map callback must return JSX */ #}`;
        }
        const body = renderNode(bodyNode, report);
        const as = indexName ? `${itemName}, ${indexName}` : itemName;
        return `{#each ${collection.source} as ${as}}${body}{/each}`;
      }
    }
  }

  // Plain expression → {{ }}
  if (t.isExpression(expression)) {
    const tried = tryJskExpr(expression);
    if (tried.ok) {
      collectRootIdents(expression, report.bindings);
      return `{{ ${tried.source} }}`;
    }
    report.notes.push(tried.reason);
    report.status = "partial";
    return `{# /* TODO[jskelet-migrate]: ${tried.reason} */ #}`;
  }

  report.notes.push(`unsupported expression: ${expression.type}`);
  report.status = "partial";
  return `{# /* TODO[jskelet-migrate]: ${expression.type} */ #}`;
}

/**
 * @param {import('@babel/types').JSXIdentifier | import('@babel/types').JSXMemberExpression | import('@babel/types').JSXNamespacedName} name
 * @returns {string | null}
 */
function jsxName(name) {
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) {
    const obj = jsxName(name.object);
    const prop = jsxName(name.property);
    if (obj && prop) return `${obj}.${prop}`;
  }
  return null;
}

/**
 * @param {string} name
 * @returns {string}
 */
function rewriteBuiltinTag(name) {
  if (name === "Image") return "Image";
  if (name === "Link") return "Link";
  return name;
}

/**
 * @param {import('@babel/types').JSXAttribute[] | import('@babel/types').JSXSpreadAttribute[]} attrs
 * @param {string} name
 */
function findAttr(attrs, name) {
  return attrs.find(
    (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === name,
  );
}

/**
 * @param {import('@babel/types').JSXAttribute[] | import('@babel/types').JSXSpreadAttribute[]} attrs
 * @param {string} name
 */
function hasAttr(attrs, name) {
  return Boolean(findAttr(attrs, name));
}

/**
 * @param {import('@babel/types').JSXElement['children']} children
 * @returns {string | null}
 */
function singleTextChild(children) {
  const meaningful = children.filter((c) => {
    if (t.isJSXText(c)) return c.value.trim().length > 0;
    return true;
  });
  if (meaningful.length === 1 && t.isJSXText(meaningful[0])) {
    return meaningful[0].value.trim();
  }
  return null;
}

export { exprToSource };
