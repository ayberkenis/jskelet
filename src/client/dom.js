/** Island'ların paylaştığı küçük DOM yardımcıları. */

/**
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLElement | null}
 */
export function qs(root, selector) {
  return /** @type {HTMLElement | null} */ (root.querySelector(selector));
}

/**
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLElement[]}
 */
export function qsa(root, selector) {
  return /** @type {HTMLElement[]} */ ([...root.querySelectorAll(selector)]);
}

/**
 * Otomatik temizlenebilir listener.
 * @param {EventTarget} target
 * @param {string} type
 * @param {EventListenerOrEventListenerObject} handler
 * @param {AddEventListenerOptions | boolean} [options]
 * @returns {() => void}
 */
export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/**
 * `data-*` üzerinden delege edilmiş click.
 * @param {HTMLElement} root
 * @param {string} selector
 * @param {(event: MouseEvent, target: HTMLElement) => void} handler
 * @returns {() => void}
 */
export function onClick(root, selector, handler) {
  return on(root, "click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target)?.closest(selector);
    if (!target || !root.contains(target)) return;
    handler(/** @type {MouseEvent} */ (event), /** @type {HTMLElement} */ (target));
  });
}

/**
 * @param {number} ms
 * @param {(...args: any[]) => void} fn
 * @returns {(...args: any[]) => void}
 */
export function debounce(ms, fn) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * requestAnimationFrame ile birleştirilmiş çağrı.
 * @param {() => void} fn
 * @returns {() => void}
 */
export function raf(fn) {
  let frame = 0;
  return () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fn();
    });
  };
}

/**
 * @param {HTMLElement} element
 * @param {string} name
 * @param {boolean} active
 */
export function toggleClass(element, name, active) {
  element.classList.toggle(name, active);
}

/**
 * Overlay portal hedefi: layout'ta `<div id="jskelet-overlays">` varsa
 * modal/drawer içeriği oraya taşınır, yoksa `body`ye. Portal, `overflow`
 * ya da `transform` taşıyan bir ata elementin `position: fixed` overlay'i
 * kırpmasını engeller.
 */
export function getOverlayRoot() {
  return document.getElementById("jskelet-overlays") ?? document.body;
}
