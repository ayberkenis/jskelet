# 12 — Dashboards, sessions and per-visitor pages

JSkelet's center of gravity is public, cacheable pages. A dashboard sits on the
opposite axis: different HTML for every visitor, no cache, heavy interaction.
This document covers that axis — `private: true`, session cookies, CSRF,
fragment endpoints and region swapping.

One thing is deliberately out of scope: **live data transport**. Choosing
between SSE, WebSocket and polling belongs to the application; the framework
only provides the "refresh this region from the server" step. The compression
layer skips `text/event-stream` responses and streams that write their own
headers, so wiring up SSE by hand does not break anything either.

The runnable counterpart is `examples/dashboard/`, which is where the snippets
below come from.

## Why a separate path is needed

The HTML cache key is only the path and the query string:

```
`${req.path}?${new URLSearchParams(query).toString()}`
```

Identity is not part of the key. So if a session-dependent page is registered
with a plain `route()`, the first visitor's HTML is served to **everyone** for
the length of the TTL. Nothing about this mistake fails loudly: the page works,
the tests pass, and the problem only appears once a second user arrives —
usually in production.

## `private: true`

```js
export default function register(app, { route, redirect }) {
  app.get(
    "/dashboard",
    route(
      async ({ req }) => {
        const user = currentUser(req);
        if (!user) redirect("/sign-in?next=%2Fdashboard");

        return { view: "pages/overview", data: { user } };
      },
      { private: true },
    ),
  );
}
```

What the flag does:

| Behaviour | Public `route()` | `private: true` |
| --- | --- | --- |
| HTML cache | On when a TTL exists | Off, cannot be turned on |
| `cache.html` pattern | Overrides the TTL | Ignored |
| `Cache-Control` | `public, s-maxage=…` | `private, no-store` |
| `Vary` | `Accept-Encoding` | `Cookie, Accept-Encoding` |
| ETag | Present | Absent |
| `X-JSkelet-Cache` | `HIT`/`STALE`/`MISS` | Not written |

Dropping the ETag looks like a detail but is not: a strong ETag over a
per-visitor body is a fingerprint of that visitor, and a layer that ignores
`no-store` could use it to tell them apart.

A redirect thrown from a per-visitor page is not cacheable either. "You need to
sign in" is a session-dependent decision; storing it means sending signed-in
users to the sign-in page too.

## When you forget the flag

The framework watches for reads that touch identity. The `req` passed to the
controller is wrapped in a thin Proxy that marks these accesses:

- `req.headers.cookie`, `req.headers.authorization`,
  `req.headers["proxy-authorization"]`
- `req.get("Cookie")` / `req.header("Authorization")`
- `req.cookies`, `req.signedCookies`, `req.session`, `req.user`
- `parseCookies(req)` and `getSignedCookie(req, …)`, which report it directly

A marked render is **never stored**. In production the response is sent with
`no-store` and this line is logged:

```
[render] /dashboard read identity-bound data (req.headers.cookie), not cached.
Register the route with 'private: true'.
```

In development the same situation fails the request. The reason it is not silent
is simple: this mistake produces a working page, so it is never noticed on its
own.

`csrfField()` marks the render the same way. A page that prints a token cannot
come from the cache — if it did, every visitor would share the same token and
the double-submit check would verify nothing.

## Sessions: signed cookies

The framework does not provide identity. The only thing it gives you is the
guarantee that "I wrote this value and it has not been tampered with":

```js
import { clearCookie, getSignedCookie, setSignedCookie } from "jskelet/cookies";

export function startSession(res, username) {
  setSignedCookie(res, "session", username, { maxAge: 60 * 60 * 8 });
}

export function currentUser(req) {
  const username = getSignedCookie(req, "session");
  return username ? findUser(username) : null;
}

export function endSession(res) {
  clearCookie(res, "session");
}
```

The signature is HMAC-SHA256 and the comparison is constant time. If the
signature does not match, `getSignedCookie` returns `null` — a tampered value is
never used on the assumption that it "might be valid".

