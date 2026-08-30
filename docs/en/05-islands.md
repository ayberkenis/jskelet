# 05 — Islands

This document explains how interactivity is added: the `data-island` contract,
passing props, the three hydration strategies and the IntersectionObserver
logic, the structure of `client/entries/*` and loading extra entries per page,
the runtime API (`register`, `registerAll`, `hydrate`, `observeDocument`,
`start`), `createStore` for sharing state between islands, the DOM helpers,
`startSafeImages` and the deferred panel (fragment) pattern. *Why* the model
looks like this is in [02-architecture.md](./02-architecture.md), and how the
bundle is produced is in [08-build.md](./08-build.md).

## The contract

The server HTML is complete; an island only adds behaviour. There are three
pieces.

**1. A marker in the template.**

```ejs
<div data-island="counter" data-island-props='{"start":5}'></div>
```

**2. The island module — a named export called `mount`.**

```js
// client/islands/counter.js
/**
 * @param {HTMLElement} element
 * @param {{ start?: number }} props
 * @returns {void | (() => void)} cleanup function (optional)
 */
export function mount(element, props) {
  let value = props.start ?? 0;
  // …
}
```

**3. Registration in an entry.**

```js
// client/entries/main.js
import { registerAll, start } from "jskelet/client";

registerAll({
  counter: () => import("../islands/counter.js"),
});

start();
```

The loader being a dynamic import is the core of the model: the module is
downloaded only if that island actually exists on the page **and** its mount
condition is met. Growing this map does not grow the initial load.

## HTML attributes

| Attribute | Meaning |
| --- | --- |
| `data-island="name"` | The registered name of the island to mount. Required. |
| `data-island-props='{"…":…}'` | JSON props. If it cannot be parsed an error is printed to the console and `{}` is passed. |
| `data-island-eager` | Mount immediately, independent of visibility. |
| `data-island-idle` | Wait until `load` plus idle time even if it is visible. |
| `data-island-ready="true"` | **Written by the framework.** Added after `mount()` returns successfully; CSS and tests can read it. |

Since `data-island-props` is an HTML attribute, wrapping it in single quotes is
the easiest way. If you produce the values on the server, using `jsonScript()`
or `attrs()` avoids escaping mistakes:

```ejs
<div <%- attrs({ "data-island": "chart", "data-island-props": JSON.stringify({ symbol }) }) %>></div>
```

## Hydration strategies

### The default: tied to visibility

Every island is handed to an `IntersectionObserver`
(`rootMargin: "200px 0px"`). Ones already on screen fire on the first
observation anyway; ones off screen are never downloaded until they are
scrolled to. Once an element becomes visible it is unobserved.

The mounting work is also deferred to idle time (`requestIdleCallback`,
`timeout: 500`; `setTimeout(fn, 0)` if it is not supported): if many islands
that become visible at the same time turn into a single long task, TBT and INP
suffer.

### `data-island-eager`

Visibility is not awaited, it mounts directly. For islands that apply to the
whole page, such as header behaviour, a cookie banner or a theme switcher.

```ejs
<header data-island="header" data-island-eager></header>
```

### `data-island-idle`

Held back until the `load` event completes and the main thread frees up, even
if it is visible. For heavy but non-critical modules that appear in the first
viewport — for example a mini chart that pulls in a charting library — so that
they do not compete with LCP.

```ejs
<div data-island="sparkline" data-island-idle></div>
```

If `document.readyState` is already `complete` when the page loads, the wait is
skipped and it is deferred straight to idle time.

### Hidden elements

A `hidden` drawer or dialog has no layout box, and `IntersectionObserver`
**never** reports it. That is why `hydrate()` reads its measurements in one go
(`getClientRects().length > 0`) and mounts elements without a box directly
instead of handing them to the observer. Reading the measurements in one go is
deliberate too: since no write comes in between there is only a single reflow.

The practical consequence: you can start a modal as `hidden` and its island
will still mount.

## The `client/` directory

```
client/
├── entries/
│   ├── main.js       the shared bootstrap loaded on every page
│   └── chart.js      only on the pages that ask for it
└── islands/
    ├── counter.js
    └── chart.js
```

**Every file** under `client/entries/*.js` **is an esbuild entry**. `main.js`
is loaded by the layout on every page (if it is in the manifest). Extra entries
are loaded only on the pages that ask for them:

```js
// controller
return { view: "pages/markets", entries: ["chart.js"] };
```

The layout resolves every name in the `entries` array with `asset(entry)` and
emits a `<script type="module">`. The name is the manifest key, that is, the
file name itself (`chart.js`), not its hashed form.

Code splitting (`splitting: true`) is on: modules shared by two entries end up
in a common chunk and are not downloaded twice.

