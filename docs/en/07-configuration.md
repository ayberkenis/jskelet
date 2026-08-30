# 07 — Configuration reference

This document is the complete reference for `jskelet.config.mjs`: every field,
its type, its default and an example. After that come the `source` pattern
syntax and a table of every environment variable the framework reads. Links to
the relevant documents are given for behavioural details of the fields; the goal
here is to present the full list at a glance.

## Where the file lives and how it is loaded

The config file is looked up in the project root under the name
`jskelet.config.mjs` and it is **not required**. If it is missing or cannot be
read, a warning is printed and the server comes up with defaults; a broken edit
should not make the site impossible to open.

```js
// jskelet.config.mjs
export default {
  // …
};
```

If there is no default export, the module itself is used as the config (named
exports).

The `headers()`, `redirects()`, `rewrites()` and `cache()` sections may be a
function **or a plain value**; when they are functions they may be `async`, and
`this` is bound to the config object. If a section throws, only that section is
ignored.

When the config loads successfully, a summary is printed:
`[config] jskelet.config.mjs loaded — 3 headers, 2 redirects, 1 cache rule`

## Full example

```js
// jskelet.config.mjs
export default {
  paths: {
    views: "views",
    public: "public",
    client: "client",
    routes: "routes",
    styles: "styles/globals.css",
    generated: ".jskelet",
  },

  brand: {
    name: "Example",
    poweredBy: "Example",
    cacheHeader: "X-Example-Cache",
    devBasePath: "/__example/dev",
    prewarmUserAgent: "example-prewarm",
    devTokenCookie: "dev_token",
    lang: "tr",
  },

  layout: "views/layout.ejs",
  routes: ["./routes/10-pages.mjs", "./routes/99-catch-all.mjs"],

  static: {
    extensions: [".svg", ".png", ".webp", ".avif", ".ico", ".woff2"],
    prefixes: ["/assets/", "/fonts/"],
  },

  devGateBypass: ["/api/healthcheck", "/robots.txt"],
  preconnect: ["https://cdn.example.com"],

  security: {
    trustProxy: true,
    cookieSecret: process.env.JSKELET_SECRET,
    csrf: {
      enabled: true,
      token: false,
      allowedOrigins: [],
      exclude: ["/webhook/:path*"],
      cookieName: "csrf_token",
      fieldName: "_csrf",
      headerName: "x-csrf-token",
    },
  },

  navigation: {
    prefetch: "moderate",
    prerender: "conservative",
    viewTransition: true,
    exclude: ["/logout"],
  },

  prewarmSkip: ["/api/", "/_fragment/", "/__example/"],
  watch: ["data"],

  fonts: [{ family: "Inter", weights: [400, 600, 700] }],
  icons: { scan: ["views", "client", "routes", "lib"] },
  images: { widths: [400, 800, 1200], quality: 78, skip: ["downloads"] },
  clientEnv: ["PUBLIC_WS_URL"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },

  async redirects() {
    return [{ source: "/eski/:slug", destination: "/yeni/:slug", permanent: true }];
  },

  async rewrites() {
    return {
      afterFiles: [
        { source: "/api/:path*", destination: "https://api.example.com/:path*" },
      ],
    };
  },

  async cache() {
    return {
      html: { "/": 60, "/news/:slug": 300 },
      maxEntries: 500,
      data: { maxEntries: 10000, staleFactor: 10 },
      prewarm: {
        enabled: true,
        max: 400,
        concurrency: 4,
        rps: 0,
        intervalSeconds: 0,
        rotate: true,
        priority: ["/", "/news/:slug"],
      },
    };
  },

  hooks: {
    metadata() { /* … */ },
    layoutContext() { /* … */ },
    notFound() { /* … */ },
    error() { /* … */ },
    prewarmPaths() { /* … */ },
  },
};
```

## `paths`

**Type:** `Record<string, string>` — **Default:** the table below