The secret comes from `security.cookieSecret` or the `JSKELET_SECRET`
environment variable. Without a secret the signed API **throws**; the rule that
a configuration error must not take the site down does not apply here, because
the silent alternative would be trusting an unsigned cookie.

The defaults are on the restrictive side: `HttpOnly`, `SameSite=Lax`, `Secure`
outside development, `Path=/`. `SameSite=Lax` alone closes most of CSRF — the
cookie is simply not sent on cross-site POSTs.

Cookies are **signed, not encrypted**. The value is readable, so store the
identifier of a secret rather than the secret itself.

## CSRF

The framework parses the request body (`express.urlencoded` + `express.json`),
which makes it the layer that accepts state-changing requests. The protection
has two layers.

### Layer 1 — origin check (on by default)

Unsafe methods get a 403 when `Origin` does not match our host, or when
`Sec-Fetch-Site: cross-site` arrives. **If neither header is present the request
passes**: browsers always send `Origin` on a cross-origin POST, while webhooks
and server-to-server calls send neither. That distinction keeps the protection
on without breaking integrations.

```js
security: {
  csrf: {
    // Legitimate exceptions, such as a panel on a separate domain.
    allowedOrigins: ["https://admin.example.com"],
    // Endpoints that do not come from a browser.
    exclude: ["/webhook/:path*"],
  },
}
```

### Layer 2 — double-submit token (optional)

Enabled with `security.csrf.token: true`. Forms print the token with
`csrfField()`:

```ejs
<form method="post" action="/dashboard/notes">
  <%- csrfField() %>
  …
</form>
```

The token is **not** produced by the middleware but by `csrfField()` — that is,
at the moment it is actually printed into a form. The reason is concrete: if the
token were written on every response, a public and cacheable page would carry a
`Set-Cookie` too, a CDN would store that response, and every visitor would share
the same token.

On the server the token in the signed cookie must match the submitted field; an
`X-CSRF-Token` header is accepted in place of the field.

`csrfField()` returns an empty string while `security.csrf.token` is off, so the
template renders under any configuration.

## Fragment endpoints

`fragment()` produces a partial response with a fixed policy: no layout, sent
with `private, no-store` and no ETag, never touching the HTML cache.

```js
export default function register(app, { fragment }) {
  app.get(
    "/_fragment/orders",
    fragment(async ({ req, query }) => {
      const user = currentUser(req);
      if (!user) return { view: "partials/session-expired", status: 401 };

      return {
        view: "partials/order-table",
        data: { orders: getOrders(user.username, Number(query.page ?? 1)) },
      };
    }),
  );
}
```

The controller returns either `{ view, data?, status? }` or an HTML string
directly. On failure it responds with a small partial rather than a whole page
(`<div role="alert" data-fragment-error>`), because the swapped region must not
end up containing an entire error page.

Using the same template both inside the page and at the fragment endpoint is the
central idea: the markup has a single source on the server and the client does
not carry a second template.

## Client: swapping a region

```js
import { registerAll, start, startForms, startSwapLinks } from "jskelet/client";

registerAll({ "live-clock": () => import("../islands/live-clock.js") });

start();
startSwapLinks();
startForms();
```

`startSwapLinks()` binds links carrying `data-swap`:

```html
<a href="/_fragment/orders?page=2" data-swap="#orders">Next</a>
```

Because `href` is a real URL, the link falls back to normal navigation without
JavaScript. For programmatic use there is `swap()`:

```js
import { swap } from "jskelet/client";

await swap("#orders", "/_fragment/orders?page=2", { history: true });
```

In order, `swap()` unmounts the islands in the old subtree, replaces the
content, hydrates the new subtree and restores focus if it was lost. While the
request is in flight the region gets `aria-busy="true"` — binding the pending
indicator to the accessibility state instead of a separate class also keeps the
two from drifting apart.

If it meets a redirect (the session expired and the server points at the sign-in
page), it navigates there instead of swapping the partial in.

### Unmounting islands

This is the half of swapping that is easiest to skip. A `mount()` function may
return a cleanup callback:

```js
export function mount(element) {
  const timer = setInterval(() => tick(element), 1000);
  return () => clearInterval(timer);
}
```

