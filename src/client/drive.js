/**
 * Stimulus / Turbo Drive tarzı gezinme: belge gelir, controller host'u
 * yerinde kalır. Bir "içerik kuyusu" chunk'ı yok.
 *
 * `data-permanent` + `id` taşıyan düğüm (çatı, overlay, tema düğmesi) canlı
 * tutulur; `mount()` yeniden çalışmaz. Geri kalan DOM yeni belgeden gelir,
 * içindeki island'lar sökülüp yeniden bağlanır.
 *
 * `swap()` fragment ucuna gider (`X-Requested-With: fragment`). Drive tam
 * belge ister. `root` verilirse (Turbo Frame gibi) yalnızca o bölge
 * yazılır; verilmezse `body`.
 */
import { hydrate, unmount } from "./registry.js";

/**
 * @typedef {object} DriveOptions
 * @property {string} [root] Yazılacak bölge; varsayılan `"body"`.
 */

/**
 * @typedef {object} DriveToOptions
 * @property {"push" | "replace" | false} [history] Varsayılan `"push"`.
 * @property {number[]} [scroll] `[x, y]`; yoksa üste (hash varsa hedefe).
 */

/** @type {string | null} */
let activeRoot = null;

/** @type {AbortController | null} */
let inFlight = null;

const DEFAULT_ROOT = "body";

/**
 * `CSS.escape` Node test ortamında yok; id yalnızca seçicide kullanılıyor.
 *
 * @param {string} id
 * @returns {string}
 */
function escapeId(id) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(id);
  }
  return id.replace(/([^\w-])/g, "\\$1");
}

/**
 * @param {DriveOptions | string | boolean | undefined} options
 * @returns {string}
 */
function readRoot(options) {
  if (options === true || options == null) return DEFAULT_ROOT;
  if (typeof options === "string") return options.trim() || DEFAULT_ROOT;
  if (typeof options.root === "string" && options.root.trim()) {
    return options.root.trim();
  }
  return DEFAULT_ROOT;
}

/**
 * Bu tıklama drive'a ait mi? `data-swap` fragment takası, `data-no-drive`
 * tam sayfa, yeni sekme / indirme / origin dışı tarayıcıya bırakılır.
 *
 * @param {Event} event
 * @returns {URL | null}
 */
export function driveableUrl(event) {
  if (event.defaultPrevented) return null;
  if ("button" in event && event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

  const origin = /** @type {{ closest?: (sel: string) => Element | null } | null} */ (
    event.target
  );
  const anchor = origin?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;

  if (anchor.hasAttribute("download")) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if ("noDrive" in anchor.dataset) return null;
  if (anchor.closest("[data-swap]")) return null;

  let url;
  try {
    url = new URL(anchor.href, location.href);
  } catch {
    return null;
  }

  if (url.origin !== location.origin) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.pathname === location.pathname && url.search === location.search) {
    return null;
  }

  return url;
}

/**
 * @param {Document} parsed
 * @param {string} selector
 * @returns {Element | null}
 */
function findRoot(parsed, selector) {
  try {
    return parsed.querySelector(selector);
  } catch {
    return null;
  }
}

/**
 * Canlı `data-permanent[id]` düğümlerini ağaçtan ayır. İç içe olanlar
 * dışarıdakinin içinde kalır; iki kez taşınmasın.
 *
 * @param {ParentNode} root
 * @returns {HTMLElement[]}
 */
export function collectPermanent(root) {
  /** @type {HTMLElement[]} */
  const kept = [];
  for (const node of [...root.querySelectorAll("[data-permanent][id]")]) {
    const el = /** @type {HTMLElement} */ (node);
    if (kept.some((live) => live.contains(el))) continue;
    el.remove();
    kept.push(el);
  }
  return kept;
}

/**
 * Yeni ağaçtaki aynı `id` + `data-permanent` yuvasına canlı düğümü koy.
 * Yuva yoksa (yeni sayfa bu controller'ı istemiyor) sök.
 *
 * @param {ParentNode} root
 * @param {HTMLElement[]} kept
 */
export function restorePermanent(root, kept) {
  for (const live of kept) {
    const slot = root.querySelector(`#${escapeId(live.id)}`);
    const dataset = /** @type {HTMLElement} */ (slot)?.dataset;
    if (slot && typeof slot.replaceWith === "function" && dataset && "permanent" in dataset) {
      slot.replaceWith(live);
    } else {
      unmount(live);
    }
  }
}

