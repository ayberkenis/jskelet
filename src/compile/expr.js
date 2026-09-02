/**
 * Şablon ifadeleri — kısıtlı alt küme. İstek anında yorumlanmaz; build'de
 * JS kaynak metnine çevrilir. Çağrı, atama ve `new` yok.
 */
import { CompileError } from "./errors.js";

/**
 * @typedef {{ type: 'Literal', value: string | number | boolean | null, raw: string }} LiteralNode
 * @typedef {{ type: 'Ident', name: string }} IdentNode
 * @typedef {{ type: 'Member', object: ExprNode, property: string, optional: boolean }} MemberNode
 * @typedef {{ type: 'Index', object: ExprNode, index: ExprNode, optional: boolean }} IndexNode
 * @typedef {{ type: 'Unary', op: '!' | '-', argument: ExprNode }} UnaryNode
 * @typedef {{ type: 'Binary', op: string, left: ExprNode, right: ExprNode }} BinaryNode
 * @typedef {{ type: 'Cond', test: ExprNode, consequent: ExprNode, alternate: ExprNode }} CondNode
 * @typedef {LiteralNode | IdentNode | MemberNode | IndexNode | UnaryNode | BinaryNode | CondNode} ExprNode
 */

const IDENT_START = /[A-Za-z_$]/
const IDENT_CONT = /[A-Za-z0-9_$]/

/**
 * @param {string} source
 * @param {number} start
 * @param {number} end
 * @param {{ file?: string, templateSource?: string, templateIndex?: number }} [meta]
 * @returns {ExprNode}
 */
export function parseExpr(source, start = 0, end = source.length, meta = {}) {
  const parser = new ExprParser(source, start, end, meta);
  const node = parser.parseCond();
  parser.skipWs();
  if (parser.i < parser.end) {
    throw parser.error(`Unexpected token in expression`);
  }
  return node;
}

/**
 * İfadeyi JS kaynak metnine çevirir. `locals` içindeki isimler çıplak kalır;
 * diğerleri `data.` öneki alır.
 *
 * @param {ExprNode} node
 * @param {Set<string>} [locals]
 * @returns {string}
 */
export function codegenExpr(node, locals = new Set()) {
  switch (node.type) {
    case "Literal":
      return node.raw;
    case "Ident":
      if (locals.has(node.name)) return node.name;
      return `data.${node.name}`;
    case "Member": {
      const obj = codegenExpr(node.object, locals);
      const op = node.optional ? "?." : ".";
      return `${obj}${op}${node.property}`;
    }
    case "Index": {
      const obj = codegenExpr(node.object, locals);
      const idx = codegenExpr(node.index, locals);
      const op = node.optional ? "?.[" : "[";
      return `${obj}${op}${idx}]`;
    }
    case "Unary":
      return `(${node.op}${codegenExpr(node.argument, locals)})`;
    case "Binary":
      return `(${codegenExpr(node.left, locals)} ${node.op} ${codegenExpr(node.right, locals)})`;
    case "Cond":
      return `(${codegenExpr(node.test, locals)} ? ${codegenExpr(node.consequent, locals)} : ${codegenExpr(node.alternate, locals)})`;
    default:
      throw new Error(`Unknown expr node: ${/** @type {{ type: string }} */ (node).type}`);
  }
}

/**
 * İfadede geçen kök tanımlayıcılar (data alanları / local adayları).
 * @param {ExprNode} node
 * @param {Set<string>} [out]
 * @returns {Set<string>}
 */
export function collectIdents(node, out = new Set()) {
  switch (node.type) {
    case "Literal":
      break;
    case "Ident":
      out.add(node.name);
      break;
    case "Member":
      collectIdents(node.object, out);
      break;
    case "Index":
      collectIdents(node.object, out);
      collectIdents(node.index, out);
      break;
    case "Unary":
      collectIdents(node.argument, out);
      break;
    case "Binary":
      collectIdents(node.left, out);
      collectIdents(node.right, out);
      break;
    case "Cond":
      collectIdents(node.test, out);
      collectIdents(node.consequent, out);
      collectIdents(node.alternate, out);
      break;
    default:
      break;
  }
  return out;
}

