/**
 * `run`'ı, içindeki `recordDependency()` çağrılarının `deps`'e yazacağı bir
 * bağlamda çalıştırır.
 *
 * @template T
 * @param {Set<string>} deps
 * @param {() => T} run
 * @returns {T}
 */
export declare function collectDependencies<T>(deps: Set<string>, run: () => T): T;
/**
 * Bu render'ın bir veri anahtarını okuduğunu bildirir. Bağlam yoksa no-op.
 *
 * @param {string} key
 */
export declare function recordDependency(key: string): void;
