# 11 — Migrating from Next.js

This document explains how to move a project using the Next.js App Router over
to JSkelet: a table of concept and API equivalents, an explicit list of what
cannot be migrated, and a step-by-step plan. JSkelet's surface was deliberately
modeled on the subset of Next that people actually use — concepts like the
`next.config` syntax, the Metadata API, `notFound()`, `revalidate` and `cache()`
will feel familiar. The *reasons* behind the differences are in
[02-architecture.md](./02-architecture.md).

## Equivalence table

### Configuration

| Next.js | JSkelet | Note |
| --- | --- | --- |
| `next.config.mjs` | `jskelet.config.mjs` | Same spirit, smaller surface ([07](./07-configuration.md)) |
| `headers()` | `headers()` | Same shape: `{ source, headers: [{ key, value }] }` |
| `redirects()` | `redirects()` | `permanent` → 308, otherwise 307; can be overridden with `statusCode` |
| `rewrites()` | `rewrites()` | There are `beforeFiles` / `afterFiles` phases; no `fallback` |
| `compress: true` | Automatic | brotli + gzip via `node:zlib` |
| `images.deviceSizes` | `images.widths` | Build-time webp generation ([08](./08-build.md)) |
| `NEXT_PUBLIC_*` | `clientEnv: [...]` | Which key is exposed is clear from the config, not from the name |
| `experimental.*` | — | None |

### Routing and rendering

| Next.js | JSkelet | Note |
| --- | --- | --- |
| `app/page.js` (file-based routing) | `app.get(...)` inside `routes/*.mjs` | The order is written explicitly ([03](./03-routing.md)) |
| `app/[slug]/page.js` | `app.get("/:slug", route(...))` | Express pattern syntax |
| `params`, `searchParams` | `ctx.params`, `ctx.query` | The controller's single argument |
| `layout.js` | `views/layout.ejs` + `hooks.layoutContext()` | A single layout; no nested layouts |
| Server component (RSC) | Controller + EJS template + `views/components/**` | A function returns an HTML string |
| Client component (`"use client"`) | Island (`data-island` + `mount`) | The whole page is not hydrated ([05](./05-islands.md)) |
| `notFound()` | `notFound()` | Same name, same control flow |
| `redirect()` | `redirect()` (307) | For permanent, `permanentRedirect()` (308) |
| `not-found.js` | `hooks.notFound()` | Returns a page definition |
| `error.js` | Express error handler | The framework returns minimal HTML for a 500 |
| `loading.js` / Suspense | — | The server HTML is complete; no skeleton needed |
| Streaming SSR | — | The response is a single chunk |
| `generateMetadata()` | Controller `metadata` + `hooks.metadata()` | Same field names ([04](./04-rendering.md)) |
| `generateStaticParams()` | `hooks.prewarmPaths()` | Warming at startup time, not build time |
| Route Handlers (`route.js`) | A plain Express handler | `app.get/post(...)` |
| Middleware (`middleware.ts`) | Express middleware + config `rewrites`/`headers`/`redirects` | `app.use(...)` |

### Data and cache

| Next.js | JSkelet | Note |
| --- | --- | --- |
| `export const revalidate = 60` | `route(controller, { revalidate: 60 })` | Or `cache().html` ([06](./06-caching.md)) |
| ISR (prerender written to disk) | In-memory TTL cache + stale-while-revalidate | Nothing is written to disk |
| `fetch(..., { next: { revalidate } })` | — | The cache is at page level |
| `unstable_cache` | — | No cross-request data cache; there is a page cache |
| React `cache()` | `cache()` | Same behavior: in-request memoization |
| `revalidatePath()` | `clearHtmlCache()` | There is currently no per-key invalidation |
| `cookies()`, `headers()` | `ctx.req.headers`, `ctx.req.cookies`* | Direct access to the Express object |
| `dynamic = "force-dynamic"` | Not passing `revalidate` | Which means the cache is off |

\* Express 5 does not parse cookies on its own; add `cookie-parser` or read the
header manually.

### Components and helpers

| Next.js | JSkelet | Note |
| --- | --- | --- |
| `next/link` | `link({ href, text })` — `jskelet/tags` | `title` automatic, `rel`/`target` automatic for external links |
| `next/link` prefetching | `navigation: { prefetch, prerender }` | Speculation Rules; no client runtime ([07](./07-configuration.md)) |
| `next/image` | `image({ src, alt, priority })` — `jskelet/tags` | `srcset` from the build manifest |
| `next/font/google` | `fonts: [{ family, weights }]` | Self-hosted woff2, committed |
| `@phosphor-icons/react` | `icon({ name, weight })` — `jskelet/tags` | Build-time SVG sprite |
| `react-dom` preconnect/preload | `preconnect: [...]` + `headHints()` | ([04](./04-rendering.md)) |
| `clsx` | `cx()` — `jskelet/html` | — |
| `cn()` (clsx + tailwind-merge) | `cn()` — `jskelet/html` | Same behavior |
| JSX automatic escaping | `esc()` — `jskelet/html` | **You have to call it yourself** |
| React Context | `createStore()` — `jskelet/client` | Minimal pub/sub |
| `useState` / `useEffect` | Plain JS inside the island's `mount()` | — |
| `useSyncExternalStore` | `store.subscribe()` | — |
| `<Script>` | A `<script>` in the layout, or an island | — |

