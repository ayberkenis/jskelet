# 03 — Routing

This document explains every mechanism that determines which controller a
request lands on: the route module contract and its load order, the `route()`
wrapper, the page definition the controller returns, the `ctx` object, `params`,
the `notFound()` and `redirect()` control flow, and the redirect/rewrite rules
that come from `jskelet.config.mjs`. The template side of the page definition is
covered in [04-rendering.md](./04-rendering.md), and the `revalidate` behaviour
in [06-caching.md](./06-caching.md).

## The route module contract

A route module exposes a function with the signature
`(app, api) => void | Promise<void>`, either as a **default export** or as a
**named export** called `register`.

```js
// routes/10-pages.mjs
export default function register(app, { route }) {
  app.get("/", route(async () => ({ view: "pages/home" })));
}
```

`app` is the Express application directly: `app.get`, `app.post`, `app.use`,
`app.all` — the whole surface of Express 5 is available. `api`, on the other
hand, is the ready-made surface the framework passes to route files, so that you
don't have to import things one by one in every file:

| Field | Equivalent |
| --- | --- |
| `route` | `jskelet` → `route` |
| `fragment` | `jskelet` → `fragment` |
| `renderView` | `jskelet` → `renderView` |
| `renderPage` | `jskelet` → `renderPage` |
| `notFound` | `jskelet` → `notFound` |
| `redirect` | `jskelet` → `redirect` |
| `permanentRedirect` | `jskelet` → `permanentRedirect` |
| `seeOther` | `jskelet` → `seeOther` |

You can also import directly if you prefer; `api` is only a convenience:

```js
import { route, notFound } from "jskelet";

export function register(app) {
  app.get("/news/:slug", route(async ({ params }) => { /* … */ }));
}
```

If a module does not expose a valid function, a warning is printed and it is
skipped: `[router] <file> exports neither a default nor a 'register' function,
skipped`.

## Load order

There is **no** automatic URL derivation based on the file system. The order is
determined in one of two ways:

**1. An explicit list (`jskelet.config.mjs` → `routes`).** Paths relative to the
project root, loaded in the order you give:

```js
export default {
  routes: ["./routes/api.js", "./routes/pages.js", "./routes/catch-all.js"],
};
```

**2. If there is no list, the `routes/` directory is scanned alphabetically.**
The scan is recursive (subdirectories included), only `.js` and `.mjs` files are
picked up, and files whose name begins with `_` are skipped (for shared modules
like `_helpers.js`).

In that case, give the file names a numeric prefix:

```
routes/
├── 10-pages.mjs
├── 50-blog.mjs
└── 99-catch-all.mjs
```

Making the order explicit is a design decision: if a single-segment catch-all
such as `/:slug` is registered before the `/about` route, "about" is mistaken
for a slug. Making the order visible instead of hiding it in file names makes
diagnosis easier ([02-architecture.md](./02-architecture.md)).

If no route module is found at all, a warning is printed and the server comes up
with static files + 404 only.

### Behaviour with a broken module

- **Development:** if the module cannot be imported a warning is printed and it
  is skipped; the server stays up.
- **Production:** an error is thrown and the process does not start. Going live
  with a half-built route table means pages that silently return 404.

## `route()` — the controller wrapper

`route(controller, options?)` returns an Express request handler and takes on
the following work:

- Builds the `ctx` object and calls the controller.
- Applies the HTML TTL cache (if `revalidate` is set and the method is `GET`).
- Catches the `notFound()` / `redirect()` control flow.
- Writes the response headers: `Content-Type` and, depending on the cache
  decision, `Cache-Control` (plus `X-JSkelet-Cache` on cacheable responses).
- Sends the response using the compressed body stored in the cache.

```js
app.get(
  "/about",
  route(
    async () => ({
      view: "pages/about",
      metadata: { title: "About", canonical: "/about" },
    }),
    { revalidate: 300 },
  ),
);
```

`options` accepts two fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `revalidate` | `number` (seconds) | The HTML cache TTL. If it is not given, or is 0, this route is not cached. A matching rule in `jskelet.config.mjs` → `cache().html` **overrides** this value. |
| `private` | `boolean` | The page depends on the visitor. The cache is disabled, a `cache().html` pattern **cannot** override that, and the response is sent with `private, no-store` and `Vary: Cookie`, without an ETag. |