Names of the directories (and, for `styles`, the file) in the project root.
Values are resolved relative to the project root and turned into absolute paths
internally.

| Key | Default | Contents |
| --- | --- | --- |
| `views` | `"views"` | EJS layout, pages, components |
| `public` | `"public"` | Static files; the build output is written here too |
| `client` | `"client"` | Island runtime sources and entries |
| `routes` | `"routes"` | Route modules |
| `styles` | `"styles/globals.css"` | Tailwind/PostCSS entry **file** |
| `generated` | `".jskelet"` | `manifest.json`, `metafile.json`, `images.json` |

Even though `styles` is a file path it goes through the same resolution; keeping
a separate field for it is not worth it.

Two paths are always derived and cannot be overridden: `public/assets` (hashed
build output) and `public/fonts` (self-hosted fonts).

```js
paths: { views: "src/views", routes: "src/routes", styles: "src/styles/main.css" }
```

## `brand`

**Type:** `object` — **Default:** the table below

Branding and names that can be changed from a single place. Projects that fork
the framework or white-label it can put their own name in. Provided fields are
shallow-merged with the defaults.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | `string` | `"JSkelet"` | Display name |
| `poweredBy` | `string` | `"JSkelet"` | Value of the `X-Powered-By` header |
| `cacheHeader` | `string` | `"X-JSkelet-Cache"` | HTML cache status header ([06-caching.md](./06-caching.md)) |
| `devBasePath` | `string` | `"/__jskelet/dev"` | Root of the dev overlay and report endpoints |
| `prewarmUserAgent` | `string` | `"jskelet-prewarm"` | UA of prewarm requests; the dev panel filters on it |
| `devTokenCookie` | `string` | `"dev_token"` | Name of the dev gate's cookie and query parameter |
| `lang` | `string` | — | Default for `<html lang>`. If not given, the layout uses `"en"`. |

Precedence for `lang`: `hooks.layoutContext()` → `lang` **>** `brand.lang`
**>** `"en"`.

```js
brand: { lang: "tr", poweredBy: "Example", cacheHeader: "X-Example-Cache" }
```

## `layout`

**Type:** `string` — **Default:** none (automatic resolution)

Path of the layout `.ejs` file. The value given is resolved relative to the
**parent directory of the views directory**, so with the default `views`,
`"views/custom.ejs"` → `<root>/views/custom.ejs`.

If not given, in order: `views/layout.ejs` if it exists, otherwise the
framework's minimal layout. Details: [04-rendering.md](./04-rendering.md).

## `routes`

**Type:** `string[]` — **Default:** `null` (directory scan)

Explicit list of route modules, relative to the project root. They are loaded in
the given order. If not given, the `paths.routes` directory is scanned
alphabetically and recursively. Details: [03-routing.md](./03-routing.md).

```js
routes: ["./routes/api.js", "./routes/pages.js", "./routes/catch-all.js"]
```

## `static`

**Type:** `{ extensions?: string[], prefixes?: string[] }` — **Default:**
below

Static file detection by extension and prefix. Paths matching this list get
`Cache-Control: public, max-age=31536000, immutable`.

| Field | Default |
| --- | --- |
| `extensions` | `[".svg", ".png", ".webp", ".avif", ".ico", ".woff2"]` |
| `prefixes` | `["/assets/", "/fonts/"]` |

If provided, it **replaces** the default (it is not merged), so if you want to
add to the default, write out the full list.

```js
static: {
  extensions: [".svg", ".png", ".webp", ".avif", ".ico", ".woff2", ".mp4"],
  prefixes: ["/assets/", "/fonts/", "/video/"],
}
```

## `devGateBypass`

**Type:** `string[]` — **Default:**
`["/api/healthcheck", "/robots.txt", "/sitemap.xml", "/site.webmanifest", "/favicon.ico"]`

