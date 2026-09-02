# 04 — Rendering and templates

This document explains how server HTML is produced: the EJS engine settings,
how the layout file is resolved and which locals it can use, the page templates
under `views/pages`, the automatic registration of the components under
`views/components/**`, the `html`/`tags` helpers that templates receive for
free, the translation of the `metadata` object into `<head>` tags, and the
three render hooks. What the controller sends into this layer is covered in
[03-routing.md](./03-routing.md), and `asset()`/`hasAsset()`, which produce
asset URLs, in [08-build.md](./08-build.md).

## The render pipeline

```
route(controller)
 └─ produce()
     ├─ controller(ctx)  → page definition
     └─ renderPage(page)
         ├─ hooks.metadata(page) + page.metadata      → metadata
         ├─ Promise.all([
         │     renderView(page.view, { …data, metadata }),   → body
         │     hooks.layoutContext({ pathname, metadata }),  → context
         │   ])
         └─ layout (.jsk compiled or .ejs)  → full HTML
```

The layout context and the body are produced **in parallel**. The reason comes
from measurement: in most projects navigation comes from upstream, and waiting
for it in sequence with the body render adds needless latency to every page.

## `.jsk` — build-time compiled templates

New apps default to `.jsk`. At build time they become normal ESM modules under
`.jskelet/templates/*.mjs`. There is **no request-time parsing, `eval`, or
`new Function`**. Production path:

```
controller data → imported render(data, helpers) → HTML
```

### Syntax summary

```html
<section class="wrapper">
  <h1>{{ title }}</h1>
  <div>{{{ trustedHtml }}}</div>

  {#if items.length}
    <List :items="items" />
  {#else}
    <p>Empty</p>
  {/if}

  {#each items as item, i}
    <li data-i="{{ i }}">{{ item }}</li>
  {/each}

  <Link href="/" text="Home" />
  <div data-island="counter" data-island-props='{"start":0}'></div>
</section>
```

| Feature | Form |
| --- | --- |
| Escaped text | `{{ expr }}` |
| Raw HTML | `{{{ expr }}}` |
| Conditional | `{#if expr}` … `{#else}` … `{/if}` |
| Loop | `{#each list as item}` or `as item, i` |
| Include | `{#include "partials/header"}` (compiled `.jsk`) |
| Component | PascalCase tag; `:prop="expr"`, `prop="literal"`, boolean `disabled` |
| Built-ins | `Link`, `Image`, `Icon`, `CsrfField`, `PreloadImage` |

The expression language is intentionally small (access, compare, ternary,
`.length`). No assignments, object literals, or arbitrary calls — keep logic in
controllers or JS components.

#### Template or component?

When moving off EJS, draw the line early:

| Stay in `.jsk` | Move to a JS component |
| --- | --- |
| Text, conditionals, lists, prop binding | Function calls, object construction, formatting |
| Built-in tags (`Link`, `Image`, …) | Composing HTML from several helpers |
| Ready-made data from the controller | Upstream / error-aware UI (`LoadErrorState`) |

If the template cannot write `format(x)` or `{ a: 1 }`, that is intentional: the
work belongs in `views/components/*.js` or the controller. Prefer a clear
component boundary over widening the expression language when complex pages
“escape” into JS.

### Editor support

`extensions/vscode-jsk` is a VS Code / Cursor extension in this repo: syntax
highlighting, language configuration, and snippets. Local install:

```bash
code --install-extension extensions/vscode-jsk
```

See the extension README for details.

### Coexistence with EJS

If a compiled `.jsk` exists for a view id it wins; otherwise `.ejs` is rendered
with EJS. Existing apps keep working unchanged. `jskelet init` scaffolds `.jsk`.

## The EJS engine (legacy)

EJS remains supported. The engine is set up once on the first render; the
component scan touches the file system, so it cannot be done on every request
and cannot be computed before the config is loaded.

Settings:

| Setting | Value | Reason |
| --- | --- | --- |
| `root`, `views` | the `views` directory | `include('partials/header')` calls resolve from the views root |
| `cache` | `false` in dev, `true` in prod | so template edits show up instantly in dev |
| `rmWhitespace` | `true` | output size |
| `async` | `true` | `await` can be used inside templates |