Even with `revalidate` given, **a request that carries a query parameter is
dynamic by default**; that path needs an allowlist under `cache().query`
([06-caching.md](./06-caching.md)).

Every session-dependent page needs `private: true`; because identity is not part
of the cache key, without the flag one user's HTML is served to another. The
framework also catches this at runtime (a render that reads cookies is never
stored), but the flag is the right place. Details in
[12-dashboards-and-sessions.md](./12-dashboards-and-sessions.md).

## `fragment()` — a partial without the layout

For endpoints that refresh a region. No layout is printed, the response is sent
with `private, no-store` and no ETag, and it never touches the HTML cache.

```js
app.get(
  "/_fragment/rows",
  fragment(async ({ query }) => ({
    view: "partials/rows",
    data: { rows: getRows(Number(query.page ?? 1)) },
  })),
);
```

The controller returns either `{ view, data?, status? }` or an HTML string. On
failure it responds with a small alert partial
(`<div role="alert" data-fragment-error>`) rather than a whole page, because the
swapped region must not end up containing an entire error page.

`fragment()` works for POST too: it is how you return an updated partial as the
answer to a form submission, and it establishes the request context that
`csrfField()` needs in the template.

## `ctx` — the controller context

The controller takes a single argument:

```js
{
  params,    // Express route parameters (req.params)
  query,     // The parsed query string (req.query)
  pathname,  // req.path — the path without the query
  req,       // Express Request; full access if you need it
}
```

`params` uses Express's own pattern syntax (Express 5 / `path-to-regexp`), not
the `source` syntax from the config:

```js
app.get("/news/:slug", route(async ({ params }) => {
  const article = await getArticle(params.slug);
  if (!article) notFound();
  return { view: "pages/article", data: { article } };
}));
```

`pathname` is used both in the cache key and in the `pathname` local passed to
`renderPage`; decisions in the layout like "is this the home page" look at it.

## The page definition the controller returns

The controller has the form `async (ctx) => sayfa` and can return the following
fields:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `view` | `string` | — | The template path under `views/`, without the extension: `"pages/home"` → `views/pages/home.ejs`. |
| `data` | `object` | `{}` | Data passed to the template as locals. |
| `metadata` | `object` | `{}` | Turned into `<head>` tags; it overrides the output of `hooks.metadata()`. Schema: [04-rendering.md](./04-rendering.md). |
| `status` | `number` | `200` | The HTTP status code. Only 200 is written to the cache. |
| `head` | `string` | `""` | Raw HTML to be printed into `<head>` as-is (e.g. the LCP preload). |
| `bodyClass` | `string` | `hooks.layoutContext().bodyClass ?? ""` | `<body class="…">`. |
| `entries` | `string[]` | `[]` | The names of client entries to be loaded additionally on this page: `["chart.js"]`. |

`revalidate` is **the second argument of `route()`**, not a field of the object
the controller returns.

An example with everything together:

```js
import { headHints } from "jskelet";

app.get(
  "/markets",
  route(
    async ({ query }) => {
      const data = await getMarkets(query.tab ?? "stocks");

      return {
        view: "pages/markets",
        data: { markets: data.items, tab: query.tab ?? "stocks" },
        metadata: {
          title: "Markets",
          canonical: "/markets",
          openGraph: { image: data.cover },
        },
        head: headHints({ href: data.cover }),
        bodyClass: "bg-slate-50",
        entries: ["chart.js"],
      };
    },
    { revalidate: 30 },
  ),
);
```

## `notFound()` and `redirect()`

The equivalent of the control flow in `next/navigation`: a function deep down
does a `throw`, the framework catches it. That way a function in the data layer
can produce a 404 without having to carry a return value up to the controller.

```js
import { notFound, redirect, permanentRedirect, seeOther } from "jskelet";

notFound();                    // 404 → the hooks.notFound() page
redirect("/new-address");      // 307 (temporary, preserves the method)
permanentRedirect("/new");     // 308 (permanent, preserves the method)
seeOther("/dashboard");        // 303 (after a POST)
```

