/**
 * Runtime'ın camelCase → PascalCase alias'ı ile aynı kural.
 * @param {string} name
 * @returns {string}
 */
export declare function toComponentTag(name: string): string;
/**
 * @param {{ root: string, dirs: Record<string, string> }} config
 * @returns {string[]} Mutlak view kökleri (var olanlar).
 */
export declare function getViewRoots(config: {
    root: string;
    dirs: Record<string, string>;
}): string[];
/**
 * Bileşen dizinleri: her view kökü altındaki `components/`.
 * @param {{ root: string, dirs: Record<string, string> }} config
 * @returns {string[]}
 */
export declare function getComponentDirs(config: {
    root: string;
    dirs: Record<string, string>;
}): string[];
/**
 * @param {string[]} viewRoots
 * @returns {Map<string, string>} viewId → mutlak `.jsk` yolu
 */
export declare function discoverJskFiles(viewRoots: string[]): Map<string, string>;
/**
 * `components/foo-bar.jsk` → `FooBar`
 * @param {string} viewId
 * @returns {string | null}
 */
export declare function componentNameFromViewId(viewId: string): string | null;
/**
 * Bilinen bileşen adları: JS named export'lar + derlenecek `.jsk` bileşenleri
 * + yerleşik etiketler.
 *
 * JS tarafında dosya adı varsayılmaz; kaynak metinden `export` adları okunur.
 * Aynı export (veya aynı PascalCase etiket) iki dosyada varsa derleme hatası.
 *
 * @param {string[]} componentDirs
 * @param {Map<string, string>} jskFiles
 * @returns {Set<string>}
 */
export declare function collectKnownComponents(componentDirs: string[], jskFiles: Map<string, string>): Set<string>;
