/**
 * React Context yerine kullanılan minimal pub/sub store.
 * `useSyncExternalStore` köprüsünün yerini alır: doğrudan `subscribe`.
 */
/**
 * @param {T} initial
 * @returns {{
 *   get: () => T,
 *   set: (next: T | ((prev: T) => T)) => void,
 *   subscribe: (listener: (value: T) => void) => () => void,
 * }}
 * @template T
 */
export declare function createStore<T>(initial: T): {
    get: () => T;
    set: (next: T | ((prev: T) => T)) => void;
    subscribe: (listener: (value: T) => void) => () => void;
};