For embedded uses (tests, scripts) `resetRenderEngine()` is exported: it
refreshes the registry when component files change. It is not needed in the
normal flow because the dev server restarts the process.

## Layout

### How the layout file is found

1. `jskelet.config.mjs` → if `layout` is given, it is used. The path is
   resolved relative to the **parent directory of the views directory**: if
   `views` is the default, `layout: "views/custom.ejs"` → `<root>/views/custom.ejs`.
2. If it is not given and `views/layout.jsk` exists (compiled), that is used.
3. Else if `views/layout.ejs` exists, that is used.
4. If that does not exist either, the framework's own minimal layout is used
   (`node_modules/jskelet/src/templates/layout.ejs`, also reachable through the
   `jskelet/layout` specifier).

These fallbacks exist so that a new project can work with a single route. The
most practical way to move to your own layout is to copy that file to
`views/layout.ejs` or author `views/layout.jsk`.

### The framework's default layout

```ejs
<!DOCTYPE html>
<html lang="<%= lang %>">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <%- extraHead %>
    <% if (hasAsset('app.css')) { %>
    <link rel="stylesheet" href="<%= asset('app.css') %>">
    <% } %>
    <%- headMeta %>
    <% structuredData.forEach(function (item) { %>
    <script type="application/ld+json"><%- jsonScript(item) %></script>
    <% }); %>
  </head>
  <body class="<%= bodyClass %>">
    <%- body %>
    <% if (hasAsset('main.js')) { %>
    <script type="module" src="<%= asset('main.js') %>"></script>
    <% } %>
    <% entries.forEach(function (entry) { %>
    <script type="module" src="<%= asset(entry) %>"></script>
    <% }); %>
    <% if (devtools) { %>
    <script type="module" src="<%= devBasePath %>/overlay.js"></script>
    <% } %>
  </body>
</html>
```

Points to watch:

- **`extraHead` comes first.** Delaying resource hints (`preconnect`, LCP
  `preload`) writes straight into LCP.
- **A single, render-blocking stylesheet**, with the reasoning in
  [02-architecture.md](./02-architecture.md). If the build has not run,
  `hasAsset('app.css')` is false and the tag is never emitted.
- **The `hasAsset` checks** keep the page from requesting files that 404 when
  the build is missing.
- **The devtools script** is emitted only when `NODE_ENV=development`; it does
  not exist at all in production output.

### Layout locals

| Local | Type | Source |
| --- | --- | --- |
| `metadata` | `object` | `hooks.metadata()` + controller `metadata` (the controller wins) |
| `headMeta` | `string` | ready-made `<head>` tags produced from `metadata` |
| `extraHead` | `string` | `preconnect` hints + `navigation` hints + controller `head` + `context.extraHead` |
| `structuredData` | `unknown[]` | `hooks.layoutContext()` → `structuredData`; defaults to `[]` |
| `body` | `string` | The render output of the page template |
| `bodyClass` | `string` | controller `bodyClass` → `context.bodyClass` → `""` |
| `entries` | `string[]` | controller `entries`; defaults to `[]` |
| `pathname` | `string` | `req.path`; **defaults to the empty string** |
| `lang` | `string` | `context.lang` → `brand.lang` → `"en"` |
| `devtools` | `boolean` | `NODE_ENV === "development"` |
| `devBasePath` | `string` | `brand.devBasePath`, defaults to `/__jskelet/dev` |
| `asset`, `hasAsset` | function | Manifest access |
| html/tags helpers | function | `esc`, `attrs`, `cx`, `cn`, `jsonScript`, `link`, `image`, `icon`, `preloadImage`, `toKebab` |
| exports of `views/components/**` | function | Automatic registration |
| every field returned by `hooks.layoutContext()` | — | Becomes a local directly |

The empty default for `pathname` is deliberate: writing `"/"` leads to the kind
of bug where every page thinks it is the home page and renders the logo as an
`<h1>`.

## Page templates

The `view` field gives the path under `views/` without an extension:
`"pages/home"` → `views/pages/home.ejs`. The locals passed to the template are
the contents of the `data` field plus `metadata` — **not** the layout locals.
The page template still has access to all helpers and components.

