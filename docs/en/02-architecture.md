# 02 — Architecture and the reasoning behind the decisions

This document does not explain how JSkelet works, but **why it works this way**.
The path a request takes from the server to the browser, why the island model is
tied to visibility, why the HTML is produced in full, why the cache lives in
process memory and why the middleware order must not be shuffled — that is all
here. Most of the reasoning comes from the measurement notes in the headers of
the source files; for the APIs themselves see documents
[03](./03-routing.md), [04](./04-rendering.md), [05](./05-islands.md) and
[06](./06-caching.md).

## The basic premise

On a news or content site, almost everything the visitor sees is already ready
on the server. Interaction, on the other hand, is scattered point by point: a
search box, a drawer, a chart, a comment form. With that profile, rebuilding the
whole page on the client (hydration) is the biggest cost you pay, and in return
the visitor gains nothing.

JSkelet puts this observation at the centre of the architecture:

1. **The server HTML is complete.** Even if JS never runs, the page can be read,
   navigated and indexed.
2. **JS only adds behaviour.** Every interactive piece is attached as an
   independent "island", with its own module, at its own time.
3. **Page production is cached.** There is no point in producing the same HTML
   again on every request; a memory cache with a TTL takes the place of ISR.
4. **Templates are compiled at build time (`.jsk`).** No request-time parsing;
   EJS remains as a legacy path. Features may co-locate under
   `features/<name>/{server,views,client}` — route URLs stay explicit.

## The path of a request

```
Request
 ├─ rewrites(beforeFiles)          config → proxy or a change to req.url
 ├─ compression                    brotli/gzip negotiation (quality 5)
 ├─ headers                        static cache + config headers()
 ├─ devGate                        if DEV_TOKEN is set, 404 without a token
 ├─ redirects                      config redirects(), first match wins
 ├─ trailingSlash                  308 when config trailingSlash is true
 ├─ staticPrecompressed            .br/.gz copies produced at build (quality 11)
 ├─ express.static                 files under public/
 ├─ (dev) devtools                 only when NODE_ENV=development
 ├─ admin (if enabled)             /_jskelet/admin
 ├─ image optimizer (remote)       /_jskelet/image — when allowHosts is set
 ├─ body parsers                   urlencoded 64kb + json 256kb
 ├─ rewrites(afterFiles)           after static has been tried
 ├─ routes
 │   └─ route(controller)
 │       └─ withHtmlCache          TTL + stale-while-revalidate
 │           └─ withUpstreamTracking
 │               └─ withRequestCache
 │                   └─ controller → renderPage → EJS
 ├─ 404 → hooks.notFound()
 └─ error handling                 redirect/notFound + 500 fallback
```

## Why the middleware order is this order

The real value of the `src/server/create-app.js` file is the order; every
position has a reason, and moving things around leads to silent breakage.

- **`rewrites(beforeFiles)` comes even before static files.** Otherwise a rule
  that moves the `/assets/x.js` path somewhere else would never take effect,
  because `express.static` answers the request first.
- **`compression` before static.** If it came after, static files would never be
  compressed.
- **`headers` → `devGate` → `redirects` → `trailingSlash`.** The gate's 404 must
  come before the redirects: an environment that has not gone live should not
  leak even its redirect rules to the outside. `trailingSlash` sits after config
  redirects so explicit rules see the requested path first; the canonical slash
  form is enforced as a second step.
- **`staticPrecompressed` before `express.static`.** If there are `.br`/`.gz`
  copies produced at build time, those are served (brotli quality 11);
  otherwise the request falls through to the `static` below it and the
  middleware compresses on the fly (quality 5). Recompressing a hashed,
  `immutable` file on every request is wasted CPU.
- **Admin panel** (when `admin().enabled` / `JSKELET_ADMIN`): after static,
  before body parsers and routes. Carries its own body parsers so the app
  cannot shadow the path. When off, the module is never loaded.
- **Body parsers after static.** Image requests should not pay the cost of body
  parsing.
- **`rewrites(afterFiles)` after static has been tried and before pages.** The
  equivalent of Next.js's two-phase rewrite semantics.
- **404 and error handling last.** The error handler also catches the
  `notFound`/`redirect` control flow, because those can be thrown outside a
  controller as well (e.g. inside a middleware).

The framework turns off `x-powered-by` and writes a brandable header in its
place, sets `etag` to `strong` and enables `trust proxy`. `trust proxy` is
required for the correct protocol and client IP behind a reverse proxy
([10-deployment.md](./10-deployment.md)).

## The island model: why visibility-based hydration

`src/client/registry.js` hands every `[data-island]` element to an
`IntersectionObserver` (`rootMargin: "200px 0px"`). Elements on screen are
triggered on the very first observation; those off screen are **never
downloaded** until they are scrolled to. Heavy modules like the chart library on
the home page thus drop out of the initial load entirely.

