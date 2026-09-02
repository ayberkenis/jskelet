/**
 * `.jsk` şablon ayrıştırıcı. HTML'e yakın sözdizimi + blok direktifleri.
 * İstek anında çalışmaz; yalnızca build-time.
 */
import { CompileError } from "./errors.js";
import { parseExpr } from "./expr.js";

/** Self-closing HTML void elements. */
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * @typedef {import('./expr.js').ExprNode} ExprNode
 * @typedef {{ type: 'Text', value: string }} TextNode
 * @typedef {{ type: 'Interp', expr: ExprNode, raw: boolean, index: number }} InterpNode
 * @typedef {{ name: string, value: string | null, expr: ExprNode | null, bound: boolean, boolean: boolean, index: number }} AttrNode
 * @typedef {{ type: 'Element', name: string, attrs: AttrNode[], children: AstNode[], selfClosing: boolean, index: number }} ElementNode
 * @typedef {{ type: 'Component', name: string, attrs: AttrNode[], children: AstNode[], selfClosing: boolean, index: number }} ComponentNode
 * @typedef {{ type: 'If', test: ExprNode, consequent: AstNode[], alternate: AstNode[], index: number }} IfNode
 * @typedef {{ type: 'Each', list: ExprNode, item: string, indexName: string | null, children: AstNode[], index: number }} EachNode
 * @typedef {{ type: 'Include', path: string, index: number }} IncludeNode
 * @typedef {TextNode | InterpNode | ElementNode | ComponentNode | IfNode | EachNode | IncludeNode} AstNode
 */

/**
 * @param {string} source
 * @param {{ file?: string }} [options]
 * @returns {AstNode[]}
 */
export function parseTemplate(source, options = {}) {
  const parser = new TemplateParser(source, options.file);
  return parser.parseNodes();
}

/**
 * PascalCase bileşen mi?
 * @param {string} name
 * @returns {boolean}
 */
export function isComponentTag(name) {
  return /^[A-Z]/.test(name);
}

class TemplateParser {
  /**
   * @param {string} source
   * @param {string} [file]
   */
  constructor(source, file) {
    this.source = source;
    this.file = file;
    this.i = 0;
  }

  /**
   * @param {string} message
   * @param {number} [index]
   * @returns {CompileError}
   */
  error(message, index = this.i) {
    return new CompileError(message, {
      file: this.file,
      source: this.source,
      index,
    });
  }

  eof() {
    return this.i >= this.source.length;
  }

  peek(n = 0) {
    return this.source[this.i + n] ?? "";
  }

  startsWith(value) {
    return this.source.startsWith(value, this.i);
  }

  /**
   * @param {string} [until]
   * @returns {AstNode[]}
   */
  parseNodes(until) {
    /** @type {AstNode[]} */
    const nodes = [];
    while (!this.eof()) {
      if (until && this.startsWith(until)) break;

      if (this.startsWith("<!--")) {
        this.skipComment();
        continue;
      }

      if (this.startsWith("{#")) {
        nodes.push(this.parseDirective());
        continue;
      }

      if (this.startsWith("{{")) {
        nodes.push(this.parseInterp());
        continue;
      }

      if (this.startsWith("</")) {
        // Parent closes — leave for caller.
        break;
      }

      if (this.peek() === "<" && /[A-Za-z]/.test(this.peek(1))) {
        nodes.push(this.parseTag());
        continue;
      }

      nodes.push(this.parseText(until));
    }
    return nodes;
  }

  skipComment() {
    const end = this.source.indexOf("-->", this.i + 4);
    if (end === -1) throw this.error("Unterminated HTML comment");
    this.i = end + 3;
  }

  /**
   * @param {string} [until]
   * @returns {TextNode}
   */
  parseText(until) {
    const start = this.i;
    while (!this.eof()) {
      if (this.startsWith("{{") || this.startsWith("{#") || this.startsWith("<!--")) break;
      if (this.peek() === "<") break;
      if (until && this.startsWith(until)) break;
      this.i += 1;
    }
    return { type: "Text", value: this.source.slice(start, this.i) };
  }

  /** @returns {InterpNode} */
  parseInterp() {
    const index = this.i;
    let raw = false;
    if (this.startsWith("{{{")) {
      raw = true;
      this.i += 3;
    } else {
      this.i += 2;
    }
    const close = raw ? "}}}" : "}}";
    const end = this.source.indexOf(close, this.i);
    if (end === -1) throw this.error("Unterminated interpolation", index);
    const exprSrc = this.source.slice(this.i, end).trim();
    if (!exprSrc) throw this.error("Empty interpolation", index);
    const expr = parseExpr(exprSrc, 0, exprSrc.length, {
      file: this.file,
      templateSource: this.source,
      templateIndex: this.i,
    });
    this.i = end + close.length;
    return { type: "Interp", expr, raw, index };
  }