```ejs
<%# views/pages/home.ejs %>
<section class="wrapper">
  <h1 class="text-3xl font-bold"><%= heading %></h1>

  <%# `list` is defined in views/components/list.js; no import needed. %>
  <%- list({ items }) %>

  <div class="mt-8" data-island="counter" data-island-props='{"start":5}'></div>
</section>
```

Do not mix up the two output forms in EJS:

- `<%= value %>` — HTML escaped. **Always** this for user/upstream data.
- `<%- html %>` — raw. Only for HTML strings you produced yourself and know to
  be safe (component calls, `headMeta`, `body`).

Because `async: true` is on, `await` can also be used inside a template, but
keeping data fetching in the controller makes diagnosis easier.

## Components: `views/components/**`

Components are not EJS partials but **functions that return HTML strings**.
Every `.js` file under `views/components/**` is scanned and **every named
export** becomes a template local. There is no hand-maintained barrel file:
creating the file is enough to add a new component.

```js
// views/components/list.js
import { esc } from "jskelet/html";

/**
 * @param {{ items: string[] }} props
 * @returns {string}
 */
export function list({ items }) {
  if (!items?.length) return "";

  const rows = items.map((item) => `<li class="py-1">${esc(item)}</li>`).join("");
  return `<ul class="mt-6 list-disc pl-6">${rows}</ul>`;
}
```

In the template:

```ejs
<%- list({ items }) %>
```

Rules:

- The scan is recursive; subdirectories are covered too.
- `default` exports are ignored — only named exports are registered.
- The compile-time known-component set is read from **named exports in the
  source**, not from the file basename. `sectionHead` in `ui.js` →
  `<SectionHead />` in the template (runtime already adds a PascalCase alias
  for camelCase exports). You do not need a stub re-export named after the
  file.
- `loader.js` and `index.js` do not count as component files.
- If `views/components/index.js` exists it is loaded first as a **barrel**,
  with the lowest priority. Its only purpose is to turn `lib/` re-exports into
  template locals; the components' own files come later and silently overwrite
  it.
- If the same name (or the same PascalCase tag) is defined in two different
  component files, that is an **error, not a warning**: build and server
  startup stop with `Component 'card' is defined twice: …`. Overwriting the
  barrel is the deliberate exception.
- If the `views/components` directory does not exist the component registry
  stays empty; a project that uses no components works fine too.

## Helpers: `jskelet/html`

They are passed to templates automatically; in component files you get them
with `import { … } from "jskelet/html"`.

### `esc(value)`

Escaping for text content and attribute values (`&`, `<`, `>`, `"`, `'`).
`null`, `undefined` and `false` are turned into the empty string — so in
conditional rendering an expression like `false && "…"` does not print
`"false"`.

```js
esc('<b>"x"</b>');  // "&lt;b&gt;&quot;x&quot;&lt;/b&gt;"
```

### `attrs(object)`

Turns an attribute object into a string. `null`/`undefined`/`false` are
skipped, `true` is written as a boolean attribute, and the remaining values are
escaped. If the output is not empty it comes back **with a leading space**, so
`<div${attrs(...)}>` is always formatted correctly.

```js
`<input${attrs({ type: "text", required: true, value: null })}>`;
// '<input type="text" required>'
```

### `cx(...inputs)`

The `clsx` equivalent: it accepts strings, numbers, arrays and
`{ className: condition }` objects, and drops falsy values. It does **not**
resolve Tailwind conflicts.

```js
cx("btn", isActive && "btn-active", { "btn-lg": size === "lg" });
```

### `cn(...inputs)`

Merges with `cx()`, then resolves Tailwind conflicts with `tailwind-merge`. Use
this when a component's default classes need to be overridable by the caller.

```js
cn("px-4 py-2 bg-slate-100", className);  // if className is "bg-white", bg-slate-100 drops
```

`tailwind-merge` is kept as a runtime dependency because class computation
happens only on the server; it never enters the client bundle.

### `jsonScript(value)`

Safe JSON for the body of a `<script type="application/ld+json">`: `<`, `>`,
`&` and U+2028/U+2029 are escaped, so a `</script` or `<!--` sequence cannot
close the body.

```ejs
<script type="application/ld+json"><%- jsonScript(article) %></script>
```