**Exact** paths the dev gate never closes off under any circumstances (not a
prefix, an exact match). This is so that the health check and the robots files
stay reachable in an environment where `DEV_TOKEN` is set. If provided, it
replaces the default.

Details: [09-dev-tools.md](./09-dev-tools.md).

## `preconnect`

**Type:** `string[]` — **Default:** `[]`

Third-party origins; printed as `<link rel="preconnect">` in the `<head>` of
every page. The image CDN, the API origin, the font host go here. Values are
normalised with `new URL(...).origin`; an invalid URL is skipped and a warning
is printed.

Since the list is the same on every page, it is computed once and stored. An
empty list is a valid configuration.

```js
preconnect: ["https://cdn.example.com", "https://api.example.com"]
```

## `security`

**Type:** `object` — **Default:**
`{ trustProxy: true, cookieSecret: null, csrf: { enabled: true, token: false, … } }`

The whole picture for per-visitor pages, with the reasoning, is in
[12-dashboards-and-sessions.md](./12-dashboards-and-sessions.md); this is the
field reference.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `trustProxy` | `boolean` | `true` | Express's `trust proxy` setting. Needed behind a reverse proxy for the correct protocol and client IP. |
| `cookieSecret` | `string \| null` | `null` | The signed cookie secret. When absent, `JSKELET_SECRET` is read. |
| `csrf.enabled` | `boolean` | `true` | The origin / `Sec-Fetch-Site` check. |
| `csrf.token` | `boolean` | `false` | The double-submit token layer. |
| `csrf.allowedOrigins` | `string[]` | `[]` | Origins accepted alongside our own host. |
| `csrf.exclude` | `string[]` | `[]` | Paths exempt from the check; `source` pattern syntax. |
| `csrf.cookieName` | `string` | `"csrf_token"` | Name of the token cookie. |
| `csrf.fieldName` | `string` | `"_csrf"` | Field name printed by `csrfField()`. |
| `csrf.headerName` | `string` | `"x-csrf-token"` | Header the token is also accepted in. |

`trustProxy` should be **turned off** on a server exposed directly to the
internet: while it is on, a client can forge its own `X-Forwarded-For` and rate
limiting or audit logs see the wrong address.

The CSRF check only rejects requests that are **known** to be cross-site — when
`Origin` does not match or `Sec-Fetch-Site: cross-site` arrives. If neither is
present the request passes, because browsers always send `Origin` on a
cross-origin POST while webhooks never do. Even so, listing non-browser
endpoints in `csrf.exclude` makes the intent readable.

## `navigation`

**Type:** `object` — **Default:**
`{ prefetch: "moderate", prerender: false, viewTransition: false, exclude: [] }`

`<head>` hints that speed up in-site navigation. Since JSkelet is a classic MPA,
every click is a full page load; this section makes the browser do that load
**ahead of time**. No client runtime is added — Speculation Rules and view
transitions are browser capabilities, and in a browser that does not support
them they are silently ignored.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `prefetch` | `false \| "conservative" \| "moderate" \| "eager"` | `"moderate"` | Downloads the link target's **document** ahead of time |
| `prerender` | same | `false` | **Fully renders** the target in the background; it opens the moment you click |
| `viewTransition` | `boolean` | `false` | Emits `@view-transition { navigation: auto }` |
| `exclude` | `string[]` | `[]` | href patterns to keep out of speculation |

If `true` is given, `prefetch`/`prerender` fall back to the default eagerness; an
unrecognised value prints a warning and reverts to the default.

**What eagerness means:** `conservative` triggers the moment the link is pressed,
`moderate` when the pointer lingers on the link for a while, `eager` as soon as
the link becomes visible. The further up you go, the higher the hit rate — and
the more wasted requests.

**Why `prerender` ships off.** The scripts of a prerendered page really do run.
In an application that does not hook its measurement code to the
`prerenderingchange` event, visit counts get inflated. Review your analytics
before turning it on; the cost on the server side is low, because a speculative
request is also served from the HTML cache
([06-caching.md](./06-caching.md)).

