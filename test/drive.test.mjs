/**
 * Drive: Stimulus/Turbo ziyareti. data-permanent host canlı kalır; kuyu yok.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPermanent,
  driveableUrl,
  driveTo,
  restorePermanent,
  startDrive,
} from "../src/client/drive.js";

/**
 * @param {Record<string, unknown>} attrs
 */
function fakeAnchor(attrs = {}) {
  /** @type {Record<string, string>} */
  const dataset = {};
  if ("data-no-drive" in attrs) dataset.noDrive = "";
  const href = String(attrs.href ?? "");
  const anchor = {
    href,
    target: attrs.target ?? "",
    dataset,
    hasAttribute(name) {
      return name in attrs;
    },
    closest(sel) {
      if (sel === "a[href]") return anchor;
      if (sel === "[data-swap]") return attrs["data-swap"] ? anchor : null;
      return null;
    },
  };
  return /** @type {HTMLAnchorElement} */ (anchor);
}

function clickEvent(anchor, extra = {}) {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: anchor,
    ...extra,
  };
}

function el(tag, attrs = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(),
    id: attrs.id ?? "",
    _innerHTML: "",
    parent: null,
    children: [],
    dataset: {},
    attrs: { ...attrs },
    get className() {
      return this.attrs.class ?? "";
    },
    hasAttribute(name) {
      return name in this.attrs;
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
    dispatchEvent() {},
    contains(other) {
      if (other === node) return true;
      return this.children.some((child) => child.contains(other));
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] ?? null;
    },
    querySelectorAll(sel) {
      /** @type {typeof node[]} */
      const out = [];
      const walk = (current) => {
        if (match(current, sel)) out.push(current);
        for (const child of current.children) walk(child);
      };
      for (const child of this.children) walk(child);
      return out;
    },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((c) => c !== node);
      this.parent = null;
    },
    replaceWith(live) {
      if (!this.parent) return;
      const list = this.parent.children;
      const index = list.indexOf(node);
      list[index] = live;
      live.parent = this.parent;
      this.parent = null;
    },
    append(child) {
      child.parent = node;
      this.children.push(child);
    },
    get innerHTML() {
      return this._innerHTML;
    },
    set innerHTML(value) {
      this._innerHTML = String(value);
      for (const child of this.children) child.parent = null;
      this.children = [];
    },
  };
  if (attrs["data-permanent"] != null) node.dataset.permanent = "";
  if (attrs.id) node.id = attrs.id;
  for (const child of children) node.append(child);
  return node;
}

function match(node, sel) {
  if (sel === "[data-permanent][id]") {
    return "permanent" in node.dataset && Boolean(node.id);
  }
  if (sel.startsWith("#")) return node.id === sel.slice(1);
  if (sel === "[data-island]") return "island" in node.dataset;
  return false;
}

test("driveableUrl: same-origin document links pass, the rest do not", () => {
  const prev = { location: globalThis.location, HTMLAnchorElement: globalThis.HTMLAnchorElement };
  globalThis.HTMLAnchorElement = function HTMLAnchorElement() {};
  globalThis.location = /** @type {Location} */ ({
    href: "http://example.test/a",
    origin: "http://example.test",
    pathname: "/a",
    search: "",
  });

  try {
    const ok = fakeAnchor({ href: "http://example.test/b" });
    Object.setPrototypeOf(ok, globalThis.HTMLAnchorElement.prototype);
    assert.equal(driveableUrl(clickEvent(ok))?.pathname, "/b");

    const same = fakeAnchor({ href: "http://example.test/a#x" });
    Object.setPrototypeOf(same, globalThis.HTMLAnchorElement.prototype);
    assert.equal(driveableUrl(clickEvent(same)), null);

    const blank = fakeAnchor({ href: "http://example.test/b", target: "_blank" });
    Object.setPrototypeOf(blank, globalThis.HTMLAnchorElement.prototype);
    assert.equal(driveableUrl(clickEvent(blank)), null);

    const other = fakeAnchor({ href: "http://other.test/b" });
    Object.setPrototypeOf(other, globalThis.HTMLAnchorElement.prototype);
    assert.equal(driveableUrl(clickEvent(other)), null);

    const swap = fakeAnchor({ href: "http://example.test/b", "data-swap": "#x" });
    Object.setPrototypeOf(swap, globalThis.HTMLAnchorElement.prototype);
    assert.equal(driveableUrl(clickEvent(swap)), null);

    const noDrive = fakeAnchor({ href: "http://example.test/b", "data-no-drive": "" });
    Object.setPrototypeOf(noDrive, globalThis.HTMLAnchorElement.prototype);
    assert.equal(driveableUrl(clickEvent(noDrive)), null);

    const modified = fakeAnchor({ href: "http://example.test/b" });
    Object.setPrototypeOf(modified, globalThis.HTMLAnchorElement.prototype);
    assert.equal(driveableUrl(clickEvent(modified, { ctrlKey: true })), null);
  } finally {
    globalThis.location = prev.location;
    globalThis.HTMLAnchorElement = prev.HTMLAnchorElement;
  }
});