## Helpers: `jskelet/tags`

The equivalents of `next/link`, `next/image` and `@phosphor-icons/react`. They
all return HTML strings and are emitted from EJS with `<%- %>`.

### `link(props)`

```js
link({
  href: "/about",
  text: "About",
  class: "font-semibold",
  // optional: html, title, ariaLabel, target, rel, attrs
});
```

- If `title` is not given it is filled in automatically in the order
  `ariaLabel` → `text` → `href`.
- If `href` starts with `http://` or `https://`, `target="_blank"` and
  `rel="noopener noreferrer"` are added automatically; if you give them
  explicitly your values are used.
- If `html` is given the content is emitted raw; if `text` is given it is
  escaped.
- The `attrs` object passes extra attributes through and overrides the previous
  ones.

### `image(props)`

```js
image({
  src: "/hero.png",
  alt: "Kapak",
  priority: true,
  // optional: width, height, class, sizes, srcset, fill, loading,
  //           unoptimized, attrs
});
```

Behaviour:

- For local raster images under `public/`, the webp variants generated at build
  time (`.jskelet/images.json`) are added automatically as `srcset` plus
  intrinsic `width`/`height`. Images that are not in the manifest, or remote
  ones, are emitted as-is.
- If `srcset` is given by hand, or `unoptimized: true` is set, the manifest is
  not consulted at all.
- If only **one** variant was produced (because the source is already small),
  `srcset`/`sizes` are not written; they would be pure noise.
- If `sizes` is not given a reasonable default is produced: the image is not
  scaled beyond its own intrinsic width, and it fills the viewport on narrow
  screens (`(max-width: Npx) 100vw, Npx`).
- `priority: true` → `loading="eager"`, `decoding="sync"`,
  `fetchpriority="high"`. For the LCP image.
- Without `priority` → `loading="lazy"`, `decoding="async"`.
- `fill: true` → `width`/`height` are not written and the classes
  `absolute inset-0 h-full w-full object-cover` are merged in with `cn()`.

### `icon(props)`

Emits a `<use>` from the SVG sprite generated at build time.

```js
icon({ name: "ArrowRight", weight: "bold", size: 20, class: "text-slate-500" });
// <svg width="20" height="20" class="…" aria-hidden="true" focusable="false"
//   fill="currentColor" viewBox="0 0 256 256"><use href="/assets/sprite.<hash>.svg#arrow-right-bold"></use></svg>
```

- `name` is the Phosphor name; the forms `ArrowRightIcon` and `ArrowRight` are
  accepted too and converted to `arrow-right` (`toKebab()`).
- `weight` is part of the sprite id: `thin`, `light`, `regular` (the default),
  `bold`, `fill`, `duotone`.
- `size` defaults to 24; it is written as `width` and `height`.
- In development a one-time warning is printed when a symbol that is not in the
  sprite is requested. The sprite contains only the names that are visible
  **statically** in the source; if a call whose name is computed at runtime
  points at a missing symbol, the screen is silently left blank
  ([08-build.md](./08-build.md)).

### `preloadImage(props)`

```js
preloadImage({ href: "/assets/img/hero-1280.abc.webp", imagesrcset, imagesizes });
// <link rel="preload" as="image" href="…" fetchpriority="high">
```

In practice `headHints()` is used rather than calling this directly:

```js
import { headHints } from "jskelet";

return {
  view: "pages/article",
  head: headHints({ href: cover, imageSrcSet, imageSizes }),
};
```

`headHints()` returns the empty string when there is no `href`, so you do not
need to write a condition. Preconnects are not repeated here because the layout
already emits them on every page.

## Metadata → `<head>`

