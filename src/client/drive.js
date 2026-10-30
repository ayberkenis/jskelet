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
 * yazılır; verilmezse `body`. `<head>` yerinde kaldığı için çekilen
 * belgedeki `link[data-jskelet-css]` ve `#critical-css` canlı head ile
 * hizalanır; aksi halde sayfa sheet'i olan her site eski CSS ile yeni
 * HTML görür.
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
const CSS_ATTR = "data-jskelet-css";
const CSS_SELECTOR = `:scope > link[${CSS_ATTR}]`;
const CRITICAL_ID = "critical-css";
/** Yeni sheet hiç yüklenmezse ziyareti sonsuza kadar bekletme. */
const SHEET_WAIT_MS = 3000;

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
 * @param {Element} node
 * @returns {string}
 */
function cssName(node) {
  return node.getAttribute?.(CSS_ATTR) ?? "";
}

/**
 * @param {Element} node
 * @returns {string}
 */
function cssHref(node) {
  return node.getAttribute?.("href") ?? "";
}

/**
 * @param {Node} node
 * @returns {Node}
 */
function adoptNode(node) {
  if (typeof document.importNode === "function") {
    return document.importNode(node, true);
  }
  if (typeof node.cloneNode === "function") {
    return node.cloneNode(true);
  }
  return node;
}

/**
 * Aynı isimde href değişti: canlı link'i kopyala (media zaten `all`),
 * overlay `swapStylesheet` gibi yüklenince eskisi kalksın.
 *
 * @param {HTMLLinkElement} existing
 * @param {string} href
 * @returns {HTMLLinkElement}
 */
function cloneLiveSheet(existing, href) {
  const node = /** @type {HTMLLinkElement} */ (
    typeof existing.cloneNode === "function" ? existing.cloneNode(true) : adoptNode(existing)
  );
  node.href = href;
  if (typeof node.setAttribute === "function") node.setAttribute("href", href);
  return node;
}

/**
 * @param {HTMLLinkElement} link
 * @returns {Promise<void>}
 */
function waitForSheet(link) {
  return new Promise((resolve) => {
    let settled = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const done = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve();
    };

    if (!cssHref(link) || link.sheet) {
      done();
      return;
    }

    if (typeof link.addEventListener === "function") {
      link.addEventListener("load", done, { once: true });
      link.addEventListener("error", done, { once: true });
    }
    timer = setTimeout(done, SHEET_WAIT_MS);
  });
}

/**
 * `head > link[data-jskelet-css]`. noscript içindeki ikizler DOMParser'da
 * element olur (scripting kapalı); onları alma.
 *
 * @param {ParentNode | null | undefined} head
 * @returns {Element[]}
 */
function listCssLinks(head) {
  if (!head || typeof head.querySelectorAll !== "function") return [];
  return [...head.querySelectorAll(CSS_SELECTOR)];
}

/**
 * @param {HTMLLinkElement} node
 * @param {HTMLLinkElement | null} anchor
 * @param {ParentNode} liveHead
 */
function insertSheet(node, anchor, liveHead) {
  if (anchor && typeof anchor.after === "function") {
    anchor.after(node);
    return;
  }
  if (typeof liveHead.append === "function") {
    liveHead.append(node);
  }
}

/**
 * @param {Document} parsed
 * @returns {Promise<void>}
 */
async function syncStylesheets(parsed) {
  const nextHead = parsed.head;
  const liveHead = document.head;
  if (!nextHead || !liveHead) return;

  const desired = listCssLinks(nextHead);
  const live = listCssLinks(liveHead);
  /** @type {Map<string, Element>} */
  const liveByName = new Map();
  for (const node of live) {
    const name = cssName(node);
    if (name) liveByName.set(name, node);
  }

  /** @type {HTMLLinkElement[]} */
  const incoming = [];
  let anchor = live.at(-1) ?? null;

  for (const src of desired) {
    const name = cssName(src);
    if (!name) continue;
    const href = cssHref(src);
    const existing = liveByName.get(name);
    if (existing && cssHref(existing) === href) {
      anchor = existing;
      continue;
    }

    const node = /** @type {HTMLLinkElement} */ (
      existing ? cloneLiveSheet(/** @type {HTMLLinkElement} */ (existing), href) : adoptNode(src)
    );
    incoming.push(node);
    insertSheet(node, /** @type {HTMLLinkElement | null} */ (anchor), liveHead);
    anchor = node;
  }

  await Promise.all(incoming.map(waitForSheet));

  const desiredNames = new Set(desired.map(cssName).filter(Boolean));
  for (const node of live) {
    const name = cssName(node);
    if (!desiredNames.has(name)) {
      node.remove();
      continue;
    }
    const wanted = desired.find((item) => cssName(item) === name);
    if (wanted && cssHref(node) !== cssHref(wanted)) {
      node.remove();
    }
  }
}

/**
 * Uygulama `<style id="critical-css">` (veya link) basıyorsa drive onu da
 * taşır. Framework kendisi bu id'yi yazmaz.
 *
 * @param {Document} parsed
 */
function syncCriticalCss(parsed) {
  if (typeof parsed.getElementById !== "function") return;
  const next = parsed.getElementById(CRITICAL_ID);
  const current =
    typeof document.getElementById === "function" ? document.getElementById(CRITICAL_ID) : null;

  if (!next) {
    current?.remove();
    return;
  }

  const sameTag = current && current.tagName.toUpperCase() === next.tagName.toUpperCase();
  if (sameTag && current.tagName.toUpperCase() === "STYLE") {
    current.textContent = next.textContent ?? "";
    return;
  }
  if (sameTag && current.tagName.toUpperCase() === "LINK") {
    const href = cssHref(next);
    if (href && cssHref(current) !== href) {
      current.setAttribute("href", href);
      if ("href" in current) current.href = href;
    }
    return;
  }

  const adopted = /** @type {Element} */ (adoptNode(next));
  if (current && typeof current.replaceWith === "function") {
    current.replaceWith(adopted);
    return;
  }
  current?.remove();
  const liveHead = document.head;
  if (!liveHead) return;
  if (typeof liveHead.prepend === "function") liveHead.prepend(adopted);
  else if (typeof liveHead.append === "function") liveHead.append(adopted);
}

/**
 * Çekilen belgenin stylesheet'lerini canlı `<head>` ile hizala. Drive
 * `body`'yi yazar; `<head>` yerinde kalır. Sayfa sheet'i olan her site
 * aksi halde eski CSS ile yeni HTML görür.
 *
 * @param {Document} parsed
 * @returns {Promise<void>}
 */
export async function syncDrivenHead(parsed) {
  await syncStylesheets(parsed);
  syncCriticalCss(parsed);
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
 * @returns {{ doc: Document, title: string, html: string, lang: string } | null}
 */
function readDrivenDocument(html, selector) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const next = findRoot(parsed, selector);
  if (!next) return null;
  return {
    doc: parsed,
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

    try {
      await syncDrivenHead(parsed.doc);
    } catch (error) {
      console.error("[drive] head sync failed", error);
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
