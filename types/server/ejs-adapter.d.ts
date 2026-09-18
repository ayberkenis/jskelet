/**
 * @returns {Promise<import('ejs')>}
 */
export declare function loadEjs(): Promise<import('ejs')>;
/**
 * @param {string} file
 * @param {Record<string, unknown>} data
 * @param {object} options
 * @returns {Promise<string>}
 */
export declare function renderEjsFile(file: string, data: Record<string, unknown>, options: object): Promise<string>;