**Always exempt.** Paths under `/api/*`, `/_fragment/*` and `brand.devBasePath`
are excluded automatically; `exclude` is added on top of those. Additionally,
links carrying `rel="nofollow"`, `target="_blank"` or `data-no-prefetch` are not
covered by any rule. The easiest way to keep a single link with side effects out
is the last one:

```html
<a href="/logout" data-no-prefetch>Logout</a>
```

**When turning on `viewTransition`, put the background on `<html>`.** During the
transition the browser cross-fades snapshots of the old and the new page; a
background set on `<body>` stays inside that snapshot and the canvas underneath
becomes visible. The result is one frame of white flash on every transition, and
it does not go unnoticed in a dark theme. If the colour is on `<html>` (or
`:root`), no such gap appears:

```html
<html lang="tr" class="bg-white dark:bg-slate-950">
  <body class="text-slate-900 dark:text-slate-100">
```

The reduced-motion preference is handled by the framework: under
`prefers-reduced-motion: reduce` the transition is disabled, and you do not need
to write anything extra.

**Scope the transition to the content.** The default behaviour cross-fades the
whole document as a single piece, which means the header and footer — which
never change across navigations — flicker too. Giving those regions a
`view-transition-name` puts them in their own group; because the browser sees the
same name in both documents, it treats them as "the same element". Once you turn
off the animation of the named element, the transition stays in the content
only:

```css
body > header { view-transition-name: site-header; }
body > footer { view-transition-name: site-footer; }

::view-transition-old(site-header),
::view-transition-old(site-footer) { animation: none; opacity: 0; }
::view-transition-new(site-header),
::view-transition-new(site-footer) { animation: none; opacity: 1; }

/* The remaining content; the default 250ms makes navigation feel slow. */
::view-transition-old(root),
::view-transition-new(root) { animation-duration: 180ms; }
```

A working version lives in `examples/marketing/styles/globals.css`.

**If you use CSP**, the rules are emitted as an inline
`<script type="speculationrules">`; your `script-src` policy needs to allow it.

```js
navigation: {
  prefetch: "moderate",
  prerender: "conservative",
  viewTransition: true,
  exclude: ["/logout", "/cart/*"],
}
```

## `prewarmSkip`

**Type:** `string[]` — **Default:** `["/api/", "/_fragment/", "/__jskelet/"]`

Path **prefixes** that prewarming skips. Session-dependent or fragment endpoints
should not be prewarmed. If provided, it replaces the default — if you changed
`brand.devBasePath`, do not forget to update this list too.

Details: [06-caching.md](./06-caching.md).

## `watch`

**Type:** `string[]` — **Default:** `[]`

**Additional** directories that `jskelet dev` watches for server restarts,
relative to the project root. `routes`, `views` and `lib` are already watched;
`client/` and `styles/` are handled by the esbuild and CSS watchers and should
not be put here.

Only files with the `.js`, `.mjs`, `.json` and `.ejs` extensions are triggers.

```js
watch: ["data", "content"]
```

Details: [09-dev-tools.md](./09-dev-tools.md).

## `fonts`

**Type:** `{ family: string, slug?: string, weights?: number[] }[]` —
**Default:** `[]`

Google Fonts families to self-host. If left empty, the font step never runs.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `family` | `string` | — | Google Fonts family name: `"Inter"`, `"Noto Sans"` |
| `slug` | `string` | derived from `family` (lower case, space → `-`) | File name prefix |
| `weights` | `number[]` | `[400]` | Weights to download |

Output: `public/fonts/<slug>-<weight>.woff2`, with the same file name as the
manifest key. The files have **fixed names** (no hash) and are **expected to be
committed**. Details: [08-build.md](./08-build.md).