The controller returns `metadata` and the framework turns it into tags (the
equivalent of Next.js's Metadata API). The schema is deliberately small; if you
need more, raw HTML is added through `extraTags`, so the framework does not
have to cut a release for every new kind of meta tag.

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | `string` | `<title>` |
| `titleTemplate` | `string` | `"%s \| Site"` — `title` is embedded into it. Applied only if `title` is also present. |
| `description` | `string` | `<meta name="description">` |
| `canonical` | `string` | Absolute or relative URL |
| `siteUrl` | `string` | Base for making a relative `canonical` absolute |
| `robots` | `{ index?: boolean, follow?: boolean }` | Defaults to `index, follow` |
| `locale` | `string` | `og:locale` |
| `openGraph` | `{ title, description, url, type, siteName, image, imageWidth, imageHeight }` | `og:*` tags |
| `twitter` | `{ card, site, creator, title, description, image }` | `twitter:*` tags |
| `extraTags` | `string[]` | Raw tags to be emitted as-is |

Generation rules:

- **The robots default is indexable.** Hiding a page should be an explicit
  decision: `robots: { index: false }` → `noindex, follow`.
- **OpenGraph uses `property`, not `name`.** Some scrapers ignore og tags
  written with `name`.
- **Inheritance chain:** if there is no `og:title` then `title`, no
  `og:description` then `description`, no `og:url` then the absolutised
  `canonical`, no `twitter:title` then `og:title` → `title`, no
  `twitter:image` then `og:image`.
- **`twitter:card`**, if not given, is `summary_large_image` when there is an
  `og:image` and `summary` otherwise.
- **Empty values are never emitted:** fields that are `null`, `undefined` or
  `""` produce no tag.
- If `og:type` is not given it is `website`.

Example:

```js
return {
  view: "pages/article",
  metadata: {
    title: article.title,
    description: article.summary,
    canonical: `/news/${article.slug}`,
    openGraph: {
      type: "article",
      image: article.cover,
      imageWidth: 1200,
      imageHeight: 630,
    },
    extraTags: [`<meta property="article:published_time" content="${article.date}">`],
  },
};
```

Put fields that are the same on every page, such as `titleTemplate` and
`siteUrl`, into `hooks.metadata()`; the controller only supplies what is
specific to the page.

The `renderHeadMeta(metadata)` function is exported; it can be used when you
need to produce the same tags outside the layout (for example in a fragment or
an email).

## Hooks

Hooks are defined in `jskelet.config.mjs` under `hooks`. They are all optional
and they can all be `async`. **A failing hook does not take the page down:**
the framework falls back to its own default and warns.

### `hooks.metadata(page)`

The metadata default for every page. It receives the page definition being
rendered as its argument and returns a metadata object. The controller's
`metadata` field is layered **on top of it** (field by field, shallow merge).

```js
hooks: {
  metadata() {
    return {
      titleTemplate: "%s | JSkelet",
      description: "A site built with JSkelet.",
      siteUrl: "https://example.com",
    };
  },
}
```

### `hooks.layoutContext({ pathname, metadata })`

The locals added to the layout on every render. **Every field** of the returned
object becomes a layout local; in addition three fields are interpreted
specially:

- `lang` → `<html lang>`
- `structuredData` → JSON-LD scripts (an array)
- `extraHead` → appended to `<head>` (after the controller's `head`)
- `bodyClass` → used if the controller did not supply a `bodyClass`

```js
hooks: {
  async layoutContext({ pathname }) {
    return {
      bodyClass: "min-h-full",
      navigation: await getNavigation(),
      isHome: pathname === "/",
    };
  },
}
```

This hook runs **in parallel** with the body render; calling upstream inside it
does not add sequential latency to the page.

### `hooks.notFound()`

The 404 page definition. The object it returns is handed to `renderPage` with
`pathname: "/404"`. Details: [03-routing.md](./03-routing.md).

### Other hooks

`hooks.prewarmPaths()` belongs to prewarming rather than the render layer; see
[06-caching.md](./06-caching.md).

## The overlay portal point

`jskelet/client` → `getOverlayRoot()` gives the target that modal and drawer
content will be moved into: if the layout has
`<div id="jskelet-overlays"></div>` it goes there, otherwise into `body`. The
portal prevents an ancestor element carrying `overflow` or `transform` from
clipping a `position: fixed` overlay. If you are going to use modals, adding
this div at the end of the layout's `<body>` is enough
([05-islands.md](./05-islands.md)).

## What's next

- Islands and `entries`: [05-islands.md](./05-islands.md)
- `asset()`, the manifest and the Tailwind scan: [08-build.md](./08-build.md)
- Where hooks live in the config: [07-configuration.md](./07-configuration.md)
