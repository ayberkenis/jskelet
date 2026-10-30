/**
 * JSkelet island runtime'ının tarayıcı tarafı API'si.
 *
 * `client/entries/main.js` (veya `main.ts`) içinde:
 *
 *   import { registerAll, start } from "jskelet/client";
 *
 *   registerAll({
 *     counter: () => import("../islands/counter.ts"),
 *   });
 *
 *   start({ drive: true });
 */
export { register, registerAll, hydrate, unmount, observeDocument, start, } from "./registry.js";
export { swap, startSwapLinks } from "./swap.js";
export { startDrive, driveTo } from "./drive.js";
export { enhanceForm, startForms } from "./form.js";
export { createStore } from "./store.js";
export { debounce, on, onClick, qs, qsa, raf, toggleClass, getOverlayRoot, } from "./dom.js";
export { startSafeImages } from "./safe-image.js";
export { clearSharedCookie, consumeWindowNameHandoff, createHandoffUrl, handoffViaWindowName, readCookie, resolveSharedCookieDomain, SHARED_COOKIE_WARN_BYTES, writeSharedCookie, } from "./shared-cookie.js";
