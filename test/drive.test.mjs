/**
 * startDrive / driveTo: layout yerinde, yalnızca root bölgesi değişir.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { driveableUrl, driveTo, startDrive } from "../src/client/drive.js";

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
    const url = driveableUrl(clickEvent(ok));
    assert.equal(url?.pathname, "/b");

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

test("driveTo: replaces only the root, dispatches jskelet:drive, leaves outer HTML", async () => {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
    history: globalThis.history,
    fetch: globalThis.fetch,
    DOMParser: globalThis.DOMParser,
    HTMLAnchorElement: globalThis.HTMLAnchorElement,
    CustomEvent: globalThis.CustomEvent,
  };

  const events = [];
  const region = {
    innerHTML: "<p>old</p>",
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
    dispatchEvent(event) {
      events.push(event);
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const roof = { dataset: { island: "roof" } };

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
      const inner = html.match(/id="page-content"[^>]*>([\s\S]*)<\/div>/i)?.[1] ?? "";
      return {
        title,
        documentElement: { lang },
        querySelector(sel) {
          if (sel !== "#page-content") return null;
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
      if (sel === "#page-content") return region;
      if (sel === "header") return roof;
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
      `<!DOCTYPE html><html lang="tr"><head><title>Next</title></head><body><header>roof</header><div id="page-content"><p>new</p></div></body></html>`,
  });

  try {
    startDrive({ root: "#page-content" });
    const ok = await driveTo("http://example.test/b");
    assert.equal(ok, true);
    assert.equal(region.innerHTML, "<p>new</p>");
    assert.equal(globalThis.document.title, "Next");
    assert.equal(globalThis.document.documentElement.lang, "tr");
    assert.equal(events[0]?.type, "jskelet:drive");
    assert.equal(events[0]?.detail?.url, "http://example.test/b");
    assert.equal(pushed.length, 1);
    assert.equal(roof.dataset.island, "roof", "persistent island host is untouched");
  } finally {
    globalThis.document = prev.document;
    globalThis.window = prev.window;
    globalThis.location = prev.location;
    globalThis.history = prev.history;
    globalThis.fetch = prev.fetch;
    globalThis.DOMParser = prev.DOMParser;
    globalThis.HTMLAnchorElement = prev.HTMLAnchorElement;
    globalThis.CustomEvent = prev.CustomEvent;
  }
});
