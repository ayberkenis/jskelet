/**
 * @param {{ root: string, dirs: Record<string, string> }} config
 * @param {{ quiet?: boolean }} [options]
 * @returns {Promise<{ count: number, manifest: Record<string, string>, outDir: string }>}
 */
export declare function compileAll(config: {
    root: string;
    dirs: Record<string, string>;
}, options?: {
    quiet?: boolean;
}): Promise<{
    count: number;
    manifest: Record<string, string>;
    outDir: string;
}>;
/**
 * Manifest yoksa veya herhangi bir `.jsk` daha yeniyse yeniden derler.
 * Dev sunucu restart'ında build watch kaçırmış olsa bile şablonlar güncel kalır.
 *
 * @param {{ root: string, dirs: Record<string, string> }} config
 * @returns {Promise<{ count: number, rebuilt: boolean }>}
 */
export declare function ensureTemplatesCompiled(config: {
    root: string;
    dirs: Record<string, string>;
}): Promise<{
    count: number;
    rebuilt: boolean;
}>;
/**
 * Tek kaynak dizgisini derler (birim testleri).
 * @param {string} source
 * @param {{ viewId?: string, file?: string, knownComponents?: Set<string> }} [options]
 * @returns {{ code: string, includes: string[], components: string[] }}
 */
export declare function compileSource(source: string, options?: {
    viewId?: string;
    file?: string;
    knownComponents?: Set<string>;
}): {
    code: string;
    includes: string[];
    components: string[];
};