### What has no equivalent

Account for these from the start in your migration plan:

- **React itself.** Components turn into functions that return HTML strings. No
  JSX, no hooks, no virtual DOM.
- **TypeScript.** The project is plain JS + JSDoc. With `checkJs: true` in
  `jsconfig.json` you get type checking from the editor.
- **Nested layouts.** There is a single layout; you share common sections with
  EJS `include` or component functions.
- **Streaming / Suspense / partial prerendering.** The response is produced as a
  single chunk.
- **Client-side routing.** Navigation is a real page load. Because the server
  HTML comes from the cache it is very fast in practice, but there are no SPA
  transitions. What closes the gap is the `navigation` section:
  prefetch/prerender prepares the document before the click, and
  `viewTransition` smooths the transition
  ([07](./07-configuration.md)).
- **Server Actions.** Form submissions are ordinary `app.post(...)` handlers.
- **Per-path invalidation (`revalidatePath`).** For now there is clearing the
  whole cache (`clearHtmlCache()`) or waiting for the TTL to expire.
- **Automatic image optimization (at request time).** Optimization happens at
  build time and only covers local images under `public/`; remote images are
  emitted as-is.

## A side-by-side example

**Next.js (App Router):**

```jsx
// app/haber/[slug]/page.jsx
import { notFound } from "next/navigation";
import Image from "next/image";
import { getArticle } from "@/lib/api";

export const revalidate = 300;

export async function generateMetadata({ params }) {
  const article = await getArticle(params.slug);
  return {
    title: article?.title,
    description: article?.summary,
    alternates: { canonical: `/haber/${params.slug}` },
  };
}

export default async function Page({ params }) {
  const article = await getArticle(params.slug);
  if (!article) notFound();

  return (
    <article className="wrapper">
      <h1 className="text-3xl font-bold">{article.title}</h1>
      <Image src={article.cover} alt={article.title} priority width={1200} height={630} />
      <div dangerouslySetInnerHTML={{ __html: article.body }} />
    </article>
  );
}
```

**JSkelet:**

```js
// routes/50-haber.mjs
import { getArticle } from "@/lib/api.js";

export default function register(app, { route, notFound }) {
  app.get(
    "/haber/:slug",
    route(
      async ({ params }) => {
        const article = await getArticle(params.slug);
        if (!article) notFound();

        return {
          view: "pages/article",
          data: { article },
          metadata: {
            title: article.title,
            description: article.summary,
            canonical: `/haber/${params.slug}`,
            openGraph: { type: "article", image: article.cover },
          },
        };
      },
      { revalidate: 300 },
    ),
  );
}
```

```ejs
<%# views/pages/article.ejs %>
<article class="wrapper">
  <h1 class="text-3xl font-bold"><%= article.title %></h1>
  <%- image({ src: article.cover, alt: article.title, priority: true, width: 1200, height: 630 }) %>
  <div><%- article.body %></div>
</article>
```

Wrapping `getArticle` with `cache()` makes sure that if
`hooks.layoutContext()` asks for the same article in the same render, only a
single upstream request is made ([06-caching.md](./06-caching.md)).

## Step-by-step plan

### 1. Set up the skeleton (half a day)

Run `npx jskelet init` in a new directory and watch `jskelet dev` come up. Leave
the existing Next project as it is; let the migration run in parallel.

Carry over the `paths` aliases from your `jsconfig.json` — prefixes like `@/`
work the same way both on the server and in the bundle
([02-architecture.md](./02-architecture.md)).

### 2. Translate `next.config.mjs` (1-2 hours)

The `headers()`, `redirects()` and `rewrites()` sections are copied almost
verbatim. Check the pattern syntax: JSkelet supports the `:slug`, `:path*`,
`/a-:b` and `/:path*.svg` forms; more complex `path-to-regexp` expressions are
not supported and produce a warning ([07-configuration.md](./07-configuration.md)).

Move your `NEXT_PUBLIC_*` variables into the `clientEnv` list and simplify their
names (the prefix no longer carries meaning).

### 3. Move the data layer (the easiest step)

The API client and data functions under `lib/` usually do not depend on React;
they are copied as-is. Make two changes:

- Use `import { cache } from "jskelet"` instead of React's `cache()`.
- Call `reportUpstreamFailure({ status, path })` on failed upstream responses.
  This prevents pages produced with missing data from being written to the cache
  ([06-caching.md](./06-caching.md)).

### 4. Set up the layout (half a day)

Translate `app/layout.jsx` into `views/layout.ejs`. Copying the framework's
default layout (`node_modules/jskelet/src/templates/layout.ejs`) and editing it
is the fastest path.

