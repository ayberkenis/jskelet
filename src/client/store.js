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
export function createStore(initial) {
  let value = initial;
  /** @type {Set<(value: T) => void>} */
  const listeners = new Set();

  return {
    get: () => value,

    set(next) {
      const resolved =
        typeof next === "function" ? /** @type {Function} */ (next)(value) : next;
      if (resolved === value) return;
      value = resolved;
      for (const listener of listeners) listener(value);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
