/**
 * data-island-on: hydrate paketi indirmez; ilk eşleşen olay mountIsland'ı
 * tetikler. eager / idle / gizli host bu işareti ezemez.
 */
import assert from "node:assert/strict";
import test from "node:test";

/**
 * Minimal DOM stub — registry.hydrate + addEventListener yüzeyleri.
 *
 * @param {{ readyState?: string, boxed?: boolean }} [options]
 */
function installDom({ readyState = "interactive", boxed = true } = {}) {
  /** @type {HTMLElement[]} */
  const islands = [];

  class FakeElement {
    constructor(attrs = {}) {
      /** @type {Record<string, string>} */
      this.attrs = { ...attrs };
      this.boxed = boxed;
      this.isConnected = true;
      /** @type {Map<string, Set<Function>>} */
      this.listeners = new Map();
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
    }

    getClientRects() {
      return this.boxed ? [{ width: 1, height: 1 }] : [];
    }

    addEventListener(type, fn) {
      let set = this.listeners.get(type);
      if (!set) {
        set = new Set();
        this.listeners.set(type, set);
      }
      set.add(fn);
    }

    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn);
    }

    /** @param {{ type: string } | string} event */
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event.type;
      for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
    }

    listenerCount(type) {
      return this.listeners.get(type)?.size ?? 0;
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
    addEventListener() {},
    querySelectorAll: root.querySelectorAll.bind(root),
  };

  globalThis.document = document;
  globalThis.window = { addEventListener() {} };
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.requestIdleCallback = undefined;

  return {
    root,
    islands,
    addIsland(attrs) {
      const el = new FakeElement(attrs);
      islands.push(el);
      return el;
    },
  };
}

function restoreDom(prev) {
  globalThis.document = prev.document;
  globalThis.window = prev.window;
  globalThis.IntersectionObserver = prev.IntersectionObserver;
  globalThis.requestIdleCallback = prev.requestIdleCallback;
}

function snapshotDom() {
  return {
    document: globalThis.document,
    window: globalThis.window,
    IntersectionObserver: globalThis.IntersectionObserver,
    requestIdleCallback: globalThis.requestIdleCallback,
  };
}

test("hydrate: data-island-on waits for the first event", async () => {
  const prev = snapshotDom();
  const dom = installDom();
  let mounts = 0;

  try {
    const registry = await import(`../src/client/registry.js?on=${Date.now()}`);
    registry.register("search", async () => ({
      mount() {
        mounts += 1;
      },
    }));

    const host = dom.addIsland({
      "data-island": "search",
      "data-island-on": "focusin",
    });

    registry.hydrate(dom.root);
    await Promise.resolve();
    assert.equal(mounts, 0);
    assert.notEqual(host.dataset.islandReady, "true");
    assert.equal(host.listenerCount("focusin"), 1);

    host.dispatchEvent({ type: "click" });
    await Promise.resolve();
    assert.equal(mounts, 0, "unlisted events do not mount");

    host.dispatchEvent({ type: "focusin" });
    await Promise.resolve();
    assert.equal(mounts, 1);
    assert.equal(host.dataset.islandReady, "true");
    assert.equal(host.listenerCount("focusin"), 0, "listener removed after first event");

    host.dispatchEvent({ type: "focusin" });
    await Promise.resolve();
    assert.equal(mounts, 1, "second event does not remount");
  } finally {
    restoreDom(prev);
  }
});

test("hydrate: data-island-on wins over eager and a visible host", async () => {
  const prev = snapshotDom();
  const dom = installDom({ boxed: true });
  let mounts = 0;

  try {
    const registry = await import(
      `../src/client/registry.js?on-eager=${Date.now()}`
    );
    registry.register("search", async () => ({
      mount() {
        mounts += 1;
      },
    }));

    const host = dom.addIsland({
      "data-island": "search",
      "data-island-eager": "",
      "data-island-on": "pointerdown, focusin",
    });

    registry.hydrate(dom.root);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(mounts, 0);

    host.dispatchEvent({ type: "pointerdown" });
    await Promise.resolve();
    assert.equal(mounts, 1);
  } finally {
    restoreDom(prev);
  }
});

test("hydrate: data-island-on wins over a zero-box host", async () => {
  const prev = snapshotDom();
  const dom = installDom({ boxed: false, readyState: "complete" });
  let mounts = 0;

  try {
    const registry = await import(
      `../src/client/registry.js?on-hidden=${Date.now()}`
    );
    registry.register("drawer", async () => ({
      mount() {
        mounts += 1;
      },
    }));

    const host = dom.addIsland({
      "data-island": "drawer",
      "data-island-on": "click",
    });

    registry.hydrate(dom.root);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(mounts, 0, "hidden hosts with data-island-on stay unloaded");

    host.dispatchEvent({ type: "click" });
    await Promise.resolve();
    assert.equal(mounts, 1);
  } finally {
    restoreDom(prev);
  }
});

test("hydrate: empty data-island-on does not mount and warns", async () => {
  const prev = snapshotDom();
  const dom = installDom();
  let mounts = 0;
  /** @type {unknown[]} */
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };

  try {
    const registry = await import(
      `../src/client/registry.js?on-empty=${Date.now()}`
    );
    registry.register("search", async () => ({
      mount() {
        mounts += 1;
      },
    }));

    dom.addIsland({
      "data-island": "search",
      "data-island-on": "  ",
    });

    registry.hydrate(dom.root);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(mounts, 0);
    assert.match(String(warnings[0] ?? ""), /no valid events/);
  } finally {
    console.warn = original;
    restoreDom(prev);
  }
});

test("unmount: data-island-on drops the waiter so a later event is ignored", async () => {
  const prev = snapshotDom();
  const dom = installDom();
  let mounts = 0;

  try {
    const registry = await import(
      `../src/client/registry.js?on-unmount=${Date.now()}`
    );
    registry.register("search", async () => ({
      mount() {
        mounts += 1;
      },
    }));

    const host = dom.addIsland({
      "data-island": "search",
      "data-island-on": "focusin",
    });

    registry.hydrate(dom.root);
    registry.unmount(host);
    assert.equal(host.listenerCount("focusin"), 0);

    host.dispatchEvent({ type: "focusin" });
    await Promise.resolve();
    assert.equal(mounts, 0);
  } finally {
    restoreDom(prev);
  }
});
