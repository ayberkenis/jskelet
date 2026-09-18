/** Island'ların paylaştığı küçük DOM yardımcıları. */
/**
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLElement | null}
 */
export declare function qs(root: ParentNode, selector: string): HTMLElement | null;
/**
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLElement[]}
 */
export declare function qsa(root: ParentNode, selector: string): HTMLElement[];
/**
 * Otomatik temizlenebilir listener.
 * @param {EventTarget} target
 * @param {string} type
 * @param {EventListenerOrEventListenerObject} handler
 * @param {AddEventListenerOptions | boolean} [options]
 * @returns {() => void}
 */
export declare function on(target: EventTarget, type: string, handler: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): () => void;
/**
 * `data-*` üzerinden delege edilmiş click.
 * @param {HTMLElement} root
 * @param {string} selector
 * @param {(event: MouseEvent, target: HTMLElement) => void} handler
 * @returns {() => void}
 */
export declare function onClick(root: HTMLElement, selector: string, handler: (event: MouseEvent, target: HTMLElement) => void): () => void;
/**
 * @param {number} ms
 * @param {(...args: any[]) => void} fn
 * @returns {(...args: any[]) => void}
 */
export declare function debounce(ms: number, fn: (...args: any[]) => void): (...args: any[]) => void;
/**
 * requestAnimationFrame ile birleştirilmiş çağrı.
 * @param {() => void} fn
 * @returns {() => void}
 */
export declare function raf(fn: () => void): () => void;
/**
 * @param {HTMLElement} element
 * @param {string} name
 * @param {boolean} active
 */
export declare function toggleClass(element: HTMLElement, name: string, active: boolean): void;
/**
 * Overlay portal hedefi: layout'ta `<div id="jskelet-overlays">` varsa
 * modal/drawer içeriği oraya taşınır, yoksa `body`ye. Portal, `overflow`
 * ya da `transform` taşıyan bir ata elementin `position: fixed` overlay'i
 * kırpmasını engeller.
 */
export declare function getOverlayRoot(): HTMLElement;