  /** @returns {IfNode | EachNode | IncludeNode} */
  parseDirective() {
    const index = this.i;
    if (this.startsWith("{#if")) {
      return this.parseIf(index);
    }
    if (this.startsWith("{#each")) {
      return this.parseEach(index);
    }
    if (this.startsWith("{#include")) {
      return this.parseInclude(index);
    }
    // `{# comment #}` — kapanış `#}` zorunlu; yoksa bilinmeyen direktif.
    if (this.startsWith("{#")) {
      const end = this.source.indexOf("#}", this.i + 2);
      if (end === -1) {
        throw this.error("Unknown directive", index);
      }
      this.i = end + 2;
      return { type: "Text", value: "" };
    }
    throw this.error("Unknown directive", index);
  }

  /**
   * @param {number} index
   * @returns {IfNode}
   */
  parseIf(index) {
    this.i += 4; // {#if
    const closeBrace = this.source.indexOf("}", this.i);
    if (closeBrace === -1) throw this.error("Unterminated {#if}", index);
    const testSrc = this.source.slice(this.i, closeBrace).trim();
    if (!testSrc) throw this.error("Empty {#if} condition", index);
    const test = parseExpr(testSrc, 0, testSrc.length, {
      file: this.file,
      templateSource: this.source,
      templateIndex: this.i,
    });
    this.i = closeBrace + 1;

    const consequent = this.parseNodesUntil(["{#else}", "{/if}"]);
    /** @type {AstNode[]} */
    let alternate = [];

    if (this.startsWith("{#else}")) {
      this.i += "{#else}".length;
      alternate = this.parseNodesUntil(["{/if}"]);
    }

    if (!this.startsWith("{/if}")) {
      throw this.error("Expected {/if}", this.i);
    }
    this.i += "{/if}".length;

    return { type: "If", test, consequent, alternate, index };
  }

  /**
   * @param {string[]} markers
   * @returns {AstNode[]}
   */
  parseNodesUntil(markers) {
    /** @type {AstNode[]} */
    const nodes = [];
    while (!this.eof()) {
      if (markers.some((m) => this.startsWith(m))) break;

      if (this.startsWith("<!--")) {
        this.skipComment();
        continue;
      }
      if (this.startsWith("{#if") || this.startsWith("{#each") || this.startsWith("{#include")) {
        nodes.push(this.parseDirective());
        continue;
      }
      if (this.startsWith("{#")) {
        // comment or unknown — parseDirective handles
        const node = this.parseDirective();
        if (node.type !== "Text" || node.value) nodes.push(node);
        continue;
      }
      if (this.startsWith("{{")) {
        nodes.push(this.parseInterp());
        continue;
      }
      if (this.startsWith("</")) break;
      if (this.peek() === "<" && /[A-Za-z]/.test(this.peek(1))) {
        nodes.push(this.parseTag());
        continue;
      }
      // Text until next special or marker
      const start = this.i;
      while (!this.eof()) {
        if (markers.some((m) => this.startsWith(m))) break;
        if (this.startsWith("{{") || this.startsWith("{#") || this.startsWith("<!--")) break;
        if (this.peek() === "<") break;
        this.i += 1;
      }
      if (this.i > start) {
        nodes.push({ type: "Text", value: this.source.slice(start, this.i) });
      } else if (!this.eof() && !markers.some((m) => this.startsWith(m))) {
        // Stuck on unexpected char
        throw this.error(`Unexpected character '${this.peek()}'`);
      }
    }
    return nodes;
  }

  /**
   * @param {number} index
   * @returns {EachNode}
   */
  parseEach(index) {
    this.i += 6; // {#each
    const closeBrace = this.source.indexOf("}", this.i);
    if (closeBrace === -1) throw this.error("Unterminated {#each}", index);
    const head = this.source.slice(this.i, closeBrace).trim();
    // `items as item` or `items as item, i`
    const asMatch = head.match(/^(.+?)\s+as\s+([A-Za-z_$][\w$]*)\s*(?:,\s*([A-Za-z_$][\w$]*))?\s*$/);
    if (!asMatch) {
      throw this.error(
        'Invalid {#each}: expected `{#each items as item}` or `{#each items as item, i}`',
        index,
      );
    }
    const list = parseExpr(asMatch[1].trim(), 0, asMatch[1].trim().length, {
      file: this.file,
      templateSource: this.source,
      templateIndex: this.i,
    });
    this.i = closeBrace + 1;
    const children = this.parseNodesUntil(["{/each}"]);
    if (!this.startsWith("{/each}")) {
      throw this.error("Expected {/each}", this.i);
    }
    this.i += "{/each}".length;
    return {
      type: "Each",
      list,
      item: asMatch[2],
      indexName: asMatch[3] ?? null,
      children,
      index,
    };
  }