```js
fonts: [
  { family: "Inter", weights: [400, 600, 700] },
  { family: "Noto Serif", slug: "serif", weights: [400] },
]
```

## `icons`

**Type:** `{ scan?: string[] } | false` — **Default:** `{}`

Phosphor SVG sprite generation.

| Value | Result |
| --- | --- |
| `{}` (default) | The sprite is generated; scanned directories are `["views", "client", "routes", "lib"]` |
| `{ scan: [...] }` | Changes the scanned directories |
| `false` | The sprite step is skipped entirely |

If `@phosphor-icons/core` is not in the application's `node_modules`, the step is
silently skipped. Details: [08-build.md](./08-build.md).

```js
icons: { scan: ["views", "client", "routes", "lib", "content"] }
```

## `images`

**Type:** `{ widths?: number[], quality?: number, skip?: string[] } | false` —
**Default:** `{}`

Generates webp variants of the png/jpg images under `public/`.

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `widths` | `number[]` | `[400, 640, 960, 1280, 1920]` | Widths to generate. Ones larger than the source are dropped; the source's own width (at most 1920) is always added. |
| `quality` | `number` | `78` | webp quality. When it changes, the encoder signature changes and every image is re-encoded. |
| `skip` | `string[]` | `[]` | **Directory names** not to scan. `assets` and `fonts` are always skipped. |

If `false` is given, the image step never runs. The step requires `sharp` and
never runs on a watch pass. Details: [08-build.md](./08-build.md).

```js
images: { widths: [400, 800, 1200], quality: 82, skip: ["downloads"] }
```

## `clientEnv`

**Type:** `string[]` — **Default:** `[]`

Environment variable keys to inline into the client bundle at build time. The
same contract as `NEXT_PUBLIC_*` in Next, except which key is public is decided
by the config rather than by the name. `NODE_ENV` is always inlined.

Because the whole of `process.env` is defined as a single object, reading a key
that is not in the list returns `undefined` instead of crashing.

```js
clientEnv: ["PUBLIC_WS_URL", "PUBLIC_CDN_ORIGIN"]
```

**Do not put secrets here** — the values sit in the bundle in plain text.

## `headers()`

**Type:** `() => { source: string, headers: { key: string, value: string }[] }[]`
— **Default:** `[]`

Response headers by path pattern. The framework only writes long-lived cache
headers for static files; every other header (CSP, COOP, HSTS,
X-Frame-Options…) comes from here and takes precedence over the defaults.

**All** matching rules are applied (unlike redirects, it does not stop at the
first match), in order; if two rules write the same header, the later one wins.

Entries without a `key` or with an `undefined` `value` are skipped; a rule left
with no valid headers at all is not added.

```js
async headers() {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Content-Security-Policy",
          value: "default-src 'self'; img-src 'self' https://cdn.example.com data:",
        },
      ],
    },
    {
      source: "/download/:path*",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    },
  ];
}
```

## `redirects()`

**Type:**
`() => { source: string, destination: string, permanent?: boolean, statusCode?: number }[]`
— **Default:** `[]`

| Field | Type | Meaning |
| --- | --- | --- |
| `source` | `string` | Pattern (syntax below) |
| `destination` | `string` | Target; `:param` placeholders are filled in |
| `permanent` | `boolean` | `true` → 308, otherwise 307 |
| `statusCode` | `number` | Explicit status code; overrides `permanent` |

The first matching rule wins and the query string is preserved. Details:
[03-routing.md](./03-routing.md).

## `rewrites()`

**Type:** `() => Rule[] | { beforeFiles?: Rule[], afterFiles?: Rule[] }`
where `Rule = { source: string, destination: string }` — **Default:** `[]`

If an array is returned, all of it counts as `afterFiles`.

- `beforeFiles` runs even before static files.
- `afterFiles` runs after static has been tried, before the routes.
- Absolute target (`http://`/`https://`) → built-in reverse proxy.
- Relative target → only `req.url` changes.

