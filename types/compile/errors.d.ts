/**
 * Şablon derleme hataları. Satır/sütun korunur ki DX overlay ve CLI
 * çıktısı kaynağa işaret edebilsin.
 */
/**
 * @param {string} source
 * @param {number} index
 * @returns {{ line: number, column: number }}
 */
export declare function indexToLocation(source: string, index: number): {
    line: number;
    column: number;
};
export declare class CompileError extends Error {
    file: string | undefined;
    line: number | undefined;
    column: number | undefined;
    /**
     * @param {string} message
     * @param {{ file?: string, source?: string, index?: number,
     *   line?: number, column?: number }} [opts]
     */
    constructor(message: string, opts?: {
        file?: string;
        source?: string;
        index?: number;
        line?: number;
        column?: number;
    });
}
