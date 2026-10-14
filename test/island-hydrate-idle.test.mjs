/**
 * Zero-box + data-island-idle: hydrate mountWhenReady üzerinden gider;
 * load tamamlanmadan mountIsland çağrılmaz.
 */
import assert from "node:assert/strict";
import test from "node:test";

/**
 * Minimal DOM stub — yalnızca registry.hydrate yollarının okuduğu yüzey.
 */
function installDom({ readyState = "interactive" } = {}) {
  /** @type {Array<() => void>} */
  const loadListeners = [];
  /** @type {HTMLElement[]} */
  const islands = [];

  class FakeElement {
    constructor(attrs = {}) {
      /** @type {Record<string, string>} */
      this.attrs = { ...attrs };
      this.dataset = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (typeof prop !== "string") return undefined;
            const key = `data-${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
            return this.attrs[key];
          },
          has: (_t, prop) => {
            if (typeof prop !== "string") return false;
            const key = `data-${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
            return key in this.attrs;
          },
          set: (_t, prop, value) => {
            if (typeof prop !== "string") return false;
            const key = `data-${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
            this.attrs[key] = String(value);
            return true;
          },
          deleteProperty: (_t, prop) => {
            if (typeof prop !== "string") return false;
            const key = `data-${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
            delete this.attrs[key];
            return true;
          },
        },
      );
      this.isConnected = true;
    }

    getClientRects() {
      // hidden / zero-box
      return [];
    }
  }

  const root = {
    querySelectorAll(sel) {
      if (sel === "[data-island]") return islands.slice();
      return [];
    },
  };

  const document = {
    readyState,
    body: root,
    addEventListener(type, fn, opts) {
      if (type === "load") {
        loadListeners.push(fn);
        if (opts?.once) {
          /* kept until fire */
        }
      }
    },
    querySelectorAll: root.querySelectorAll.bind(root),
  };

  const window = {
    addEventListener(type, fn, opts) {
      document.addEventListener(type, fn, opts);
    },
  };

  globalThis.document = document;
  globalThis.window = window;
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Idle yolunu senkron tutma — afterLoad'ın load beklemesini ölçüyoruz.
  globalThis.requestIdleCallback = undefined;

  return {
    root,
    islands,
    addIsland(attrs) {
      const el = new FakeElement(attrs);
      islands.push(el);
      return el;
    },
    fireLoad() {
      document.readyState = "complete";
      for (const fn of loadListeners.splice(0)) fn();
    },
  };
}

test("hydrate: zero-box + data-island-idle waits for load", async () => {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    IntersectionObserver: globalThis.IntersectionObserver,
    requestIdleCallback: globalThis.requestIdleCallback,
  };

  const dom = installDom({ readyState: "interactive" });
  let mounts = 0;

  try {
    // Modül cache'i önceki testten kirlenmesin diye taze import.
    const registry = await import(
      `../src/client/registry.js?idle=${Date.now()}`
    );
    registry.register("drawer", async () => ({
      mount() {
        mounts += 1;
      },
    }));

    const host = dom.addIsland({
      "data-island": "drawer",
      "data-island-idle": "",
    });

    registry.hydrate(dom.root);
    // load öncesi mount yok (eski davranış: hemen mountIsland).
    await Promise.resolve();
    assert.equal(mounts, 0);
    assert.notEqual(host.dataset.islandReady, "true");

    dom.fireLoad();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(mounts, 1);
    assert.equal(host.dataset.islandReady, "true");
  } finally {
    globalThis.document = prev.document;
    globalThis.window = prev.window;
    globalThis.IntersectionObserver = prev.IntersectionObserver;
    globalThis.requestIdleCallback = prev.requestIdleCallback;
  }
});

test("hydrate: zero-box without idle still mounts after schedule", async () => {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    IntersectionObserver: globalThis.IntersectionObserver,
    requestIdleCallback: globalThis.requestIdleCallback,
  };

  const dom = installDom({ readyState: "complete" });
  let mounts = 0;

  try {
    const registry = await import(
      `../src/client/registry.js?noidle=${Date.now()}`
    );
    registry.register("drawer", async () => ({
      mount() {
        mounts += 1;
      },
    }));

    dom.addIsland({ "data-island": "drawer" });
    registry.hydrate(dom.root);
    assert.equal(mounts, 0);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(mounts, 1);
  } finally {
    globalThis.document = prev.document;
    globalThis.window = prev.window;
    globalThis.IntersectionObserver = prev.IntersectionObserver;
    globalThis.requestIdleCallback = prev.requestIdleCallback;
  }
});