All four return `never` (they always throw). In detail:

- `notFound()` → `NotFoundError` (`statusCode: 404`)
- `redirect(location)` → `RedirectError` (`statusCode: 307`)
- `permanentRedirect(location)` → `RedirectError` (`statusCode: 308`)
- `seeOther(location)` → `RedirectError` (`statusCode: 303`)

In a POST handler use `seeOther()` rather than `redirect()`: 307 preserves the
method, so the browser POSTs to the target again. The post/redirect/get flow —
the one where the back button does not resubmit the form — needs 303.

If you need a custom status code you can use the class directly:

```js
import { RedirectError } from "jskelet";

throw new RedirectError("/legacy-install-compat", 301);
```

To tell them apart, `isNotFoundError(error)` and `isRedirectError(error)` are
exported.

Where they are caught:

1. **Inside `route()`:** the redirect is written straight to the response;
   notFound is caught inside `produce()` and the 404 page is produced (this
   output is **not** written to the cache, because only 200 is stored).
2. **In the Express error handler:** if it was thrown in a middleware or in code
   outside a route, it is met here.

## The 404 page

If a request does not land on any route, the framework calls the
`hooks.notFound()` hook and renders the returned page definition with
`pathname: "/404"`.

```js
// jskelet.config.mjs
export default {
  hooks: {
    notFound() {
      return {
        view: "pages/not-found",
        metadata: { title: "Page not found", robots: { index: false } },
      };
    },
  },
};
```

If the hook is not defined, or if the 404 render throws as well, the framework
returns a minimal, template-free HTML. This fallback is deliberately
template-free: if the 404 render blows up too, the visitor should not see an
empty response.

## Error pages (500 and others)

When a controller or a middleware throws an unexpected error, Express's error
handler kicks in, logs the error and returns the framework's own error page with
`Cache-Control: no-store`. The status code is read from the error's `statusCode`
(or `status`) field; if it is not in the 400–599 range, 500 is used.

The framework's page is deliberately plain: the status code, a one-line heading
and a one-line description. It carries no brand name, no navigation and no error
detail — the innards of the server are not opened up to the visitor. The
language comes from `brand.lang` (`tr` and `en` are built in, others fall back
to `en`).

To provide your own page, `hooks.error()`:

```js
// jskelet.config.mjs
export default {
  hooks: {
    error({ status }) {
      return {
        view: "pages/error",
        data: { status },
        metadata: { title: "Something went wrong", robots: { index: false } },
      };
    },
  },
};
```

The hook can also return an HTML string directly instead of a page definition;
if you want an error page that does not depend on the layout, that route is
safer, because if the layout itself throws then the page definition cannot be
rendered either. If there is no hook, if it returns `null`, or if its render
blows up, the framework falls back to the built-in page.

For 404, `hooks.notFound()` takes precedence; `hooks.error()` is called with
`status: 404` only if that one is not defined.

You can also produce the page programmatically:

```js
import { renderStatusPage } from "jskelet";

const html = await renderStatusPage(503);
```

## Rendering without a layout: `renderView`

`renderView(view, data)` renders a single template without the layout and
returns a string. For fragment endpoints, email templates and HTML pieces that
islands fetch later:

```js
export default function register(app, { renderView }) {
  app.get("/_fragment/comments/:id", async (req, res) => {
    const comments = await getComments(req.params.id);
    res.type("html").send(await renderView("fragments/comments", { comments }));
  });
}
```

The `/_fragment/` prefix is in the default `prewarmSkip` list, meaning the
warm-up round does not scan these endpoints
([06-caching.md](./06-caching.md)).

## Config: `redirects()`

`jskelet.config.mjs` → `redirects()` returns an array and runs **before** the
routes in the middleware chain (see
[02-architecture.md](./02-architecture.md)).

```js
export default {
  async redirects() {
    return [
      { source: "/old-blog/:slug", destination: "/blog/:slug", permanent: true },
      { source: "/campaign", destination: "/campaigns" },
      { source: "/legacy", destination: "/", statusCode: 301 },
    ];
  },
};
```

