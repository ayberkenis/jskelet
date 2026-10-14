export type AstNode = import('./parse.js').AstNode;
export type AttrNode = import('./parse.js').AttrNode;
/**
 * @param {AstNode[]} ast
 * @param {{ viewId: string, file?: string, knownComponents?: Set<string> }} options
 * @returns {{ code: string, includes: string[], components: string[] }}
 */
export declare function codegen(ast: AstNode[], options: {
    viewId: string;
    file?: string;
    knownComponents?: Set<string>;
}): {
    code: string;
    includes: string[];
    components: string[];
};
/**
 * Include yolunu view id'ye çevir (uzantısız, `/` ayırıcılı).
 * @param {string} includePath
 * @returns {string}
 */
export declare function normalizeIncludeId(includePath: string): string;
/**
 * `market-hero` / `MarketHero` → `MarketHero`
 * @param {string} name
 * @returns {string}
 */
export declare function toPascalCase(name: string): string;
/**
 * Şablon girintisini düşür: satır sonu içeren salt-whitespace → boş;
 * yalnızca boşluk/tab → tek boşluk (inline aralık). Koruma alanı dışında.
 *
 * @param {string} value
 * @param {boolean} preserve
 * @returns {string}
 */
export declare function collapseTemplateWhitespace(value: string, preserve: boolean): string;