test("collectPermanent / restorePermanent reuse the live host by id", () => {
  const toggle = el("button", { id: "theme-toggle", "data-permanent": "" });
  toggle.dataset.island = "theme-toggle";
  const header = el("header", {}, [toggle]);
  const main = el("main", {}, [el("p")]);
  const body = el("body", {}, [header, main]);

  const kept = collectPermanent(body);
  assert.equal(kept.length, 1);
  assert.equal(kept[0], toggle);
  assert.equal(toggle.parent, null);
  assert.equal(header.children.includes(toggle), false);

  const placeholder = el("button", { id: "theme-toggle", "data-permanent": "" });
  const nextHeader = el("header", {}, [placeholder]);
  const nextMain = el("main", {}, [el("p")]);
  const nextBody = el("body", {}, [nextHeader, nextMain]);

  restorePermanent(nextBody, kept);
  assert.equal(placeholder.parent, null);
  assert.equal(toggle.parent, nextHeader);
  assert.equal(nextHeader.children[0], toggle);
});

test("driveTo: body visit keeps data-permanent host identity", async () => {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
    history: globalThis.history,
    fetch: globalThis.fetch,
    DOMParser: globalThis.DOMParser,
    HTMLAnchorElement: globalThis.HTMLAnchorElement,
    CustomEvent: globalThis.CustomEvent,
    HTMLElement: globalThis.HTMLElement,
  };

  const events = [];
  const toggle = el("button", { id: "theme-toggle", "data-permanent": "" });
  toggle.dataset.island = "theme-toggle";
  const header = el("header", {}, [toggle]);
  const main = el("main", {}, []);
  main.innerHTML = "<p>old</p>";
  const body = el("body", {}, [header, main]);
  body.dispatchEvent = (event) => {
    events.push(event);
  };

  globalThis.HTMLElement = function HTMLElement() {};
  Object.setPrototypeOf(toggle, globalThis.HTMLElement.prototype);
  Object.setPrototypeOf(header, globalThis.HTMLElement.prototype);
  Object.setPrototypeOf(main, globalThis.HTMLElement.prototype);
  Object.setPrototypeOf(body, globalThis.HTMLElement.prototype);

  globalThis.CustomEvent = class CustomEvent {
    /**
     * @param {string} type
     * @param {{ bubbles?: boolean, detail?: object }} [init]
     */
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = init.bubbles;
      this.detail = init.detail;
    }
  };

  globalThis.DOMParser = class DOMParser {
    parseFromString(html) {
      const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "";
      const lang = html.match(/<html[^>]*lang="([^"]*)"/i)?.[1] ?? "";
      const inner = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "";
      return {
        title,
        documentElement: { lang },
        querySelector(sel) {
          if (sel !== "body") return null;
          return { innerHTML: inner };
        },
      };
    }
  };

  globalThis.location = /** @type {Location} */ ({
    href: "http://example.test/a",
    origin: "http://example.test",
    pathname: "/a",
    search: "",
    assign() {
      throw new Error("should not fall back to full navigation");
    },
  });

  /** @type {Array<[unknown, string, string]>} */
  const pushed = [];
  globalThis.history = {
    state: {},
    pushState(state, title, url) {
      pushed.push([state, title, String(url)]);
    },
    replaceState() {},
  };

  globalThis.document = {
    title: "Old",
    documentElement: { lang: "en" },
    querySelector(sel) {
      if (sel === "body") return body;
      return null;
    },
    addEventListener() {},
  };

  globalThis.window = {
    addEventListener() {},
    scrollTo() {},
  };

  globalThis.fetch = async () => ({
    ok: true,
    redirected: false,
    url: "http://example.test/b",
    text: async () =>
      `<!DOCTYPE html><html lang="tr"><head><title>Next</title></head><body><header><button id="theme-toggle" data-permanent></button></header><main><p>new</p></main></body></html>`,
  });

  try {
    startDrive(true);
    const ok = await driveTo("http://example.test/b");
    assert.equal(ok, true);
    assert.equal(globalThis.document.title, "Next");
    assert.equal(globalThis.document.documentElement.lang, "tr");
    assert.equal(events[0]?.type, "jskelet:drive");
    assert.equal(events[0]?.detail?.url, "http://example.test/b");
    assert.equal(pushed.length, 1);
    assert.match(body.innerHTML, /<p>new<\/p>/);
    assert.equal(toggle.dataset.island, "theme-toggle");
  } finally {
    globalThis.document = prev.document;
    globalThis.window = prev.window;
    globalThis.location = prev.location;
    globalThis.history = prev.history;
    globalThis.fetch = prev.fetch;
    globalThis.DOMParser = prev.DOMParser;
    globalThis.HTMLAnchorElement = prev.HTMLAnchorElement;
    globalThis.CustomEvent = prev.CustomEvent;
    globalThis.HTMLElement = prev.HTMLElement;
  }
});
