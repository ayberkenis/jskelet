/**
 * Next.js / React kaynak dosyalarını Babel ile parse eder (JSX + TS).
 *
 * `@babel/parser` opsiyonel peerdır; yoksa `getBabel()` kurulum mesajı fırlatır.
 */
import { getBabel } from "./babel.mjs";

/**
 * @param {string} code
 * @param {string} [filename]
 * @returns {import('@babel/types').File}
 */
export function parseSource(code, filename = "file.tsx") {
  const { parse } = getBabel();
  return parse(code, {
    sourceType: "module",
    sourceFilename: filename,
    plugins: [
      "jsx",
      "typescript",
      "importAttributes",
      "topLevelAwait",
    ],
    errorRecovery: false,
  });
}