/**
 * @param {HTMLElement} element
 * @param {string} html
 */
function replaceRegion(element, html) {
  const kept = collectPermanent(element);
  unmount(element);
  element.innerHTML = html;
  restorePermanent(element, kept);
  hydrate(element);
}

/**
 * @param {string} html
 * @param {string} selector
 * @returns {{ title: string, html: string, lang: string } | null}
 */
function readDrivenDocument(html, selector) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const next = findRoot(parsed, selector);
  if (!next) return null;
  return {
    title: parsed.title,
    html: next.innerHTML,
    lang: parsed.documentElement?.lang ?? "",
  };
}

/**
 * @param {string} href
 * @param {DriveToOptions} [options]
 * @returns {Promise<boolean>}
 */
export async function driveTo(href, options = {}) {
  const selector = activeRoot;
  if (!selector) {
    console.warn("[drive] startDrive() has not run");
    return false;
  }

  const element = /** @type {HTMLElement | null} */ (document.querySelector(selector));
  if (!element) {
    console.warn(`[drive] root not found: ${selector}`);
    return false;
  }

  const url = new URL(href, location.href);
  inFlight?.abort();
  inFlight = new AbortController();
  const { signal } = inFlight;

  element.setAttribute("aria-busy", "true");

  try {
    const response = await fetch(url.href, {
      method: "GET",
      credentials: "same-origin",
      headers: { accept: "text/html" },
      signal,
    });

    if (response.redirected && new URL(response.url).origin !== location.origin) {
      location.assign(response.url);
      return false;
    }

    if (!response.ok) {
      element.dispatchEvent(
        new CustomEvent("jskelet:drive-error", {
          bubbles: true,
          detail: { url: url.href, status: response.status },
        }),
      );
      return false;
    }

    const parsed = readDrivenDocument(await response.text(), selector);
    if (!parsed) {
      location.assign(response.url || url.href);
      return false;
    }

    replaceRegion(element, parsed.html);
    document.title = parsed.title;
    if (parsed.lang) document.documentElement.lang = parsed.lang;

    const historyMode = options.history === undefined ? "push" : options.history;
    if (historyMode === "push") {
      history.pushState({ jskeletDrive: true }, parsed.title, url.href);
    } else if (historyMode === "replace") {
      history.replaceState({ jskeletDrive: true }, parsed.title, url.href);
    }

    if (url.hash) {
      document.querySelector(url.hash)?.scrollIntoView();
    } else if (options.scroll) {
      window.scrollTo(options.scroll[0], options.scroll[1]);
    } else if (historyMode === "push") {
      window.scrollTo(0, 0);
    }

    element.dispatchEvent(
      new CustomEvent("jskelet:drive", {
        bubbles: true,
        detail: { url: url.href, title: parsed.title },
      }),
    );
    return true;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.error(`[drive] ${url.href}`, error);
      element.dispatchEvent(
        new CustomEvent("jskelet:drive-error", {
          bubbles: true,
          detail: { url: url.href, error },
        }),
      );
    }
    return false;
  } finally {
    if (inFlight?.signal === signal) inFlight = null;
    element.removeAttribute("aria-busy");
  }
}

/**
 * Aynı origin bağlantıları belge ziyaretine çevirir. `data-permanent`
 * controller host'ları sökülmez. `start({ drive: true })` bunu çağırır.
 *
 * @param {DriveOptions | string | boolean} [options]
 * @returns {() => void}
 */
export function startDrive(options = true) {
  const root = readRoot(options);
  activeRoot = root;

  /** @param {Event} event */
  const onClick = (event) => {
    const url = driveableUrl(event);
    if (!url) return;
    event.preventDefault();
    void driveTo(url.href);
  };

  const onPop = () => {
    void driveTo(location.href, { history: false });
  };

  document.addEventListener("click", onClick);
  window.addEventListener("popstate", onPop);

  if (!history.state?.jskeletDrive) {
    history.replaceState({ jskeletDrive: true }, document.title, location.href);
  }

  return () => {
    document.removeEventListener("click", onClick);
    window.removeEventListener("popstate", onPop);
    if (activeRoot === root) activeRoot = null;
  };
}