Details: [03-routing.md](./03-routing.md).

## `cache()`

**Type:**
`() => { html?: Record<string, number>, maxEntries?: number, data?: object, trackUpstream?: boolean, trackDependencies?: boolean, transientRetry?: object | false, prewarm?: object }` —
**Default:**
`{ html: {}, maxEntries: 500, data: { maxEntries: 10000, staleFactor: 10 }, trackUpstream: true, trackDependencies: true, transientRetry: { attempts: 1, delayMs: 300 }, prewarm: { enabled: true, max: 400, intervalSeconds: 0 } }`

### `cache().html`

A pattern → seconds mapping. A matching rule **overrides** the route's own
`revalidate` value. Negative or non-finite values are ignored; `0` means "no
caching".

The one exception is `route(fn, { private: true })`: on that route a matching
pattern is ignored. The lock is deliberately one-way — a mistake in the other
direction means one user's HTML is served to another.

```js
html: {
  "/": 60,
  "/news/:slug": 300,
  "/search": 0,
}
```

### `cache().maxEntries`

**Type:** `number` — **Default:** `500`

The entry limit of the HTML cache. Because an entry costs a hundred kilobytes,
raising this number burns through memory quickly; trying to solve a site with
tens of thousands of paths from here is the wrong layer — the right place is
`cache().data`.

### `cache().data`

The upstream data cache (`withDataCache`). Details:
[06-caching.md](./06-caching.md).

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `maxEntries` | `number` | `10000` | The LRU entry limit. The limit is high because JSON is tens of times smaller than HTML. |
| `staleFactor` | `number` | `10` | For how many TTLs an entry stays usable after the TTL expired. `0` → no stale serving. |

### `cache().trackUpstream`

**Type:** `boolean` — **Default:** `true`

When on, `globalThis.fetch` is wrapped and transient upstream failures (`429`,
`5xx`, network) during a render are reported automatically; calling
`reportUpstreamFailure()` is not required. An application that wraps `fetch`
itself can turn this off.

### `cache().trackDependencies`

**Type:** `boolean` — **Default:** `true`

When on, the `withDataCache` keys a render reads are recorded, and
`clearDataCache()` also stales the HTML pages that read that data — targeted
invalidation without the application declaring anything
([06-caching.md](./06-caching.md)). An application that does not use
`withDataCache` has nothing to record; turning this off also removes the cost of
setting up the context.

### `cache().transientRetry`

**Type:** `{ attempts?: number, delayMs?: number } | false` —
**Default:** `{ attempts: 1, delayMs: 300 }`

How many extra times a page is tried when `notFound()` was called because of a
transient upstream failure. The point is that an existing page never turns into
a 404; if the retries are exhausted the response is an uncached 503. `false` or
`attempts: 0` disables the retry. Details: [06-caching.md](./06-caching.md).

### `cache().prewarm`

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | If `false`, no prewarming happens (can be overridden with `PREWARM=1`) |
| `max` | `number` | `400` | At most how many paths are prewarmed per pass |
| `concurrency` | `number` | prod 4, dev 1 | Number of parallel workers |
| `rps` | `number` | prod `0`, dev 4 | At most how many prewarm requests per second; `0` is unlimited. This is the setting that protects the upstream quota. The default brake in dev keeps prewarming from holding page requests up. |
| `delayMs` | `number` | prod 500, dev 3000 | Delay of the first pass after startup |
| `retryDelayMs` | `number` | `2000` | How long to wait before the retry pass |
| `intervalSeconds` | `number` | `0` | If greater than 0, the pass repeats periodically |
| `rotate` | `boolean` | `true` | If the list is longer than `max`, periodic passes continue where they left off |
| `priority` | `(string \| RegExp)[]` | `[]` | Warm-up order; matching paths are taken first on every pass |