`client/islands/` is not a requirement, only the common layout; island modules
can live anywhere reachable from an entry. The `@/` alias works both on the
server and in the bundle, so shared modules under `lib/` can use the same
import style.

## Runtime API — `jskelet/client`

### `register(name, loader)`

Registers a single island. `loader` must be a function returning
`Promise<{ mount }>`.

```js
import { register } from "jskelet/client";

register("counter", () => import("../islands/counter.js"));
```

### `registerAll(entries)`

Bulk registration in object form. The preferred form in practice.

```js
registerAll({
  counter: () => import("../islands/counter.js"),
  drawer: () => import("../islands/drawer.js"),
});
```

### `hydrate(root?)`

Scans all `[data-island]` elements under `root` (defaults to `document`) and
processes them according to their mount strategy. Already mounted elements are
skipped.

You can call it directly when you need to rescan for islands by hand (for
example if you added DOM with your own code):

```js
container.innerHTML = html;
hydrate(container);
```

### `observeDocument()`

Sets up a `MutationObserver` on `document.body` and also catches islands added
to the DOM later (infinite scroll, portals, fragment loading). It returns the
`MutationObserver` instance so it can be `disconnect()`ed if needed.

### `start()`

The typical bootstrap: it waits for `DOMContentLoaded` (if necessary), then
calls `hydrate()` and `observeDocument()`.

```js
registerAll({ /* … */ });
start();
```

### Mount behaviour and errors

- An element is **not mounted twice** with the same island name; the record is
  kept per element in a `WeakMap`.
- A warning is printed to the console for a name that is not registered:
  `[island] kayıtlı değil: <ad>`.
- If the module import or `mount()` throws, an error is printed to the console
  (`[island] <ad> yüklenemedi`) and **the rest of the page is unaffected**.
- If `mount()` returns successfully, `data-island-ready="true"` is written on
  the element.
- `mount()` may return a function; the contract reserves it for cleanup. The
  framework does not currently call this function on its own — if the island
  manages its own lifetime (for example while replacing a fragment) it must
  keep the returned function and call it itself.

## Sharing state: `createStore`

A minimal pub/sub used in place of React Context. It replaces the
`useSyncExternalStore` bridge: you just `subscribe`.

```js
// client/stores/theme.js
import { createStore } from "jskelet/client";

export const theme = createStore("light");
```

```js
// client/islands/theme-toggle.js
import { theme } from "../stores/theme.js";

export function mount(element) {
  const paint = (value) => {
    element.textContent = value === "light" ? "Koyu tema" : "Açık tema";
  };

  const unsubscribe = theme.subscribe(paint);
  paint(theme.get());

  element.addEventListener("click", () => {
    theme.set((prev) => (prev === "light" ? "dark" : "light"));
  });

  return unsubscribe;
}
```

API:

| Member | Behaviour |
| --- | --- |
| `get()` | The current value |
| `set(next)` | A value or a `(prev) => next` function. If the value is **the same** (`===`) listeners are not fired. |
| `subscribe(listener)` | Adds a listener and returns the function that removes it. It is not called with the current value on subscribe — do the first paint yourself. |

## DOM helpers

`jskelet/client` provides a small set of helpers that islands share.

| Function | Signature | Behaviour |
| --- | --- | --- |
| `qs` | `(root, selector) => HTMLElement \| null` | `querySelector` |
| `qsa` | `(root, selector) => HTMLElement[]` | `querySelectorAll`, as a real array |
| `on` | `(target, type, handler, options?) => () => void` | Adds a listener and **returns the function that removes it** |
| `onClick` | `(root, selector, handler) => () => void` | Delegated click; `handler(event, target)` |
| `debounce` | `(ms, fn) => fn` | Runs `ms` after the last call |
| `raf` | `(fn) => fn` | Coalesces calls into a single `requestAnimationFrame` |
| `toggleClass` | `(element, name, active) => void` | `classList.toggle` |
| `getOverlayRoot` | `() => HTMLElement` | `#jskelet-overlays` or `body` |

`on()` and `onClick()` returning a remover pairs naturally with `mount()`'s
cleanup function:

```js
import { on, onClick, raf } from "jskelet/client";

export function mount(element) {
  const offClick = onClick(element, "[data-tab]", (event, target) => {
    selectTab(target.dataset.tab);
  });

  const offScroll = on(window, "scroll", raf(() => updateShadow(element)), {
    passive: true,
  });

  return () => {
    offClick();
    offScroll();
  };
}
```

`getOverlayRoot()` is for moving modal/drawer content: if the layout has
`<div id="jskelet-overlays"></div>` it goes there, otherwise into `body`. The
portal prevents an ancestor element carrying `overflow` or `transform` from
clipping a `position: fixed` overlay.

