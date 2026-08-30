/**
 * JSkelet island runtime'ının tarayıcı tarafı API'si.
 *
 * `client/entries/main.js` içinde:
 *
 *   import { registerAll, start } from "jskelet/client";
 *
 *   registerAll({
 *     counter: () => import("../islands/counter.js"),
 *   });
 *
 *   start();
 */
export {
  register,
  registerAll,
  hydrate,
  unmount,
  observeDocument,
  start,
} from "./registry.js";
export { swap, startSwapLinks } from "./swap.js";
export { enhanceForm, startForms } from "./form.js";
export { createStore } from "./store.js";
export {
  debounce,
  on,
  onClick,
  qs,
  qsa,
  raf,
  toggleClass,
  getOverlayRoot,
} from "./dom.js";
export { startSafeImages } from "./safe-image.js";