`priority` accepts two forms: the pattern syntax used everywhere in the config,
and a plain `RegExp`. Whatever is written first is warmed first.

```js
prewarm: {
  max: 500,
  rps: 4,
  intervalSeconds: 300,
  priority: [
    "/",                     // the home page
    "/markets/:path*",        // the whole markets section
    /-comments$/,             // a rule the pattern syntax does not cover
  ],
}
```

Each numeric field can be overridden by an environment variable of the same
name; env takes precedence. Details: [06-caching.md](./06-caching.md).

## `hooks`

**Type:** `Record<string, Function>` — **Default:** `{}`

All optional, all may be `async`. If a hook throws, the framework falls back to
its own default and warns — the page does not go down.

| Hook | Signature | What it returns | Document |
| --- | --- | --- | --- |
| `metadata` | `(page) => object` | Metadata default for every page; the controller's `metadata` is layered on top | [04](./04-rendering.md) |
| `layoutContext` | `({ pathname, metadata }) => object` | Layout locals; `lang`, `structuredData`, `extraHead` and `bodyClass` get special treatment | [04](./04-rendering.md) |
| `notFound` | `() => object \| null` | 404 page definition; if `null`, the framework's error page | [03](./03-routing.md) |
| `error` | `({ status, error }) => object \| string \| null` | Error pages other than 404 (and 404 when there is no `notFound`); a page definition or HTML directly | [03](./03-routing.md) |
| `prewarmPaths` | `() => string[]` | Paths to prewarm; if it is not defined, prewarming is never set up | [06](./06-caching.md) |

```js
hooks: {
  metadata() {
    return { titleTemplate: "%s | Example", siteUrl: "https://example.com" };
  },

  async layoutContext({ pathname }) {
    return { navigation: await getNavigation(), isHome: pathname === "/" };
  },

  notFound() {
    return {
      view: "pages/not-found",
      metadata: { title: "Page not found", robots: { index: false } },
    };
  },

  error({ status }) {
    return {
      view: "pages/error",
      data: { status },
      metadata: { title: "Something went wrong", robots: { index: false } },
    };
  },

  async prewarmPaths() {
    return ["/", ...(await getArticlePaths())];
  },
}
```

## `source` pattern syntax

`headers()`, `redirects()`, `rewrites()` and `cache().html` all use the same
small compiler. This is not Next's full `path-to-regexp` surface; the subset
actually used in configuration was chosen deliberately, and an unrecognised
syntax is not silently accepted as a literal — it produces a warning.

| Pattern | Regex equivalent | Example match |
| --- | --- | --- |
| `/about` | exact match | `/about` |
| `/news/:slug` | `([^/]+)` — a single segment | `/news/abc` (✗ `/news/a/b`) |
| `/:path*` | `(.*)` — zero or more segments | `/`, `/a`, `/a/b/c` |
| `/blog/:path*` | wildcard sub-path; the leading `/` is optional | `/blog`, `/blog/`, `/blog/a/b` |
| `/:path*.svg` | wildcard + fixed suffix | `/ikon.svg`, `/a/b/c.svg` |
| `/tag-:slug` | a parameter in the middle of a segment | `/tag-finance` |

Rules:

- `source` **must start with `/`**; if it does not, the rule is ignored and a
  warning is printed.
- The parameter name must match the pattern `[A-Za-z_][A-Za-z0-9_]*`.
- A pattern always matches **from start to end** (`^…$`); use `:path*` for
  prefix matching.
- `:path*` also captures zero segments and the `/` immediately before it is
  optional: `/account/:path*` covers the section's root path (`/account`) too.
  Otherwise a rule that wanted to close off a whole section was skipping
  precisely its landing page.
- Every character other than parameters is treated as a literal and escaped for
  the regex — `.` really means a dot.
- Captured values are written into the same-named `:param`s in `destination`. A
  placeholder with no counterpart is left as is.

## Environment variables