class ExprParser {
  /**
   * @param {string} source
   * @param {number} start
   * @param {number} end
   * @param {{ file?: string, templateSource?: string, templateIndex?: number }} meta
   */
  constructor(source, start, end, meta) {
    this.source = source;
    this.i = start;
    this.end = end;
    this.meta = meta;
    this.base = start;
  }

  /**
   * @param {string} message
   * @returns {CompileError}
   */
  error(message) {
    const offset = this.meta.templateIndex != null ? this.meta.templateIndex + (this.i - this.base) : this.i;
    return new CompileError(message, {
      file: this.meta.file,
      source: this.meta.templateSource ?? this.source,
      index: this.meta.templateSource ? offset : this.i,
    });
  }

  skipWs() {
    while (this.i < this.end && /\s/.test(this.source[this.i])) this.i += 1;
  }

  peek() {
    return this.i < this.end ? this.source[this.i] : "";
  }

  /**
   * @param {string} expected
   */
  eat(expected) {
    this.skipWs();
    if (!this.source.startsWith(expected, this.i)) {
      throw this.error(`Expected '${expected}'`);
    }
    this.i += expected.length;
  }

  /**
   * @param {string} expected
   * @returns {boolean}
   */
  match(expected) {
    this.skipWs();
    if (!this.source.startsWith(expected, this.i)) return false;
    this.i += expected.length;
    return true;
  }

  /** @returns {ExprNode} */
  parseCond() {
    const test = this.parseOr();
    this.skipWs();
    if (!this.match("?")) return test;
    const consequent = this.parseCond();
    this.eat(":");
    const alternate = this.parseCond();
    return { type: "Cond", test, consequent, alternate };
  }

  /** @returns {ExprNode} */
  parseOr() {
    let left = this.parseAnd();
    for (;;) {
      this.skipWs();
      if (!this.match("||")) break;
      left = { type: "Binary", op: "||", left, right: this.parseAnd() };
    }
    return left;
  }

  /** @returns {ExprNode} */
  parseAnd() {
    let left = this.parseEquality();
    for (;;) {
      this.skipWs();
      if (!this.match("&&")) break;
      left = { type: "Binary", op: "&&", left, right: this.parseEquality() };
    }
    return left;
  }

  /** @returns {ExprNode} */
  parseEquality() {
    let left = this.parseCompare();
    for (;;) {
      this.skipWs();
      let op = null;
      if (this.match("===")) op = "===";
      else if (this.match("!==")) op = "!==";
      else if (this.match("==")) op = "==";
      else if (this.match("!=")) op = "!=";
      if (!op) break;
      left = { type: "Binary", op, left, right: this.parseCompare() };
    }
    return left;
  }

  /** @returns {ExprNode} */
  parseCompare() {
    let left = this.parseAdd();
    for (;;) {
      this.skipWs();
      let op = null;
      if (this.match("<=")) op = "<=";
      else if (this.match(">=")) op = ">=";
      else if (this.match("<")) op = "<";
      else if (this.match(">")) op = ">";
      if (!op) break;
      left = { type: "Binary", op, left, right: this.parseAdd() };
    }
    return left;
  }

  /** @returns {ExprNode} */
  parseAdd() {
    let left = this.parseMul();
    for (;;) {
      this.skipWs();
      const ch = this.peek();
      if (ch !== "+" && ch !== "-") break;
      // `?.` / sayılar ile karışmasın diye yalnızca tek karakter op.
      this.i += 1;
      left = { type: "Binary", op: ch, left, right: this.parseMul() };
    }
    return left;
  }

  /** @returns {ExprNode} */
  parseMul() {
    let left = this.parseUnary();
    for (;;) {
      this.skipWs();
      const ch = this.peek();
      if (ch !== "*" && ch !== "/" && ch !== "%") break;
      this.i += 1;
      left = { type: "Binary", op: ch, left, right: this.parseUnary() };
    }
    return left;
  }