The islands inside a region replaced with `innerHTML` leave the DOM, but the
listeners they installed on `document`/`window` and their `setInterval` timers
keep running; after a few swaps the same work runs dozens of times. `swap()` and
the form helpers call `unmount()` for you; when you change the DOM by hand, you
call it:

```js
import { hydrate, unmount } from "jskelet/client";

unmount(region);
region.innerHTML = html;
hydrate(region);
```

## Forms

`startForms()` binds forms carrying `data-enhance`. The contract is progressive
enhancement: the form is a normal `<form method="post" action="…">` and
JavaScript only removes the full page round trip in between.

```html
<form method="post" action="/dashboard/notes" data-enhance data-target="#notes">
  <%- csrfField() %>
  <textarea name="text" required minlength="3"></textarea>
  <button type="submit">Save</button>
</form>
```

The server answers with one of three things:

- **a redirect** → followed with `location.assign` (successful mutation, and the
  no-JavaScript path)
- **4xx + a partial** → swapped in place of the form (validation errors)
- **2xx + a partial** → swapped into the `data-target` region, and the form is
  reset

The server side handles both clients:

```js
app.post(
  "/dashboard/notes",
  fragment(async ({ req }) => {
    const user = currentUser(req);
    if (!user) seeOther("/sign-in?next=%2Fdashboard");

    const result = addNote(user.username, req.body?.text);

    // Without JavaScript the client sends no `X-Requested-With`: full round trip.
    if (req.get("X-Requested-With") !== "fragment") {
      seeOther(result.ok ? "/dashboard" : "/dashboard?note=error");
    }

    return result.ok
      ? { view: "partials/note-list", data: { notes: getNotes(user.username) } }
      : { view: "partials/note-form", data: { error: result.error }, status: 422 };
  }),
);
```

Using `redirect()` instead of `seeOther()` here would be a bug: `redirect()`
sends 307 and 307 preserves the method, so the browser POSTs to the target
again. The post-form flow needs 303.

Routing the POST handler through `fragment()` has a reason too: alongside the
layout-less render and `no-store`, it establishes the **request context**.
Without the context, `csrfField()` in a form re-printed after a validation error
comes out empty and the user's second attempt gets a 403.

On a validation error focus moves to the first invalid field; the markers looked
for are `aria-invalid="true"` and `data-field-error`.

## Configuration

```js
export default {
  security: {
    /**
     * Turn this off when you are not behind a reverse proxy: while it is on, a
     * client can forge its own `X-Forwarded-For`.
     */
    trustProxy: true,

    cookieSecret: process.env.JSKELET_SECRET,

    csrf: {
      enabled: true,
      token: false,
      allowedOrigins: [],
      exclude: [],
      cookieName: "csrf_token",
      fieldName: "_csrf",
      headerName: "x-csrf-token",
    },
  },
};
```

Two more settings pay off for dashboard paths:

```js
// Speculatively fetching a link with side effects can sign the user out.
navigation: { exclude: ["/dashboard/:path*", "/sign-out"] },

// The warmer has no session; protected pages cannot be warmed.
prewarmSkip: ["/api/", "/_fragment/", "/dashboard", "/sign-out"],
```

And indexing is turned off through `headers()` — `no-store` prevents caching,
but indexing has to be said separately:

```js
{
  source: "/dashboard/:path*",
  headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
}
```

## Checklist

When adding a per-visitor section:

- [ ] Pages are registered with `route(fn, { private: true })`.
- [ ] Fragment endpoints are registered with `fragment()`.
- [ ] `security.cookieSecret` comes from the environment, not from the source.
- [ ] Mutation forms contain `csrfField()` and `security.csrf.token` is on.
- [ ] Signing out is a POST, not a GET.
- [ ] The `next` parameter after sign-in only accepts same-site paths.
- [ ] `prewarmSkip` and `navigation.exclude` exclude the protected prefix.
- [ ] `X-Robots-Tag: noindex` under `headers()`.
- [ ] The smoke test checks the `no-store` header and the rejection of a POST
      without a token — nothing on screen changes when those break.
