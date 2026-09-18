/**
 * @param {string} root Uygulama kökü.
 * @param {string} specifier
 * @returns {Promise<any>}
 * @throws Paket bulunamazsa; zorunlu bağımlılıklar için.
 */
export declare function importFromApp(root: string, specifier: string): Promise<any>;
/**
 * @param {string} root
 * @param {string} specifier
 * @returns {Promise<any | null>} Paket yoksa `null`; adım atlanabilsin diye.
 */
export declare function tryImportFromApp(root: string, specifier: string): Promise<any | null>;