  /** @returns {ExprNode} */
  parseUnary() {
    this.skipWs();
    if (this.match("!")) {
      return { type: "Unary", op: "!", argument: this.parseUnary() };
    }
    if (this.peek() === "-" && !/[0-9.]/.test(this.source[this.i + 1] ?? "")) {
      this.i += 1;
      return { type: "Unary", op: "-", argument: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  /** @returns {ExprNode} */
  parsePostfix() {
    let node = this.parsePrimary();
    for (;;) {
      this.skipWs();
      if (this.match("?.")) {
        this.skipWs();
        if (this.peek() === "[") {
          this.i += 1;
          const index = this.parseCond();
          this.eat("]");
          node = { type: "Index", object: node, index, optional: true };
          continue;
        }
        const property = this.readIdent();
        node = { type: "Member", object: node, property, optional: true };
        continue;
      }
      if (this.peek() === ".") {
        this.i += 1;
        const property = this.readIdent();
        node = { type: "Member", object: node, property, optional: false };
        continue;
      }
      if (this.peek() === "[") {
        this.i += 1;
        const index = this.parseCond();
        this.eat("]");
        node = { type: "Index", object: node, index, optional: false };
        continue;
      }
      break;
    }
    return node;
  }

  /** @returns {ExprNode} */
  parsePrimary() {
    this.skipWs();
    const ch = this.peek();

    if (ch === "(") {
      this.i += 1;
      const node = this.parseCond();
      this.eat(")");
      return node;
    }

    if (ch === '"' || ch === "'") {
      return this.readString();
    }

    if (ch === "`") {
      throw this.error("Template literals are not allowed in expressions");
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(this.source[this.i + 1] ?? ""))) {
      return this.readNumber();
    }

    if (IDENT_START.test(ch)) {
      const name = this.readIdent();
      if (name === "true") return { type: "Literal", value: true, raw: "true" };
      if (name === "false") return { type: "Literal", value: false, raw: "false" };
      if (name === "null") return { type: "Literal", value: null, raw: "null" };
      return { type: "Ident", name };
    }

    throw this.error("Expected expression");
  }

  /** @returns {string} */
  readIdent() {
    this.skipWs();
    if (!IDENT_START.test(this.peek())) {
      throw this.error("Expected identifier");
    }
    const start = this.i;
    this.i += 1;
    while (this.i < this.end && IDENT_CONT.test(this.source[this.i])) this.i += 1;
    return this.source.slice(start, this.i);
  }

  /** @returns {LiteralNode} */
  readString() {
    const quote = this.source[this.i];
    this.i += 1;
    let raw = quote;
    let value = "";
    while (this.i < this.end) {
      const ch = this.source[this.i];
      if (ch === "\\") {
        raw += ch + (this.source[this.i + 1] ?? "");
        value += this.source[this.i + 1] ?? "";
        this.i += 2;
        continue;
      }
      if (ch === quote) {
        raw += quote;
        this.i += 1;
        return { type: "Literal", value, raw };
      }
      if (ch === "\n") {
        throw this.error("Unterminated string");
      }
      raw += ch;
      value += ch;
      this.i += 1;
    }
    throw this.error("Unterminated string");
  }

  /** @returns {LiteralNode} */
  readNumber() {
    const start = this.i;
    while (this.i < this.end && /[0-9_]/.test(this.source[this.i])) this.i += 1;
    if (this.source[this.i] === ".") {
      this.i += 1;
      while (this.i < this.end && /[0-9_]/.test(this.source[this.i])) this.i += 1;
    }
    if (this.source[this.i] === "e" || this.source[this.i] === "E") {
      this.i += 1;
      if (this.source[this.i] === "+" || this.source[this.i] === "-") this.i += 1;
      while (this.i < this.end && /[0-9]/.test(this.source[this.i])) this.i += 1;
    }
    const raw = this.source.slice(start, this.i).replace(/_/g, "");
    return { type: "Literal", value: Number(raw), raw };
  }
}
