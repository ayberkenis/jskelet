/**
 * AST → ESM kaynak metni. `eval` / `new Function` yok; çıktı diskteki
 * `.mjs` dosyasına yazılır ve runtime'da normal `import` ile yüklenir.
 */
import { codegenExpr } from "./expr.js";
import { CompileError } from "./errors.js";

/**
 * @typedef {import('./parse.js').AstNode} AstNode
 * @typedef {import('./parse.js').AttrNode} AttrNode
 */

/**
 * @param {AstNode[]} ast
 * @param {{ viewId: string, file?: string, knownComponents?: Set<string> }} options
 * @returns {{ code: string, includes: string[], components: string[] }}
 */
export function codegen(ast, options) {
  const ctx = new CodegenContext(options);
  ctx.emitNodes(ast);
  return {
    code: ctx.finish(),
    includes: [...ctx.includes],
    components: [...ctx.components],
  };
}

/**
 * Include yolunu view id'ye çevir (uzantısız, `/` ayırıcılı).
 * @param {string} includePath
 * @returns {string}
 */
export function normalizeIncludeId(includePath) {
  return includePath.replace(/\\/g, "/").replace(/\.jsk$/i, "").replace(/^\.\//, "");
}

/**
 * `market-hero` / `MarketHero` → `MarketHero`
 * @param {string} name
 * @returns {string}
 */
export function toPascalCase(name) {
  if (/^[A-Z]/.test(name) && !name.includes("-")) return name;
  return name
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

class CodegenContext {
  /**
   * @param {{ viewId: string, file?: string, knownComponents?: Set<string> }} options
   */
  constructor(options) {
    this.viewId = options.viewId;
    this.file = options.file;
    this.knownComponents = options.knownComponents ?? null;
    /** @type {Set<string>} */
    this.includes = new Set();
    /** @type {Set<string>} */
    this.components = new Set();
    /** @type {string[]} */
    this.body = [];
    this.indent = 1;
    this.temp = 0;
    /** @type {Set<string>} */
    this.locals = new Set();
    /** Çocuk gövdesinde `s` yerine kullanılacak değişken. */
    this.outVar = "s";
  }

  /**
   * @param {string} line
   */
  line(line) {
    this.body.push(`${"  ".repeat(this.indent)}${line}`);
  }

  /**
   * @param {string} exprJs
   */
  append(exprJs) {
    this.line(`${this.outVar} += ${exprJs};`);
  }

  /** @returns {string} */
  nextTemp() {
    this.temp += 1;
    return `__c${this.temp}`;
  }

  /**
   * @param {AstNode[]} nodes
   */
  emitNodes(nodes) {
    for (const node of nodes) this.emit(node);
  }

  /**
   * @param {AstNode} node
   */
  emit(node) {
    switch (node.type) {
      case "Text":
        if (node.value) this.append(JSON.stringify(node.value));
        break;
      case "Interp": {
        const expr = codegenExpr(node.expr, this.locals);
        if (node.raw) this.append(`(${expr} ?? "")`);
        else this.append(`helpers.esc(${expr})`);
        break;
      }
      case "Element":
        this.emitElement(node);
        break;
      case "Component":
        this.emitComponent(node);
        break;
      case "If":
        this.emitIf(node);
        break;
      case "Each":
        this.emitEach(node);
        break;
      case "Include":
        this.emitInclude(node);
        break;
      default:
        break;
    }
  }

  /**
   * @param {import('./parse.js').ElementNode} node
   */
  emitElement(node) {
    const bound = node.attrs.some((a) => a.bound);
    if (bound) {
      this.append(
        `"<${node.name}" + helpers.attrs({${this.attrsObject(node.attrs)}}) + ">"`,
      );
    } else {
      this.append(JSON.stringify(`<${node.name}${staticAttrString(node.attrs)}>`));
    }

    if (!node.selfClosing) {
      this.emitNodes(node.children);
      this.append(JSON.stringify(`</${node.name}>`));
    }
  }

  /**
   * @param {AttrNode[]} attrs
   * @returns {string}
   */
  attrsObject(attrs) {
    return attrs
      .map((attr) => {
        const key = JSON.stringify(attr.name);
        if (attr.boolean && !attr.bound) return `${key}: true`;
        if (attr.bound && attr.expr) {
          return `${key}: ${codegenExpr(attr.expr, this.locals)}`;
        }
        return `${key}: ${JSON.stringify(attr.value ?? true)}`;
      })
      .join(", ");
  }

  /**
   * @param {import('./parse.js').ComponentNode} node
   */
  emitComponent(node) {
    if (this.knownComponents && !this.knownComponents.has(node.name)) {
      throw new CompileError(`Unknown component "${node.name}"`, {
        file: this.file,
        index: node.index,
      });
    }
    this.components.add(node.name);

    const props = this.attrsObject(node.attrs);

    if (node.children.length) {
      const tmp = this.nextTemp();
      this.line(`{`);
      this.indent += 1;
      this.line(`let ${tmp} = "";`);
      const prevOut = this.outVar;
      this.outVar = tmp;
      this.emitNodes(node.children);
      this.outVar = prevOut;
      const propsWithChildren = props
        ? `${props}, children: ${tmp}`
        : `children: ${tmp}`;
      this.append(`(helpers.${node.name}({ ${propsWithChildren} }) ?? "")`);
      this.indent -= 1;
      this.line(`}`);
    } else {
      this.append(`(helpers.${node.name}({ ${props} }) ?? "")`);
    }
  }

  /**
   * @param {import('./parse.js').IfNode} node
   */
  emitIf(node) {
    const test = codegenExpr(node.test, this.locals);
    this.line(`if (${test}) {`);
    this.indent += 1;
    this.emitNodes(node.consequent);
    this.indent -= 1;
    if (node.alternate.length) {
      this.line(`} else {`);
      this.indent += 1;
      this.emitNodes(node.alternate);
      this.indent -= 1;
    }
    this.line(`}`);
  }

  /**
   * @param {import('./parse.js').EachNode} node
   */
  emitEach(node) {
    const list = codegenExpr(node.list, this.locals);
    const idx = node.indexName ?? `__i${++this.temp}`;
    this.line(`{`);
    this.indent += 1;
    this.line(`const __list = ${list} ?? [];`);
    this.line(`for (let ${idx} = 0; ${idx} < __list.length; ${idx}++) {`);
    this.indent += 1;
    this.line(`const ${node.item} = __list[${idx}];`);
    const prev = new Set(this.locals);
    this.locals.add(node.item);
    this.locals.add(idx);
    if (node.indexName) this.locals.add(node.indexName);
    this.emitNodes(node.children);
    this.locals = prev;
    this.indent -= 1;
    this.line(`}`);
    this.indent -= 1;
    this.line(`}`);
  }

  /**
   * @param {import('./parse.js').IncludeNode} node
   */
  emitInclude(node) {
    const id = normalizeIncludeId(node.path);
    this.includes.add(id);
    const alias = includeAlias(id);
    this.append(`(${alias}(data, helpers) ?? "")`);
  }

  /** @returns {string} */
  finish() {
    const imports = [...this.includes]
      .map((id) => {
        const alias = includeAlias(id);
        const rel = relativeImport(this.viewId, id);
        return `import { render as ${alias} } from ${JSON.stringify(rel)};`;
      })
      .join("\n");

    const parts = [
      "/** @generated by jskelet — do not edit */",
      imports,
      "/**",
      " * @param {Record<string, unknown>} data",
      " * @param {Record<string, any>} helpers",
      " * @returns {string}",
      " */",
      "export function render(data, helpers) {",
      '  let s = "";',
      ...this.body,
      "  return s;",
      "}",
      "",
    ];

    return parts.filter((l, i) => !(l === "" && i === 1 && !imports)).join("\n");
  }
}

/**
 * @param {AttrNode[]} attrs
 * @returns {string}
 */
function staticAttrString(attrs) {
  let out = "";
  for (const attr of attrs) {
    if (attr.boolean) {
      out += ` ${attr.name}`;
      continue;
    }
    out += ` ${attr.name}="${escapeAttr(attr.value ?? "")}"`;
  }
  return out;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/**
 * @param {string} id
 * @returns {string}
 */
function includeAlias(id) {
  return `__inc_${id.replace(/[^A-Za-z0-9]/g, "_")}`;
}

/**
 * @param {string} fromViewId
 * @param {string} toViewId
 * @returns {string}
 */
function relativeImport(fromViewId, toViewId) {
  const fromParts = fromViewId.split("/");
  fromParts.pop();
  const depth = fromParts.length;
  const prefix = depth === 0 ? "./" : "../".repeat(depth);
  return `${prefix}${toViewId}.mjs`;
}