There are three behaviours, all controlled from the HTML:

- **Default:** tied to visibility.
- **`data-island-eager`:** independent of visibility, attaches immediately. For
  global behaviours like the header or the cookie banner.
- **`data-island-idle`:** even if it is visible, it waits until `load` has
  completed and the main thread is free. So that heavy modules that are visible
  in the first viewport but not critical (e.g. a mini chart that pulls in a
  chart library) do not compete with LCP.

Two further details came out of measurement:

- **The attaching work is deferred to idle time** (`requestIdleCallback`,
  `timeout: 500`). If many islands that become visible at once turn into a
  single long task, TBT and INP suffer.
- **Elements with no layout box are attached directly.** A `hidden`
  drawer/dialog has no layout box and `IntersectionObserver` will never report
  it; that is why `hydrate()` reads the measurements in one pass
  (`getClientRects().length`) and, instead of handing boxless elements to the
  observer, attaches them immediately.

One consequence of this: **image error handling is not an island.** An
image-heavy page can have 80+ `<img>` elements, and attaching a separate island
to each one (observer + dynamic import + mount) is a serious hydration cost just
for the possibility of an error. `startSafeImages()` instead installs a single
capture-phase listener on the document ([05-islands.md](./05-islands.md)).

## Why the server HTML is complete

The layout and the page template produce the entirety of the content the visitor
will see. There is no "show a skeleton, then fill it in" pattern on the client
side. This buys three things:

1. **SEO:** the crawler does not have to wait for JS.
2. **LCP:** the largest contentful element arrives in the first HTML response;
   downloading, parsing and executing JS is not on the LCP path.
3. **CLS:** because content is not injected later, the layout does not shift.

The same principle is applied on the `<head>` side too. The layout prints
resource hints (`preconnect`, LCP `preload`) at the **very beginning** of the
`<head>`; delaying those writes straight to LCP.

### Why a single, render-blocking stylesheet

No separate "critical CSS" is produced. In measurement, because the inline
critical CSS did not fully cover the first viewport, the page reflowed once the
sheet arrived (CLS 0.307 on a list page) and the same ~27 KB was repeated in
every HTML response. Leaving a single compressed sheet render-blocking is both
faster and free of CLS; on the second visit it already comes from the
`immutable` cache.

The same logic applies to icons: instead of a separate request per icon, an SVG
sprite is produced at build time from only the symbols actually used in the
source. Shipping the whole Phosphor set is 1500+ icons, that is several
megabytes; the scan typically keeps the sprite at 10-30 symbols
([08-build.md](./08-build.md)).

## Cache strategy: in-memory TTL instead of ISR

`src/server/html-cache.js` keeps an LRU HTML cache with a TTL, keyed by route +
query (at most 500 entries). When the TTL expires the entry is not thrown away
immediately: within the `stale` window the old HTML returns instantly and the
refresh runs in the background (stale-while-revalidate, `STALE_FACTOR = 1`, i.e.
the stale window is as long as the TTL).

The gain: after the first warm-up no request ever waits for a render. The price:
the data in the HTML can be at most `revalidate + one refresh round` behind.
That price is acceptable, because live fields such as prices are updated on the
client from a WebSocket and the lag is not visible on screen.

The decision not to write to disk is deliberate. The equivalent of Next's
build-time prerender is prewarm, but the output is not written to disk: because
the cache lives in process memory, the warm-up is done when the process comes
up. The gain is the same — the first visitor does not wait for a cold render —
but the data is not frozen; every entry ages with the route's `revalidate`
duration ([06-caching.md](./06-caching.md)).

### Keeping the compressed body in the cache

Every cached entry stores the brotli/gzip output alongside the HTML (the
`encoded` map shares its lifetime with the HTML). The same page is not
re-brotli'd on every request. Because `Content-Encoding` is set inside `route()`
on this path, the compression middleware does not kick in.

### Why transient and permanent upstream errors are handled differently

If an upstream went down during the render, the output contains incomplete data,
and such HTML is **not** written to the cache: the next request tries again.

But this only applies to *transient* errors (network errors, 408, 425, 429 and
all 5xx). Deterministic answers like 400/403/404 do not get better by retrying;
turning off the cache because of them would mean rendering the page from scratch
on every visit — the content comes back in the same incomplete state anyway, the
visitor merely pays the render time. That is why permanent errors are only
logged and do not block the cache.

The direction in which this information reaches the framework is also
deliberately inverted: the framework does not know the data layer, the data
layer notifies the framework (`reportUpstreamFailure()`). If nobody ever calls
it, the cost is an empty array.

### The nesting order of the three scopes

`route()` sets up this order:

```
withHtmlCache( withUpstreamTracking( withRequestCache( controller ) ) )
```