## `startSafeImages()`

A single document listener for images that fail to load. It is **deliberately
not an island:** an image-heavy page can have 80+ `<img>` elements, and
attaching a separate island to each one (observer + dynamic import + mount) is
a serious hydration cost just for the possibility of an error.

```js
// client/entries/main.js
import { registerAll, start, startSafeImages } from "jskelet/client";

registerAll({ /* … */ });
startSafeImages();
start();
```

Usage, on the template side:

```ejs
<%# 1. Minimal: the framework swaps in a block that preserves the dimensions %>
<img src="/kapak.png" alt="Kapak" width="640" height="360" data-safe-image>

<%# 2. Your own error view %>
<div data-safe-image-host>
  <img src="/kapak.png" alt="Kapak" data-safe-image>
  <template data-safe-image-fallback>
    <div class="flex h-40 items-center justify-center bg-slate-100">Görsel yok</div>
  </template>
</div>
```

How it works:

- A single `error` listener is installed on the document **in the capture
  phase**. The `error` event does not bubble but it can be seen in the capture
  phase; that is why a single listener covers all images and ones added to the
  DOM later are covered automatically.
- If there is a `data-safe-image-host` wrapper **and** a
  `<template data-safe-image-fallback>` inside it, the whole wrapper is
  replaced with the template content. The framework imposes no styling.
- Otherwise a minimal block is put in place of the image: `role="img"`, the
  `alt` (or `data-fallback-label`) value as `aria-label`, the image's
  `className` plus `data-fallback-class`, and, if `width`/`height` exist, the
  same dimensions as an inline style. Preserving the dimensions prevents layout
  shift (CLS) during the swap.
- Images that failed before JS ran produce no event; that is why a single scan
  is performed (`requestIdleCallback`, `timeout: 2000`): the ones that are
  `complete` with `naturalWidth === 0` are replaced.

## The deferred panel (fragment) pattern

When you want to remove a heavy, secondary section (comments, related articles,
a long table) from the initial HTML response entirely, the combination of an
island plus a layout-less render is used. The framework has no special API for
this; it is a combination of two pieces you already have:

**1. A layout-less fragment endpoint on the server** (`renderView`, see
[03-routing.md](./03-routing.md)):

```js
// routes/80-fragments.mjs
export default function register(app, { renderView }) {
  app.get("/_fragment/yorumlar/:id", async (req, res) => {
    const comments = await getComments(req.params.id);
    res.type("html").send(await renderView("fragments/comments", { comments }));
  });
}
```

**2. A placeholder island on the page.** Because it mounts on visibility,
neither the module nor the fragment is downloaded if the visitor never scrolls
to that section:

```ejs
<div data-island="deferred" data-island-props='{"src":"/_fragment/yorumlar/42"}'></div>
```

**3. The island fetches the fragment, inserts it and hydrates the islands
inside it:**

```js
// client/islands/deferred.js
import { hydrate } from "jskelet/client";

export async function mount(element, { src }) {
  try {
    const response = await fetch(src, { headers: { accept: "text/html" } });
    if (!response.ok) return;

    element.innerHTML = await response.text();
    hydrate(element);
  } catch {
    // Secondary content: give up silently, don't affect the rest of the page.
  }
}
```

If `observeDocument()` is already running the `hydrate()` call on the last line
is unnecessary; still, calling it explicitly makes it behave correctly in a
setup that does not use `start()` either.

The `/_fragment/` prefix is recommended for fragment paths: because it is in
the default `prewarmSkip` list, the prewarm round does not scan those endpoints
([06-caching.md](./06-caching.md)).

## Environment variables and `clientEnv`

There is no `process` in the browser, but modules shared with the server may
still read `process.env`. The keys declared through `jskelet.config.mjs` →
`clientEnv` are inlined into the bundle at build time:

```js
export default {
  clientEnv: ["PUBLIC_WS_URL", "PUBLIC_CDN"],
};
```

The same contract as `NEXT_PUBLIC_*` in Next, except which key is public is
clear from the config rather than from the name. All of `process.env` is
defined as a single object, so reading a key that is not in the list returns
`undefined` instead of crashing. `NODE_ENV` is always inlined.

## Browser support

The bundle target is fixed: `chrome111`, `edge111`, `firefox111`,
`safari16.4`. ESM + dynamic import + `IntersectionObserver` is already the
lower bound of the island model; transpiling to anything older grows the output
and gains no visitors. Even if JS never runs, the page stays readable because
the server HTML is complete.

## What's next

- The bundle, hashes and the `entries` manifest: [08-build.md](./08-build.md)
- The controller side of the `entries` field: [03-routing.md](./03-routing.md)
- Watching island state from the dev panel: [09-dev-tools.md](./09-dev-tools.md)
