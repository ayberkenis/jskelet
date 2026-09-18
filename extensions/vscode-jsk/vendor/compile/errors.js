/**
 * Şablon derleme hataları. Satır/sütun korunur ki DX overlay ve CLI
 * çıktısı kaynağa işaret edebilsin.
 */

/**
 * @param {string} source
 * @param {number} index
 * @returns {{ line: number, column: number }}
 */
export function indexToLocation(source, index) {
  let line = 1;
  let column = 1;
  const end = Math.min(index, source.length);
  for (let i = 0; i < end; i++) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

/**
 * @param {string} source
 * @param {number} line
 * @returns {string}
 */
function lineSnippet(source, line) {
  const lines = source.split(/\r?\n/);
  return lines[line - 1] ?? "";
}

export class CompileError extends Error {
  /**
   * @param {string} message
   * @param {{ file?: string, source?: string, index?: number,
   *   line?: number, column?: number }} [opts]
   */
  constructor(message, opts = {}) {
    let line = opts.line;
    let column = opts.column;
    if ((line == null || column == null) && opts.source != null && opts.index != null) {
      const loc = indexToLocation(opts.source, opts.index);
      line = loc.line;
      column = loc.column;
    }

    const where =
      opts.file && line != null
        ? `${opts.file}:${line}:${column ?? 1}`
        : opts.file ?? "";
    const snippet =
      opts.source && line != null ? lineSnippet(opts.source, line).trimEnd() : "";
    const head = where ? `${where}\n` : "";
    const body = snippet ? `${message}\n\n  ${snippet}\n  ${" ".repeat((column ?? 1) - 1)}^` : message;

    super(`${head}${body}`);
    this.name = "CompileError";
    this.file = opts.file;
    this.line = line;
    this.column = column;
  }
}
