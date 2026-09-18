export type ExprNode = import('./expr.js').ExprNode;
export type TextNode = {
    type: 'Text';
    value: string;
};
export type InterpNode = {
    type: 'Interp';
    expr: ExprNode;
    raw: boolean;
    index: number;
};
export type AttrNode = {
    name: string;
    value: string | null;
    expr: ExprNode | null;
    bound: boolean;
    boolean: boolean;
    index: number;
};
export type ElementNode = {
    type: 'Element';
    name: string;
    attrs: AttrNode[];
    children: AstNode[];
    selfClosing: boolean;
    index: number;
};
export type ComponentNode = {
    type: 'Component';
    name: string;
    attrs: AttrNode[];
    children: AstNode[];
    selfClosing: boolean;
    index: number;
};
export type IfNode = {
    type: 'If';
    test: ExprNode;
    consequent: AstNode[];
    alternate: AstNode[];
    index: number;
};
export type EachNode = {
    type: 'Each';
    list: ExprNode;
    item: string;
    indexName: string | null;
    children: AstNode[];
    index: number;
};
export type IncludeNode = {
    type: 'Include';
    path: string;
    index: number;
};
export type AstNode = TextNode | InterpNode | ElementNode | ComponentNode | IfNode | EachNode | IncludeNode;
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
export declare function parseTemplate(source: string, options?: {
    file?: string;
}): AstNode[];
/**
 * PascalCase bileşen mi?
 * @param {string} name
 * @returns {boolean}
 */
export declare function isComponentTag(name: string): boolean;
