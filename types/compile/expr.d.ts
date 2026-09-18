export type LiteralNode = {
    type: 'Literal';
    value: string | number | boolean | null;
    raw: string;
};
export type IdentNode = {
    type: 'Ident';
    name: string;
};
export type MemberNode = {
    type: 'Member';
    object: ExprNode;
    property: string;
    optional: boolean;
};
export type IndexNode = {
    type: 'Index';
    object: ExprNode;
    index: ExprNode;
    optional: boolean;
};
export type UnaryNode = {
    type: 'Unary';
    op: '!' | '-';
    argument: ExprNode;
};
export type BinaryNode = {
    type: 'Binary';
    op: string;
    left: ExprNode;
    right: ExprNode;
};
export type CondNode = {
    type: 'Cond';
    test: ExprNode;
    consequent: ExprNode;
    alternate: ExprNode;
};
export type ExprNode = LiteralNode | IdentNode | MemberNode | IndexNode | UnaryNode | BinaryNode | CondNode;
/**
 * @param {string} source
 * @param {number} start
 * @param {number} end
 * @param {{ file?: string, templateSource?: string, templateIndex?: number }} [meta]
 * @returns {ExprNode}
 */
export declare function parseExpr(source: string, start?: number, end?: number, meta?: {
    file?: string;
    templateSource?: string;
    templateIndex?: number;
}): ExprNode;
/**
 * İfadeyi JS kaynak metnine çevirir. `locals` içindeki isimler çıplak kalır;
 * diğerleri `data.` öneki alır.
 *
 * @param {ExprNode} node
 * @param {Set<string>} [locals]
 * @returns {string}
 */
export declare function codegenExpr(node: ExprNode, locals?: Set<string>): string;
/**
 * İfadede geçen kök tanımlayıcılar (data alanları / local adayları).
 * @param {ExprNode} node
 * @param {Set<string>} [out]
 * @returns {Set<string>}
 */
export declare function collectIdents(node: ExprNode, out?: Set<string>): Set<string>;
