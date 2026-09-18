/**
 * Babel ifade → kaynak metin + JSK parseExpr doğrulaması.
 * `@babel/generator` yok; JSX attr / {{ }} için yeterli alt küme basılır.
 */
import { t } from "../babel.mjs";
import { parseExpr } from "../../compile/expr.js";

/**
 * @param {import('@babel/types').Node} node
 * @returns {string}
 */
export function exprToSource(node) {
  if (t.isTSAsExpression(node) || t.isTSTypeAssertion(node) || t.isTSNonNullExpression(node)) {
    return exprToSource(/** @type {{ expression: import('@babel/types').Expression }} */ (node).expression);
  }
  if (t.isParenthesizedExpression(node)) {
    return `(${exprToSource(node.expression)})`;
  }
  if (t.isIdentifier(node)) return node.name;
  if (t.isStringLiteral(node)) return JSON.stringify(node.value);
  if (t.isNumericLiteral(node)) return String(node.value);
  if (t.isBooleanLiteral(node)) return node.value ? "true" : "false";
  if (t.isNullLiteral(node)) return "null";
  if (t.isBigIntLiteral(node)) return node.value + "n";

  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    const obj = exprToSource(node.object);
    const opt = "optional" in node && node.optional ? "?." : ".";
    if (node.computed) {
      return `${obj}${opt === "?." ? "?." : ""}[${exprToSource(/** @type {import('@babel/types').Expression} */ (node.property))}]`;
    }
    if (t.isIdentifier(node.property)) {
      return `${obj}${opt}${node.property.name}`;
    }
    return `${obj}.${exprToSource(node.property)}`;
  }

  if (t.isUnaryExpression(node)) {
    return `${node.operator}${exprToSource(node.argument)}`;
  }

  if (t.isBinaryExpression(node) || t.isLogicalExpression(node)) {
    return `${exprToSource(/** @type {import('@babel/types').Expression} */ (node.left))} ${node.operator} ${exprToSource(node.right)}`;
  }

  if (t.isConditionalExpression(node)) {
    return `${exprToSource(node.test)} ? ${exprToSource(node.consequent)} : ${exprToSource(node.alternate)}`;
  }

  if (t.isTemplateLiteral(node)) {
    let out = "`";
    for (let i = 0; i < node.quasis.length; i++) {
      out += node.quasis[i].value.cooked ?? node.quasis[i].value.raw;
      if (i < node.expressions.length) {
        out += "${" + exprToSource(node.expressions[i]) + "}";
      }
    }
    return out + "`";
  }

  if (t.isArrayExpression(node)) {
    return `[${node.elements.map((el) => (el ? exprToSource(el) : "")).join(", ")}]`;
  }

  if (t.isObjectExpression(node)) {
    const props = node.properties.map((p) => {
      if (t.isSpreadElement(p)) return `...${exprToSource(p.argument)}`;
      if (t.isObjectMethod(p)) return `/* method */`;
      if (t.isObjectProperty(p)) {
        const key = t.isIdentifier(p.key) && !p.computed ? p.key.name : exprToSource(p.key);
        return `${key}: ${exprToSource(/** @type {import('@babel/types').Expression} */ (p.value))}`;
      }
      return "";
    });
    return `{ ${props.join(", ")} }`;
  }

  if (t.isCallExpression(node)) {
    const callee = exprToSource(node.callee);
    const args = node.arguments.map((a) => exprToSource(/** @type {import('@babel/types').Node} */ (a))).join(", ");
    return `${callee}(${args})`;
  }

  if (t.isAwaitExpression(node)) {
    return `await ${exprToSource(node.argument)}`;
  }

  if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
    return `/* function */`;
  }

  if (t.isThisExpression(node)) return "this";

  return `/* unsupported:${node.type} */`;
}

/**
 * @param {string} source
 * @returns {boolean}
 */
export function isJskExpr(source) {
  if (!source || source.includes("/* unsupported")) return false;
  try {
    parseExpr(source);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {import('@babel/types').Expression} expr
 * @returns {{ ok: true, source: string } | { ok: false, reason: string }}
 */
export function tryJskExpr(expr) {
  if (t.isStringLiteral(expr)) {
    return { ok: true, source: JSON.stringify(expr.value) };
  }
  if (t.isNumericLiteral(expr)) {
    return { ok: true, source: String(expr.value) };
  }
  if (t.isBooleanLiteral(expr)) {
    return { ok: true, source: expr.value ? "true" : "false" };
  }
  if (t.isNullLiteral(expr)) {
    return { ok: true, source: "null" };
  }

  const source = exprToSource(expr);
  if (isJskExpr(source)) return { ok: true, source };
  return { ok: false, reason: `expression not valid in .jsk: ${source}` };
}

/**
 * @param {import('@babel/types').Expression} expr
 * @param {Set<string>} out
 */
export function collectRootIdents(expr, out) {
  if (t.isIdentifier(expr)) {
    out.add(expr.name);
    return;
  }
  if (t.isMemberExpression(expr) || t.isOptionalMemberExpression(expr)) {
    collectRootIdents(/** @type {import('@babel/types').Expression} */ (expr.object), out);
    return;
  }
  if (t.isConditionalExpression(expr)) {
    collectRootIdents(expr.test, out);
    collectRootIdents(expr.consequent, out);
    collectRootIdents(expr.alternate, out);
    return;
  }
  if (t.isLogicalExpression(expr) || t.isBinaryExpression(expr)) {
    collectRootIdents(/** @type {import('@babel/types').Expression} */ (expr.left), out);
    collectRootIdents(expr.right, out);
    return;
  }
  if (t.isUnaryExpression(expr)) {
    collectRootIdents(expr.argument, out);
    return;
  }
  if (t.isCallExpression(expr)) {
    collectRootIdents(/** @type {import('@babel/types').Expression} */ (expr.callee), out);
    for (const arg of expr.arguments) {
      if (t.isExpression(arg)) collectRootIdents(arg, out);
    }
  }
}