Behaviour:

- **The first matching rule wins**, the rest are not tried. The ordering is the
  order written in the config.
- **The query string is preserved:** `/old-blog/x?utm=a` → `/blog/x?utm=a`. If
  a redirect drops the campaign parameters, the traffic source is lost.
- **Status code:** `permanent: true` → 308, otherwise 307 (Next semantics).
  Anyone who wants a different code can give `statusCode`; for example 301 for
  compatibility with old setups.
- If `source` or `destination` is invalid, the rule does not drop silently; a
  warning is printed.

## Config: `trailingSlash`

With `trailingSlash: true`, canonical page URLs end with `/` and return **200**;
a request without the slash is sent to the slashed form with a **308**. Details
and exceptions: [07-configuration.md](./07-configuration.md#trailingslash).

## Config: `rewrites()`

A rewrite moves a request somewhere else without changing the browser's address
bar. There are two phases:

```js
export default {
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/sitemap-:page.xml", destination: "/sitemap?page=:page" },
      ],
      afterFiles: [
        { source: "/api/:path*", destination: "https://api.example.com/:path*" },
      ],
    };
  },
};
```

If you return an array, all of it counts as `afterFiles`:

```js
async rewrites() {
  return [{ source: "/api/:path*", destination: "https://api.example.com/:path*" }];
}
```

- **`beforeFiles`** runs even before static files. If you need to rewrite paths
  like `/assets/…`, it has to go here.
- **`afterFiles`** runs after static has been tried, before the routes.

The form of the destination determines the behaviour:

- **Absolute (`http://` / `https://`):** the request is carried outwards through
  the built-in reverse proxy. No external package; a thin layer that streams
  with `fetch`. Hop-by-hop headers (`host`, `connection`, `content-length`,
  `accept-encoding`) are cleaned; on the response, `content-encoding`,
  `content-length`, `transfer-encoding` and `connection` are dropped. Thanks to
  `redirect: "manual"` the upstream's 302 is not consumed here, it is forwarded
  to the browser.
- **Relative:** only `req.url` is changed and the request continues in its own
  route table. In this phase the first matching rule breaks the loop.

The typical use is moving the `/api/*` path to a backend. Because the browser
calls it same-origin, there are no CORS or third-party cookie problems.

### Proxying by hand: `createProxy`

You can use the same proxy in your own route as well:

```js
import { createProxy } from "jskelet";

export default function register(app) {
  app.use("/ws-api", createProxy((req) => `${process.env.API_ORIGIN}${req.url}`));
}
```

If `resolveTarget` throws or returns nothing, the request is not proxied and
continues down the chain: in a setup where the target origin has not been
configured, getting a normal 404 instead of a 500 is more correct.

## The `source` pattern syntax

`redirects()`, `rewrites()`, `headers()` and `cache().html` use the same small
pattern compiler. This is not Next's full `path-to-regexp` surface; the subset
actually used in config was chosen deliberately.

| Pattern | Meaning |
| --- | --- |
| `/news/:slug` | Captures a single segment (`[^/]+`) |
| `/:path*` | Captures zero or more segments; the leading `/` is optional, so `/blog/:path*` also covers `/blog` |
| `/:path*.svg` | Wildcard + fixed suffix; this is how extension rules are written |
| `/tag-:slug` | A parameter in the middle of a segment |

The captured values are written into the `:param`s of the same name inside
`destination`. A parameter name must match the pattern
`[A-Za-z_][A-Za-z0-9_]*`.

`source` must begin with `/`; if it does not, the rule is ignored and a warning
is printed (``[config] invalid source (must start with `/`): …``). An
unrecognized syntax is not silently accepted as a literal.

The full pattern list and the config reference:
[07-configuration.md](./07-configuration.md).

## What's next

- The template layer, components and metadata:
  [04-rendering.md](./04-rendering.md)
- `revalidate`, the cache key and `X-JSkelet-Cache`:
  [06-caching.md](./06-caching.md)
- The full reference of the config fields:
  [07-configuration.md](./07-configuration.md)