The order matters: **the per-request cache must be innermost** so that two calls
within the same render collapse into a single upstream request; **upstream
tracking must be inside the HTML cache** so that output produced with incomplete
data is not written to the cache.

## Fault tolerance: no single gap takes the site down

There is a principle repeated throughout the framework: missing configuration or
missing build output produces a degraded but working page instead of an error.

- **If the config file is missing or unreadable**, a warning is printed and the
  server comes up with the defaults. A broken edit must not make the site
  impossible to open. In the same way, if one of the
  `headers()`/`redirects()`/`rewrites()`/`cache()` sections throws, only that
  section is ignored.
- **If hooks throw**, the framework falls back to its own default and warns.
- **If the build did not run**, `asset()` returns `/assets/<name>`, `hasAsset()`
  is false and the layout does not print the stylesheet/script tags at all. When
  `jskelet build` is forgotten you see an unstyled but working page instead of
  an error.
- **A broken route module in dev** prints a warning and is skipped; **in
  production it throws.** Going live with a half-built route table means pages
  that silently return 404.
- **If the 404 render blows up too**, a minimal, template-free HTML is returned;
  the visitor should not see an empty response.
- **A single request error does not take the process down:**
  `unhandledRejection` and `uncaughtException` are logged and the process stays
  up. On a news site, an error on a single page must not take the whole site
  down.

## Why there is no file-system-based routing

Order matters. If a single-segment catch-all such as `/:slug` is registered
before the `/about` route, "about" is mistaken for a slug. Making the order
visible instead of hiding it in file names makes diagnosis easier: either you
give an explicit list via `jskelet.config.mjs` → `routes`, or you have the
`routes/` directory scanned alphabetically and put a numeric prefix on the file
names (`10-pages.js`, `50-blog.js`, `99-catch-all.js`). Details:
[03-routing.md](./03-routing.md).

## Why a single source of truth for config

`src/config/index.js` normalizes the project root, the directory paths, the
branding, the hooks and the rules. Other modules do not compute paths, they call
`getConfig()`. The reason is concrete: once the framework lives inside
`node_modules/`, every file that tries to find the root by counting `../..`
breaks. For the same reason there is a single mutation point on the build side
too (`initBuildPaths()`).

If `getConfig()` is used without `loadConfig()` having been called, it throws
instead of assuming an empty project root: a silently wrong path turns into
hard-to-diagnose problems like "why is there no stylesheet".

## Why this dependency list

There are four runtime dependencies: `express`, `ejs`, `esbuild`,
`tailwind-merge`. Everything else (Tailwind, PostCSS, lightningcss, sharp, the
Phosphor icons) is an **optional peer dependency**, and if it is absent the
corresponding build step is skipped.

Two decisions deserve a separate explanation:

- **`node:zlib` instead of the `compression` package.** The package does not
  support brotli and brings a seven-deep dependency tree; doing the brotli +
  gzip negotiation by hand is enough. Brotli is preferred: on the home page HTML
  it is ~35% smaller than gzip.
- **`tailwind-merge` stays at runtime.** Class computation is done only on the
  server, it never enters the client bundle, so it has no effect on page weight.
  A hand-written group table, on the other hand, produced visual regressions
  because it mixed up width/colour pairs like `border-2` +
  `border-transparent` and dropped classes.

Optional packages are resolved from the **application's** `node_modules`, not
from the framework's own. If the framework is installed via a `file:` or
workspace link, a plain `import "postcss"` looks in the framework's tree — not
in the application's.

## Why alias and extension hooks

`node --import jskelet/register` does two things:

1. It resolves the `compilerOptions.paths` aliases in `jsconfig.json` /
   `tsconfig.json` (`@/lib/x` → `<root>/lib/x`). Because the editor and the
   runtime are fed from the same file, the two do not drift apart.
2. It adds extensions to extensionless relative imports (`./cache` →
   `./cache.js`). Node ESM does not do this, and it is the most common breaking
   point in code migrated from a bundler.

The `@/` resolution on the esbuild side mimics the same behaviour, so that
modules under `lib/` can use the same import style both on the server and in the
browser.

`--import` expects a module **specifier**, not a file path. On Windows an
absolute path like `H:\...` is mistaken for a URL with the `h:` scheme and
rejected; that is why the framework uses `pathToFileURL(...).href` everywhere.
For the same reason the config, the route modules and the components are
imported with a `file://` URL too.

## What's next

- The route and controller contract: [03-routing.md](./03-routing.md)
- The template layer and metadata: [04-rendering.md](./04-rendering.md)
- The island runtime API: [05-islands.md](./05-islands.md)
- Cache settings and prewarm: [06-caching.md](./06-caching.md)
- The inner workings of the dev flow: [09-dev-tools.md](./09-dev-tools.md)
