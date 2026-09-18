export type AstNode = import('./parse.js').AstNode;
export type AttrNode = import('./parse.js').AttrNode;
/**
 * @typedef {import('./parse.js').AstNode} AstNode
 * @typedef {import('./parse.js').AttrNode} AttrNode
 */
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
