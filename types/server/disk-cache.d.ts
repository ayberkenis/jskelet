/**
 * @param {string | null} root Mutlak dizin, ya da config yoluna dönmek için `null`.
 */
export declare function setDiskCacheRootForTests(root: string | null): void;
/**
 * @param {"html" | "data"} kind
 * @returns {boolean}
 */
export declare function diskShares(kind: "html" | "data"): boolean;
/**
 * @param {"html" | "data"} kind
 * @param {string} key
 * @returns {Promise<unknown | null>}
 */
export declare function diskGetJson(kind: "html" | "data", key: string): Promise<unknown | null>;
/**
 * Ateşle-unut. Dönüş değeri testler bekleyebilsin diye durur; istek yolu
 * beklemez.
 *
 * @param {"html" | "data"} kind
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
export declare function diskSetJson(kind: "html" | "data", key: string, value: unknown): Promise<void>;
/**
 * @param {"html" | "data"} kind
 * @param {string[]} keys
 */
export declare function diskDrop(kind: "html" | "data", keys: string[]): void;
/**
 * @param {"html" | "data"} kind
 * @param {(key: string) => boolean} [match] Verilmezse türün tamamı silinir.
 * @returns {Promise<number>}
 */
export declare function diskDropMatching(kind: "html" | "data", match?: (key: string) => boolean): Promise<number>;
