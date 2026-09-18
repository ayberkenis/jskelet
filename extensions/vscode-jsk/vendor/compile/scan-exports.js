/**
 * Kaynak metinden named export adlarını çıkarır — modülü çalıştırmadan.
 * Compile-time bilinen bileşen listesi için; `default` yok sayılır.
 */

/**
 * Yorumları kaba şekilde siler; string içindeki sahte eşleşmeler nadirdir.
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * `export { a, b as C, default as X }` listesinden dışa verilen adları toplar.
 * @param {string} clause
 * @param {Set<string>} out
 */
function addExportList(clause, out) {
  for (const part of clause.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const bits = trimmed.split(/\s+as\s+/i);
    const exported = (bits[1] ?? bits[0]).trim();
    if (!exported || exported === "default") continue;
    out.add(exported);
  }
}

/**
 * @param {string} source
 * @returns {string[]}
 */
export function scanNamedExports(source) {
  const text = stripComments(source);
  /** @type {Set<string>} */
  const names = new Set();

  for (const match of text.matchAll(
    /\bexport\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]);
  }

  for (const match of text.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    addExportList(match[1], names);
  }

  return [...names];
}
