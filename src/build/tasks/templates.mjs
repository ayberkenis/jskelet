/**
 * `.jsk` şablonlarını `.jskelet/templates/` altına derler.
 * Asset pipeline'dan önce çalışır; Tailwind/ikon taraması kaynak `.jsk`'yi okur.
 */
import { compileAll } from "../../compile/compile-all.js";
import * as log from "../../log.mjs";

/**
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @returns {Promise<number>} Derlenen dosya sayısı.
 */
export async function buildTemplates(config) {
  const result = await compileAll(config);
  if (result.count === 0) {
    log.line("no .jsk templates");
  } else {
    log.line(`${result.count} template${result.count === 1 ? "" : "s"} → .jskelet/templates`);
  }
  return result.count;
}