  /**
   * @param {number} index
   * @returns {IncludeNode}
   */
  parseInclude(index) {
    this.i += 9; // {#include
    const closeBrace = this.source.indexOf("}", this.i);
    if (closeBrace === -1) throw this.error("Unterminated {#include}", index);
    const raw = this.source.slice(this.i, closeBrace).trim();
    const strMatch = raw.match(/^["']([^"']+)["']$/);
    if (!strMatch) {
      throw this.error('{#include} path must be a string literal', index);
    }
    this.i = closeBrace + 1;
    return { type: "Include", path: strMatch[1], index };
  }

  /** @returns {ElementNode | ComponentNode} */
  parseTag() {
    const index = this.i;
    this.i += 1; // <
    const nameStart = this.i;
    while (!this.eof() && /[A-Za-z0-9_-]/.test(this.peek())) this.i += 1;
    const name = this.source.slice(nameStart, this.i);
    if (!name) throw this.error("Expected tag name", index);

    const attrs = this.parseAttrs();
    this.skipWs();

    let selfClosing = false;
    if (this.startsWith("/>")) {
      selfClosing = true;
      this.i += 2;
    } else if (this.peek() === ">") {
      this.i += 1;
    } else {
      throw this.error("Expected '>' or '/>'", this.i);
    }

    const component = isComponentTag(name);
    const voidEl = !component && VOID.has(name.toLowerCase());

    /** @type {AstNode[]} */
    let children = [];
    if (!selfClosing && !voidEl) {
      children = this.parseNodesUntil([`</${name}>`]);
      // Also allow parseNodes style — check closing tag
      if (!this.startsWith(`</${name}>`)) {
        // try case-sensitive exact
        throw this.error(`Expected </${name}>`, this.i);
      }
      this.i += `</${name}>`.length;
    }

    if (component) {
      return { type: "Component", name, attrs, children, selfClosing, index };
    }
    return {
      type: "Element",
      name,
      attrs,
      children,
      selfClosing: selfClosing || voidEl,
      index,
    };
  }

  skipWs() {
    while (!this.eof() && /\s/.test(this.peek())) this.i += 1;
  }

  /** @returns {AttrNode[]} */
  parseAttrs() {
    /** @type {AttrNode[]} */
    const attrs = [];
    for (;;) {
      this.skipWs();
      if (this.peek() === ">" || this.startsWith("/>") || this.eof()) break;

      const index = this.i;
      let bound = false;
      if (this.peek() === ":") {
        bound = true;
        this.i += 1;
      }

      if (!/[A-Za-z_]/.test(this.peek())) {
        throw this.error("Expected attribute name", this.i);
      }
      const nameStart = this.i;
      while (!this.eof() && /[A-Za-z0-9_:-]/.test(this.peek())) this.i += 1;
      let name = this.source.slice(nameStart, this.i);
      // Strip leading colon already handled; name may include data-*
      if (bound && name.startsWith(":")) name = name.slice(1);

      this.skipWs();
      if (this.peek() !== "=") {
        attrs.push({
          name,
          value: null,
          expr: null,
          bound: false,
          boolean: true,
          index,
        });
        continue;
      }
      this.i += 1;
      this.skipWs();

      if (bound) {
        // :name="expr" or :name='expr'
        const quote = this.peek();
        if (quote !== '"' && quote !== "'") {
          throw this.error("Bound attribute value must be quoted", this.i);
        }
        this.i += 1;
        const end = this.source.indexOf(quote, this.i);
        if (end === -1) throw this.error("Unterminated attribute value", index);
        const exprSrc = this.source.slice(this.i, end).trim();
        const expr = parseExpr(exprSrc, 0, exprSrc.length, {
          file: this.file,
          templateSource: this.source,
          templateIndex: this.i,
        });
        this.i = end + 1;
        attrs.push({ name, value: null, expr, bound: true, boolean: false, index });
        continue;
      }

      // Literal attribute
      const quote = this.peek();
      if (quote === '"' || quote === "'") {
        this.i += 1;
        const end = this.source.indexOf(quote, this.i);
        if (end === -1) throw this.error("Unterminated attribute value", index);
        const value = this.source.slice(this.i, end);
        this.i = end + 1;
        // Allow {{ }} inside attribute values? Skip for v1 — use :bind
        if (value.includes("{{")) {
          throw this.error(
            `Interpolation inside attribute "${name}" is not supported; use :${name}="..."`,
            index,
          );
        }
        attrs.push({ name, value, expr: null, bound: false, boolean: false, index });
        continue;
      }

      // Unquoted
      const vStart = this.i;
      while (!this.eof() && !/[\s>]/.test(this.peek()) && !this.startsWith("/>")) {
        this.i += 1;
      }
      const value = this.source.slice(vStart, this.i);
      attrs.push({ name, value, expr: null, bound: false, boolean: false, index });
    }
    return attrs;
  }
}
