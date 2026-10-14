/**
 * React `cache()` fonksiyonunun karşılığı: aynı istek içinde aynı argümanlarla
 * yapılan çağrılar tek kez çalışır. İstek bağlamı yoksa (script, client)
 * memoizasyon devre dışı kalır ve fonksiyon doğrudan çağrılır.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** @type {AsyncLocalStorage<Map<unknown, Map<string, unknown>>>} */
const storage = new AsyncLocalStorage();

/**
 * İsteği bir memo bağlamı içinde çalıştırır.
 * @param {() => T} run
 * @returns {T}
 * @template T
 */
export function withRequestCache(run) {
  return storage.run(new Map(), run);
}

/**
 * Sık görülen ilkel argümanlarda `JSON.stringify` atlanır.
 *
 * @param {unknown[]} args
 * @returns {string}
 */
function argsKey(args) {
  if (args.length === 0) return "";
  if (args.length === 1) {
    const value = args[0];
    const type = typeof value;
    if (value == null) return `\0${value}`;
    if (type === "string") return `\0s:${value}`;
    if (type === "number" || type === "boolean") return `\0${type}:${value}`;
  }
  return JSON.stringify(args);
}

/**
 * @param {F} fn
 * @returns {F}
 * @template {(...args: any[]) => any} F
 */
export function cache(fn) {
  const wrapped = (...args) => {
    const contextStore = storage.getStore();
    if (!contextStore) return fn(...args);

    let perFn = contextStore.get(fn);
    if (!perFn) {
      perFn = new Map();
      contextStore.set(fn, perFn);
    }

    const key = argsKey(args);
    if (perFn.has(key)) return perFn.get(key);

    const result = fn(...args);
    perFn.set(key, result);
    return result;
  };

  return /** @type {F} */ (wrapped);
}