If you fetch data inside `layout.jsx` (navigation, site settings), move it into
`hooks.layoutContext()`: it runs in parallel with the body render, and every
field it returns becomes a layout local.

Put your global metadata defaults (`titleTemplate`, `siteUrl`, `description`)
into `hooks.metadata()`.

### 5. Translate the components (the longest step)

Every React component turns into a function:

```jsx
// Before
export function Badge({ label, tone = "neutral", className }) {
  return <span className={cn("rounded px-2 py-1", TONES[tone], className)}>{label}</span>;
}
```

```js
// After — views/components/badge.js
import { attrs, cn, esc } from "jskelet/html";

export function badge({ label, tone = "neutral", class: className }) {
  return `<span${attrs({ class: cn("rounded px-2 py-1", TONES[tone], className) })}>${esc(label)}</span>`;
}
```

Things to watch out for:

- **Escaping is now on you.** JSX escaped automatically; here you must call
  `esc()` when printing external data.
- **`className` → `class`.** Since `class` is a reserved word in JS, rename it in
  the props as `class: className`.
- **An `html` field instead of children.** Nested content is passed as a string.
- Every function you place under `views/components/**` as a named export can be
  used in templates without importing it
  ([04-rendering.md](./04-rendering.md)).

Keep components small and pure; leave data fetching in the controller.

### 6. Migrate the pages (hours per page)

Every `page.jsx` splits into a controller plus an EJS template. File them with
the order in mind:

```
routes/
├── 00-health.mjs        health check
├── 10-pages.mjs         static paths: /, /hakkinda
├── 50-haber.mjs         /haber/:slug
└── 99-catch-all.mjs     /:slug  (if any, last of all)
```

The places where you used `generateStaticParams()` turn into
`hooks.prewarmPaths()`. If you have a function that produces the sitemap, use
the same one.

Move your `export const revalidate` values either into `route()`'s second
argument or, to manage them from a single place, into `cache().html` patterns.

### 7. Turn client components into islands (hours per page)

Every `"use client"` component becomes an island. The process:

1. Move the component's **static** output into the server template. Everything
   visible on first render must be in the HTML.
2. Write the remaining behavior inside `mount(element, props)`: `useState`
   becomes a local variable, `useEffect` a direct call, event handlers
   `on()`/`onClick()`.
3. Pass props as JSON with `data-island-props`.
4. Add it to the `registerAll()` map in the entry.
5. Choose the binding strategy: the default (visibility), `data-island-eager`
   (global behavior) or `data-island-idle` (heavy and non-critical).

For components using Context, `createStore()` is the closest equivalent
([05-islands.md](./05-islands.md)).

**This is where the biggest win of this step lies:** the hydrated area is not
the whole page, only the parts that are genuinely interactive.

### 8. Move the CSS (1-2 hours)

If your Tailwind configuration is already in v4 format, `styles/globals.css`
stays almost the same. The one critical addition is the `@source` directives:

```css
@import "tailwindcss" source(none);

@source "../views";
@source "../client";
@source "../routes";
@source "../lib";
```

Without these, the classes used in templates (especially variants like
`data-[state=open]:…`) are silently dropped
([08-build.md](./08-build.md)).

If you use `next/font`, add `fonts: [{ family, weights }]` and write the
`@font-face` blocks by hand; the generated files sit under `public/fonts/` with
stable names.

### 9. Verify and measure

- Browse with `jskelet dev` and confirm there are no errors in the dev overlay.
- On the report page (`/__jskelet/dev/report`), look at each page's Web Vitals
  measurements, SSR size and island status ([09-dev-tools.md](./09-dev-tools.md)).
- Clear the missing-icon warnings.
- Compare the sizes in the `jskelet build` output with your old Next bundle.
- Check that the `X-JSkelet-Cache` header returns `HIT` on the pages you expect.

### 10. Go live

Go through the checklist in [10-deployment.md](./10-deployment.md). Keeping the
old Next setup alongside for a while and shifting traffic gradually is useful,
especially for verifying that the redirect rules are correct.

## Common mistakes during migration

- **Forgetting `esc()`.** Writing `${value}` out of JSX habit means XSS. In
  templates, mind the distinction between `<%= %>` (escaped) and `<%- %>` (raw).
- **Opening a new directory without adding `@source`.** The classes are silently
  dropped.
- **Putting the catch-all route in the wrong order.** `/:slug` always goes last.
- **Making the whole page an island.** The win comes from the server HTML being
  complete; bind the island only to the genuinely interactive part.
- **Forgetting to pass `revalidate`.** The cache stays off, every request is
  rendered, and `X-JSkelet-Cache: MISS` is returned.
- **Not calling `reportUpstreamFailure()`.** When the upstream goes down, the
  page produced with missing data is served for the entire TTL.
- **Putting a secret key in `clientEnv`.** The values sit in the bundle as plain
  text.

## What's next

- The reasons behind the architectural decisions:
  [02-architecture.md](./02-architecture.md)
- Details of the island model: [05-islands.md](./05-islands.md)
- Configuration reference: [07-configuration.md](./07-configuration.md)
