/**
 * Build-time `.jsk` derleyici yüzeyi.
 */
export { CompileError, indexToLocation } from "./errors.js";
export { parseExpr, codegenExpr } from "./expr.js";
export { parseTemplate, isComponentTag } from "./parse.js";
export { codegen, toPascalCase, normalizeIncludeId } from "./codegen.js";
export {
  getViewRoots,
  getComponentDirs,
  discoverJskFiles,
  componentNameFromViewId,
  collectKnownComponents,
} from "./resolve.js";
export { compileAll, compileSource, ensureTemplatesCompiled } from "./compile-all.js";