Every variable the framework reads. If a `.env` file exists it is loaded
automatically by the CLI (`--env-file=.env`); if not, the flag is never passed
and no warning is printed.

| Variable | Who reads it | Default | Meaning |
| --- | --- | --- | --- |
| `NODE_ENV` | everywhere | `production` (start/build), `development` (dev) | Determines the dev overlay, EJS cache, manifest re-reading, route error behaviour and prewarm defaults. `jskelet dev` sets it itself — `cross-env` is not needed. |
| `PORT` | `startServer` | `3000` | Port to listen on |
| `HOST` | `startServer` | `0.0.0.0` | Interface to bind to |
| `JSKELET_SECRET` | `jskelet/cookies` | — | The signed cookie secret. Read when `security.cookieSecret` is not set; if neither exists, the signed cookie API throws. [12](./12-dashboards-and-sessions.md) |
| `DEV_TOKEN` | `devGate`, `prewarm` | — | If set, every request without a token gets a 404. Prewarming carries the token as a cookie. [09](./09-dev-tools.md) |
| `PREWARM` | `startPrewarm` | — | `0` turns prewarming off; `1` overrides `enabled: false` in the config and turns it on |
| `PREWARM_MAX` | `prewarm` | `400` | At most how many paths are prewarmed |
| `PREWARM_CONCURRENCY` | `prewarm` | prod 4, dev 1 | Number of parallel workers |
| `PREWARM_RPS` | `prewarm` | `0` | At most how many prewarm requests per second; `0` is unlimited |
| `PREWARM_DELAY_MS` | `startPrewarm` | prod 500, dev 3000 | Delay of the first pass |
| `PREWARM_RETRY_DELAY_MS` | `prewarm` | `2000` | The wait before the retry pass |
| `PREWARM_INTERVAL_SECONDS` | `startPrewarm` | `0` | If greater than 0, a periodic pass |
| `JSKELET_VERBOSE` | `jskelet dev` | — | If `1`, all of the changed files are listed on restart |
| `JSKELET_COLOR` | `jskelet/log` | — | If `1`, colour is forced. Because child processes write to a pipe, colour detection turns off; `jskelet dev` sets this itself. |
| `JSKELET_CHILD` | `jskelet build` | — | Set by the dev script; suppresses the build banner and the "Ready" summary |
| `NO_COLOR` | `jskelet/log` | — | If set, colour is never used (it overrides `JSKELET_COLOR` too) |

Your application's own variables (API origin, tokens) are not read by the
framework; use them directly via `process.env`. Declare the ones that need to
reach the browser with `clientEnv`.

The numeric prewarm settings only accept **positive and finite** values; an
invalid value silently falls through to the next layer (config → code default).

## Programmatic access

```js
import { getConfig, loadConfig } from "jskelet";

await loadConfig();                          // reads from the project root
await loadConfig({ root: "/baska/proje" });  // a different root
await loadConfig({ configFile: "jskelet.test.mjs" });
await loadConfig({ force: true });           // bypass the cache and re-read

const config = getConfig();                  // the resolved config
```

`loadConfig()` hits the cache on a second call in the same process: `jskelet
start` calls it through both `ensure-build` and `createApp`, and there is no
benefit in reading and logging the config twice.

If `getConfig()` is used without `loadConfig()` having been called, it
**throws**: a silently wrong path turns into problems that are hard to diagnose,
like "why is there no stylesheet".

In the resolved config the directories are available as absolute paths under
`config.dirs` (`views`, `public`, `client`, `routes`, `styles`, `generated`,
`assets`, `fonts`), the patterns are in compiled form, and `config.loaded` tells
you whether the file was actually read.

## What's next

- The effect of the build-side fields: [08-build.md](./08-build.md)
- The dev flow and `DEV_TOKEN`: [09-dev-tools.md](./09-dev-tools.md)
- Using environment variables in deployment: [10-deployment.md](./10-deployment.md)
