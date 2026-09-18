/**
 * İsteği bir memo bağlamı içinde çalıştırır.
 * @param {() => T} run
 * @returns {T}
 * @template T
 */
export declare function withRequestCache<T>(run: () => T): T;
/**
 * @param {F} fn
 * @returns {F}
 * @template {(...args: any[]) => any} F
 */
export declare function cache<F extends (...args: any[]) => any>(fn: F): F;
