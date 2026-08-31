# 06 — Caching and prewarm

This document explains JSkelet's ISR substitute in full detail: the HTML TTL
cache and its stale-while-revalidate behaviour, where `revalidate` comes from,
how the cache key is built, the values of the `X-JSkelet-Cache` header, why the
compressed body is kept in the cache, per-request memoization
(`withRequestCache` / `cache()`), the data cache (`withDataCache`), how upstream
failures affect the cache (automatic tracking and `reportUpstreamFailure`) and the prewarm round at
server startup. The
measurement rationale behind the decisions is in
[02-architecture.md](./02-architecture.md), and the full reference of config
fields is in [07-configuration.md](./07-configuration.md).

## The big picture

```
route(controller, { revalidate })
 └─ withHtmlCache(key, ttl, producer)          ← TTL + stale-while-revalidate
     └─ withUpstreamTracking(...)              ← missing data detection
         └─ withRequestCache(...)              ← per-request memoization
             └─ produce() → controller + renderPage
                              └─ withDataCache(...)  ← upstream data cache
```

The order matters: the **per-request cache must be innermost** so that two
calls in the same render collapse into a single upstream request; **upstream
tracking must be inside the HTML cache** so that output produced with missing
data is not written to the cache.

How the two caches divide the work:

| | HTML cache | Data cache |
| --- | --- | --- |
| What it holds | The whole page (+ its compressed body) | The JSON that came from upstream |
| Entry size | ~100-200 kB | ~1-20 kB |
| Entry limit | 500 (`cache().maxEntries`) | 10,000 (`cache().data.maxEntries`) |
| Who benefits | Pages with traffic: not even rendered | The long tail: rendered, but without going to the API |

In practice this distinction means: on a site with tens of thousands of paths it
is impossible to keep every page hot as HTML — a warm-up that goes past 500
entries deletes what it just warmed. For the long tail the goal is not "have the
HTML ready" but **"have the data that produces the page available without going
to the API"**. Then a page that was never warmed is also produced within
milliseconds on the first visit, and spends no quota.

## Public versus per-visitor

Everything in this document applies to HTML that **can go to everyone
unchanged**. There is no identity in the cache key (only path + query), so a
page in the cache is the answer for that path, not the answer for whoever asked
for it first.

A page that depends on the user therefore takes a separate path:

```js
app.get("/dashboard", route(async ({ req }) => { … }, { private: true }));
```

`private: true` does three things at once: the cache is disabled, a
`cache.html` pattern **cannot** override that decision, and the response is
sent with `private, no-store` and `Vary: Cookie`, without an ETag. The details
and the session/CSRF side are in
[12-dashboards-and-sessions.md](./12-dashboards-and-sessions.md).

If you forget the flag, the framework does not stay quiet: as soon as the
controller reads `Cookie`, `Authorization` or `req.session`/`req.user`, the
render is marked and **not written** to the cache. In development the request
fails with an explanation, in production it is served with `no-store` and
logged. The guard is a last line of defence, not an excuse — the right place is
`private: true`.

## `revalidate` — where the TTL comes from

A route's TTL can come from two sources, and **the config wins**:

1. `route(controller, { revalidate: 60 })` — the route's own duration.
2. The matching pattern inside `jskelet.config.mjs` → `cache().html`. If it
   exists it overrides the route's value.

The one exception is `private: true`: a matching pattern is ignored. The lock is
one-way, because a mistake in the other direction means a silent data leak.

```js
// jskelet.config.mjs
export default {
  async cache() {
    return {
      html: {
        "/": 60,
        "/news/:slug": 300,
        "/tag/:slug": 120,
      },
    };
  },
};
```

Overriding from the config makes it possible to tune the freshness profile of
the whole site from a single file; you do not have to walk through the route
files.

The resolution result is **remembered per path**, so a pattern scan is not done
on every request. If there is no `cache().html` rule at all, the route's own
value is used directly.

If `revalidate` is not given, or is 0, the page is **not cached at all**: every
request is rendered and the response is sent with
`Cache-Control: private, no-store` and no ETag. No `X-JSkelet-Cache` header is
written either — the cache path never ran, so `MISS` would be misleading.

Sending `no-store` on a dynamic page is deliberate. HTTP treats a response with
no directives as "heuristically cacheable", so an intermediate proxy or the
browser's back button could store HTML produced for a single visitor.

The cache also only kicks in for `GET` requests.

## The cache key

```
`${req.path}?${new URLSearchParams(query).toString()}`
```

So the path **and all query parameters** are part of the key. `/list?page=2`
and `/list?page=3` are separate entries.

The practical consequence: a page that does not depend on the query string
produces a separate entry for every combination when it is called with
different campaign parameters (`?utm_source=…`). Stripping such parameters at
the reverse proxy layer, or turning off the cache (by not supplying
`revalidate`), is a reasonable precaution; by default the store holds at most
500 entries and evicts the oldest with LRU.

## Stale-while-revalidate

The entry structure:

```
expiresAt  = now + ttl
staleUntil = now + ttl * 2      (STALE_FACTOR = 1)
```

Read behaviour:

| State | Response | Background |
| --- | --- | --- |
| `now < expiresAt` | The cached HTML, `HIT` | — |
| `expiresAt ≤ now < staleUntil` | The cached HTML **immediately**, `STALE` | A refresh is started |
| `now ≥ staleUntil` | The entry is deleted, fresh render, `MISS` | — |

A failure of the refresh inside the stale window does not affect the request:
the old HTML stays valid for the whole window and the error is only logged
(`[html-cache] background refresh failed: …`).

Concurrent refreshes for the same key are collapsed into a single run (the
`inflight` map): a hundred concurrent requests fall to one render.

The gain: after the first warm-up no request waits for a render. The price: the
data in the HTML can be at most `revalidate + one refresh round` behind. That
price is acceptable, because live fields such as prices are updated on the
client over WebSocket.

The store is an LRU: an accessed entry is moved to the end, and once the limit
(`cache().maxEntries`, 500 by default) is exceeded the oldest is evicted.

## What gets written to the cache

Only output that satisfies **both** of these two conditions is stored:

1. `status === 200`
2. `degraded !== true` — no transient upstream failure was reported during the
   render.

So 404 pages, redirects and HTML produced with missing data do not enter the
cache.

## Response headers

`route()` writes `X-JSkelet-Cache` on every response (the header name can be
changed with `brand.cacheHeader`):

| Value | Meaning |
| --- | --- |
| `HIT` | From the cache, fresh |
| `STALE` | From the cache, expired; being refreshed in the background |
| `MISS` | Rendered on this request (or the cache is off) |

On cacheable responses, additionally:

```
Cache-Control: public, max-age=0, s-maxage=<revalidate>, stale-while-revalidate=60
```

`max-age=0` turns off storage in the browser, `s-maxage` announces the duration
to intermediate layers (CDN, reverse proxy). This way, when a CDN sits in
front, the same freshness model works across both layers together.

## Storing the compressed body

Every cached entry carries an `encoded` map and shares the same lifetime as the
HTML. The first time a page is requested with brotli or gzip the output is
computed and put in the map; on subsequent requests the same buffer is sent.
The same page is not re-brotli'd on every request.

On this path `Content-Encoding`, `Vary` and `Content-Length` are written
directly by `route()`; the compression middleware does not kick in because it
sees `Content-Encoding`.

`HEAD` requests are not compressed (there is no body). If the client accepts
neither brotli nor gzip, plain HTML is sent.

## Per-request memoization: `cache()`

The equivalent of React's `cache()` function: calls made with the same
arguments within the same request run only once.

```js
// lib/api/articles.js
import { cache } from "jskelet";

export const getArticle = cache(async (slug) => {
  const response = await fetch(`${process.env.API_ORIGIN}/articles/${slug}`);
  return response.json();
});
```

Now if both the controller and `hooks.layoutContext()` ask for the same article
in the same render, a single upstream request is made.

Details:

- The context is carried with `AsyncLocalStorage` and is set up by
  `withRequestCache()` inside `route()`.
- **Without a context, memoization is disabled** and the function is called
  directly. Calling it from a script or from inside another process is safe.
- The key is `JSON.stringify(args)`; argument-less calls share the `""` key. Do
  not use it with arguments that cannot be serialised (functions, `Symbol`,
  circular objects).
- What is stored is the function's **return value**, that is, the Promise
  itself for `async` functions. Because the same Promise is shared, concurrent
  calls collapse too.
- `withRequestCache(run)` is exported; it can be used to set up the same scope
  outside `route()` (for example in an Express handler you wrote yourself).

## Cross-request data cache: `withDataCache`

`cache()` only lives for the duration of **a single request**. What it takes to
protect the long tail from the API quota is a data layer that lives across
requests, has a TTL and refreshes itself:

```js
// lib/api/articles.js
import { withDataCache, reportUpstreamFailure } from "jskelet";

export async function getArticle(slug) {
  return withDataCache(`news:${slug}`, 600, async () => {
    const response = await fetch(`${process.env.API_ORIGIN}/articles/${slug}`);

    if (!response.ok) {
      reportUpstreamFailure({ status: response.status, path: `/articles/${slug}` });
      return null;
    }

    return response.json();
  });
}
```

The wrapper form of the same pattern — the key is derived from the arguments:

```js
import { dataCache } from "jskelet";

export const getArticle = dataCache(
  async (slug) => apiGet(`/articles/${slug}`),
  { key: "news", revalidate: 600 },
);
```

Behaviour:

| State | Result |
| --- | --- |
| Fresh entry | Returns immediately, the `producer` does not run |
| TTL expired, still inside the stale window | The stale value returns **immediately**, the refresh runs in the background |
| No entry | The `producer` is awaited |
| The `producer` failed, a stale entry exists | The stale value returns, warning: `[data-cache] producer failed, serving stale value: …` |
| The `producer` failed, there is no entry | The error goes to the caller |

Details:

- **Concurrent calls for the same key collapse into one upstream request.** This
  is the behaviour that saves the most quota during warm-up rounds: if 50 pages
  want the same index data, the API is called once.
- **`null` and `undefined` are not stored.** An application's HTTP client
  usually returns `null` on failure; storing that would freeze a transient 429
  into "no data" for the whole TTL. Pass `{ storeEmpty: true }` if you want the
  empty answer stored deliberately.
- **The stale window is longer than the HTML one**: `staleFactor` defaults to 10,
  so an entry stays as an emergency fallback for 11 times its TTL. Stale data is
  better than an incomplete page. It can be turned off per key with
  `{ staleFactor: 0 }`.
- The key belongs entirely to the application: distinctions such as language,
  version or page number go into the key (`news:en:v2:${slug}`).
- When the TTL is `0` the cache is disabled and the `producer` runs on every
  call — enough to switch a setting off temporarily.

The management surface:

| Function | What it does |
| --- | --- |
| `withDataCache(key, ttlSeconds, producer, options?)` | The main entry point |
| `dataCache(fn, { key, revalidate, … })` | The function wrapper |
| `clearDataCache(prefix?)` | Drops the entries matching the prefix (or all of them), returns how many were removed |
| `getDataCacheSize()` | The number of entries |
| `getDataCacheEntries()` | A dump: `{ key, stale, expiresIn }`. The value itself is not returned. |

`clearDataCache("news:")` is the counterpart of a "this content was updated"
webhook: it drops one section's data **and stales the HTML pages that read it**,
so the update shows up without waiting for a TTL. See "Automatic dependencies"
below.

## Degraded render: `reportUpstreamFailure`

If upstream went down during the render, the output contains missing data.
Rather than serving such HTML for the whole TTL, the right behaviour is to
**never write it** to the cache: the next request tries again.

This information arrives through two paths.

### Automatic tracking (the default)

At startup `createApp()` wraps `globalThis.fetch` and reports **transient**
failures (`429`, `5xx`, network errors) from calls made during a render on its
own. No application code is needed; if your API client talks over `fetch`, the
rate limit protection is already in place.

The details:

- Only calls inside a render scope count. A `fetch` from a script, a cron job or
  anywhere outside a request is left untouched.
- Requests to our own server (`localhost`, `127.0.0.1`) are skipped: the warm-up
  round and the health check are not upstream.
- Deterministic answers such as `404`/`403` are **not** reported automatically.
  In most APIs a `404` means "no such record"; treating it as missing data would
  produce a false warning on every not-found page.
- To turn it off: `cache().trackUpstream: false`. An application that wraps
  `fetch` itself (metrics, retries, a circuit breaker) may prefer that.

### Manual reporting

For a client that does not use `fetch` (a database driver, gRPC, a vendor SDK),
or for a layer that wants to flag permanent failures too, the contract is
unchanged. The dependency direction is deliberately inverted: the framework does
not know about the data layer, the data layer notifies the framework. If nobody
ever calls it, the cost is an empty array. If the same failure arrives through
both paths it is de-duplicated.

```js
// lib/api/client.js
import { reportUpstreamFailure } from "jskelet";

export async function apiGet(path) {
  try {
    const response = await fetch(`${process.env.API_ORIGIN}${path}`);

    if (!response.ok) {
      reportUpstreamFailure({ status: response.status, path });
      return null;
    }

    return response.json();
  } catch (error) {
    // No response at all: status 0 means a network error.
    reportUpstreamFailure({ status: 0, path });
    return null;
  }
}
```

### Distinguishing transient and permanent failures

| State | Counts as | Result |
| --- | --- | --- |
| `0` (network error), `408`, `425`, `429`, `>= 500` | **Transient** | The page is not written to the cache, warning: `[render] <path> was produced with missing data, not caching it (…)` |
| Others (`400`, `403`, `404`, …) | **Permanent** | Only a warning: `[render] <path> was produced with missing data, upstream is failing permanently (…)`. The cache is not blocked. |

Permanent failures not blocking the cache is deliberate: deterministic answers
do not get better by retrying. Turning the cache off because of them would mean
rendering the page from scratch on every visit — the content comes back just as
incomplete, and the visitor only pays the render time.

Output produced with missing data is **not offered to shared caches** either: a
`degraded` response gets `private, no-store` instead of `public, s-maxage=…`.
Taking back the "do not store" decision at the CDN would repeat the same mistake
one layer up. The diagnostic header (`X-JSkelet-Cache: MISS`) is still written.

### When `notFound()` coincides with a transient failure

A controller that calls `notFound()` because no data arrived can turn the whole
site into 404s when upstream is rate limited — and because those 404s enter the
cache, a temporary quota problem becomes a "this page does not exist" answer for
the whole TTL. For a search engine that is a permanent loss.

The framework separates the two cases: if a **transient** upstream failure
happened during the render, `notFound()` is not served as a 404. In order:

1. The page is **retried** after a short delay (once by default, after 300 ms).
   The retry runs in its own upstream and per-request cache scope, so neither
   the first round's failure nor its memoized empty answers affect it.
2. If the second round can produce the page, the visitor sees the **real
   content** and the output is cached normally. Warm-up logs show this is
   common: the same path returns 200 seconds later.
3. If the retries are exhausted the response is a `503` — not cached, carrying
   `Retry-After`, and the next request can still produce the real content.

| During the render | Result of `notFound()` |
| --- | --- |
| A transient failure exists (`429`, `5xx`, network error) | Retry → the page if it succeeds; otherwise `503`, `Retry-After: 30`, `no-store` |
| The retry got a clean answer saying "not there" | A normal `404` |
| A permanent failure (`404`, `403`…) or no failure | A normal `404`, no retry |

The log lines:

```
[render] /news/x returned notFound() while upstream is failing (429 /api/...), retrying (1/1)
[render] /news/x could not be produced, upstream is still failing (429 /api/...), serving an uncached 503 instead of a 404
```

So **an existing page never turns into a 404**: either the real content arrives,
or an uncached 503 does. Nothing is frozen as "missing".

The cost of a retry is a second round of requests on upstream, which is why the
default is a single attempt. The setting is `cache().transientRetry`:

```js
cache: {
  transientRetry: { attempts: 2, delayMs: 500 },
}
```

`transientRetry: false` (or `attempts: 0`) disables the retry and falls straight
through to the 503.

## Upstream rate limit: `cache().upstream`

Everything above describes what happens **after** a 429 arrives. This section is
about not getting one in the first place.

The brake sits inside the `trackUpstreamFetch()` wrapper, that is, where the
real `fetch` call goes out. The prewarm pass's `prewarm.rps` cannot do this job:
it counts **page** requests to our own server, but one page render may make one
API call or twenty. What binds the quota is the number of calls, not the number
of pages — and with the brake here, prewarming and real traffic spend the same
budget.

Off by default: unless `rate` is given, no request ever waits and the cost is a
single branch.

```js
// jskelet.config.mjs
cache: () => ({
  upstream: {
    rate: 10, // ceiling in calls per second, per host
    burst: 20, // tolerance for short bursts
    concurrency: 8, // calls in flight at once
    hosts: {
      // Endpoints with a different quota get their own settings.
      "api.example.com": { rate: 3, concurrency: 2 },
    },
  },
}),
```

### Three mechanisms, three different limits

| Mechanism | What it bounds | Settings |
| --- | --- | --- |
| Token bucket | Average rate (calls per second) | `rate`, `burst` |
| Concurrency | Instantaneous pressure (calls in flight) | `concurrency` |
| AIMD | What the right rate actually is | `minRate`, `increaseStep`, `increaseIntervalMs`, `decreaseIntervalMs` |

The third one is the real idea. A fixed rate is always either too slow or too
fast: nobody can write the true quota limit into a config file, and it changes
during the day anyway. So `rate` is treated as a **ceiling** and the actual rate
moves with what the upstream says:

- **429 or 503** → the rate is halved (multiplicative decrease). If the response
  carries `Retry-After`, the bucket stops entirely for that long — the upstream
  is already telling you how long to wait.
- **Every clean window** → the rate climbs by `increaseStep` (additive
  increase), up to the `rate` ceiling.

Decreasing multiplicatively and increasing additively is deliberate. The other
way round would earn a fresh 429 every window.

### Circuit breaker

A host that returns `breakerFailures` (default 5) rate limits in a row is
bypassed entirely for `breakerCooldownMs`: the call is not made at all and is
reported straight away as a transient failure.

It looks harsh, but the asymmetry demands it: because a 429 counts as transient,
the HTML produced by that call is **not stored**. So a pass that hit the rate
limit spends quota and stores nothing in return — and the next pass finds the
same page cold and tries again. The breaker stops that burn.

```
[upstream] api.example.com: 5 consecutive rate limits — bypassing for 10000ms (rate is now 1.2/s)
```

Only 429 and 503 count. A `400`/`404` is not a quota problem and neither is a
`500`: slowing down does not fix them, it only makes the site slower.

### Seeing the state

`getUpstreamLimiterStatus()` returns the current rate, calls in flight and
counters per host; the dev panel's **Server** tab prints the same thing. During
a 429 storm, tuning without knowing "what rate is it down to right now" is
guesswork.

```js
import { getUpstreamLimiterStatus } from "jskelet";

// [{ host: "api.example.com", rate: 2.5, maxRate: 10, concurrency: 8,
//    active: 3, throttled: 12, rejected: 40, bypassed: false, blockedMs: 0 }]
```

### Before turning it on

The rate limit is a last resort. If hundreds of pages fetch the same upstream
response, the real fix is keeping the
[`withDataCache`](#cross-request-data-cache-withdatacache) TTL longer than the
pass interval: a 400-page pass then makes one call for a shared endpoint. The
brake slows those calls down, it does not reduce their number.

## Managing the cache

`jskelet` exports these functions:

| Function | What it does |
| --- | --- |
| `withHtmlCache(key, ttlSeconds, producer)` | For using the cache directly. If `ttlSeconds` is 0 the producer always runs. |
| `invalidateHtmlCache(target, options?)` | Stales the matching pages (or drops them with `{ hard: true }`) and returns how many were affected. |
| `clearHtmlCache()` | Empties the store completely. |
| `getHtmlCacheSize()` | The number of entries. |
| `getHtmlCacheEntries()` | A dump: `{ key, bytes, status, stale, expiresIn, encodings, deps }`. The HTML body is not returned, only its size. |

### Targeted invalidation

`invalidateHtmlCache()` fills the gap between waiting for the TTL and flushing
the whole cache:

```js
import { invalidateHtmlCache } from "jskelet";

invalidateHtmlCache("/news/abc");             // that path and everything under it
invalidateHtmlCache("/news/:slug");           // the pattern syntax
invalidateHtmlCache([/-comments$/, "/"]);     // regexps and lists
```

The default is to **stale** the entry, not to delete it: it is treated as
expired and falls through the normal stale-while-revalidate path. When a webhook
takes down five hundred pages at once, a hard delete starts five hundred cold
renders at exactly the moment the content changed, and hammers the upstream.
Staling instead hands the visitor the old HTML without a wait, and the refresh
runs in the background, once per key. Use `{ hard: true }` when the old HTML is
genuinely invalid.

Since the key is `path?query`, matching is done against the **path**: every
query variant of a path (including `?utm_source=…`) is covered by one call. For
a plain string the prefix stops at a segment boundary — a `/news` rule does not
touch `/newsletter`.

An in-flight render is targeted too: a pass that started before the purge is
carrying data that is now out of date, so it is **not** stored and the next
request starts a fresh pass.

### Automatic dependencies: `clearDataCache` refreshes the HTML too

You do not have to declare which page is affected by which content. Every
`withDataCache` key read during a render is recorded, and when `clearDataCache()`
drops a key, every HTML entry that **actually read it** is staled.

```js
// the "this article changed" webhook
clearDataCache(`news:${slug}`);
```

That single line refreshes the article page, the home page that lists it and the
tag page together — because all three read that key. The most common mistake in
manual tagging (marking the detail page and forgetting the listing) is
structurally impossible here: nothing is declared, everything is observed.

Details:

- Dependencies are collected **on every refresh**, since the keys a page reads
  can change over time.
- A purge that lands while a render is in flight is caught as well: that pass
  would be stale the moment it was born, so it is not stored.
- The dependency count per page shows up as `deps` in the `getHtmlCacheEntries()`
  dump. If an invalidation is not refreshing the page you expected, look there
  first: the page may not be reading that data through `withDataCache`.
- An application that does not use `withDataCache` has nothing to record;
  tracking can be turned off entirely with `cache().trackDependencies: false`.
- Staled paths go to the **front** of the prewarm queue. If `prewarm` is set up
  the page is refreshed without waiting for a visitor, and the pass summary says
  so: `[prewarm] warmed 12/12 pages, 3 invalidated (0.4s)`.

To write an admin endpoint:

```js
import { clearHtmlCache, getHtmlCacheEntries } from "jskelet";

export default function register(app) {
  app.post("/_admin/cache/clear", (req, res) => {
    if (req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) {
      res.status(404).end();
      return;
    }
    clearHtmlCache();
    res.json({ ok: true });
  });

  app.get("/_admin/cache", (req, res) => {
    res.json(getHtmlCacheEntries());
  });
}
```

The dev server also clears the cache by itself whenever the manifest changes:
the stored HTML would be carrying asset URLs with old hashes, and if it were
not cleared the page would keep requesting a deleted file
([09-dev-tools.md](./09-dev-tools.md)).

Because the cache lives in process memory, if you run more than one
process/replica each one has its own cache; `clearHtmlCache()` only affects the
process it is called in. The next section covers how to get past this when you
run several instances.

## A shared cache: Redis

The default cache belongs to a single process. That is the fastest and simplest
setup for a site running one instance — but two problems appear once you run
three replicas:

1. **Every replica warms up on its own.** When a new instance comes up, or a
   container is replaced after a deploy, its cache is empty: the same page is
   rendered three times and the same data is fetched three times.
2. **Invalidation reaches one replica.** The webhook that calls
   `invalidateHtmlCache()` only refreshes the instance that received the
   request; the others wait for the TTL. A visitor sees the old or the new
   content depending on which replica they land on.

`cache().redis` solves both. Redis is **not the primary store**: the in-process
cache (L1) stays exactly as it is and every request reads it; Redis is a second
tier (L2).

```js
// jskelet.config.mjs
export default {
  cache() {
    return {
      html: { "/news/:slug": 300 },
      redis: {
        enabled: true,
        url: process.env.REDIS_URL,
        namespace: "news-site",
      },
    };
  },
};
```

`ioredis` is an optional peer dependency, installed in the application itself:

```bash
npm install ioredis
```

If it is not installed, or Redis cannot be reached, a warning is printed and the
site **keeps running on the in-process cache**. The same happens if Redis goes
down while running: a circuit breaker bypasses the tier for five seconds after
five consecutive failures, so requests do not each wait for a network timeout.

### What you get

- **A cold instance finds a warm cache.** For a path that is not in L1, Redis is
  read before the render runs; if another replica already produced that page, the
  render never happens.
- **The data cache spends the quota once.** `withDataCache` works the same way,
  and the gain is bigger here: JSON is small, and what one replica fetched is
  enough for all of them.
- **Invalidation reaches every replica.** `invalidateHtmlCache()`,
  `clearHtmlCache()` and `clearDataCache()` leave a message on a pub/sub
  channel and each instance applies the same operation to its own L1. The
  pattern is published, not the matched keys — which path is hot where depends
  on the replica.

### Key layout

```
_jskelet:{namespace}:{buildId}:html:{path}?{query}
_jskelet:{namespace}:{buildId}:data:{key}
_jskelet:{namespace}:events
```

`buildId` changes with every build (`jskelet build` writes it to
`.jskelet/build.json`) and it is a **required** part: the stored HTML embeds
hashed asset paths, so after a deploy the old HTML is invalid. Because the id
sits in the prefix, a new version automatically writes into a new namespace and
the old keys die with their TTL — no manual cleanup and no `FLUSHDB`. When the
build has not been run the id is `dev`.

`namespace` separates several applications sharing one Redis. The event channel
deliberately does **not** carry `buildId`: during a deploy the old and the new
version run side by side and a purge has to reach both.

### Trade-offs worth knowing

- **Personalised output is never shared.** A render marked `storable: false` (a
  page that read a cookie or `Authorization`) is never written to Redis. The
  rule already holds in a single process, but it matters far more in a shared
  tier: a leak would mean serving one user's HTML to the whole cluster.
  `degraded` renders and non-200 status codes are not shared either.
- **Compressed bodies stay local by default.** `storeEncoded: true` turns this
  on, but it doubles or triples the size per entry; recomputing brotli is
  usually cheaper than downloading it from Redis.
- **A soft invalidation deletes the Redis copy.** Staling in Redis would mean a
  read-modify-write round per key, and a webhook drops thousands of keys at
  once. The cost of deleting is one render on a replica that never saw that
  path; replicas whose L1 is hot keep serving the old HTML through the stale
  window.
- **Only fresh entries are accepted.** Promoting a stale copy into L1 would
  postpone the refresh forever: the entry stays stale, every pass reads Redis
  again and the render never runs.
- **Consistency is eventual.** There is a short window between a purge and that
  purge reaching every replica. During it a replica may serve the old HTML; the
  window is bounded by the TTL.
- **Keep it off in dev.** The dev server clears the cache whenever the manifest
  changes, which makes a shared store pointless. `enabled` only turns on when
  `true` is passed explicitly.

### Seeing the status

```js
import { getRedisStatus } from "jskelet";

app.get("/api/healthcheck", (req, res) => {
  res.json({ ok: true, cache: getRedisStatus() });
});
```

Safe to call even with no connection. The returned object is
`{ enabled, connected, keyPrefix, buildId, errors, bypassed }`; `bypassed` tells
you the circuit breaker is open and `errors` is the total command failure count.
The same summary is in the dev panel report
([09-dev-tools.md](./09-dev-tools.md)).

The full list of settings: [07-configuration.md](./07-configuration.md).

## The admin panel

Instead of hand-writing the `getHtmlCacheEntries()` / `getRedisStatus()`
endpoints above, the framework ships a panel. It is deliberately separate from
the dev overlay: the overlay only exists while `NODE_ENV=development`, while the
panel does not look at the environment — "why is this page stale", "did the
webhook purge land", "is Redis actually connected" are production questions.

```js
// jskelet.config.mjs
export default {
  cache() {
    return {
      html: { "/news/:slug": 300 },
      panel: { enabled: process.env.CACHE_PANEL === "1" },
    };
  },
};
```

Without `enabled` **nothing is mounted**: the path does not exist, the module is
never loaded and it costs the production process nothing. The environment
variable (`JSKELET_CACHE_PANEL=1`) overrides the config, because the panel is
usually opened once during an incident and editing the config file and
redeploying is the last thing you want at that moment.

When the panel is on, the server log prints the password:

```
[cache-panel] http://localhost:3000/_jskelet/cache — password for this run: 3f9c…
```

### Access and hardening

- **The password is regenerated on every process start** (32 hex characters) and
  only ever appears in the log. There is no persistent secret to leak: leaking
  one means handing out the right to flush the cache, and a deploy should revoke
  old access on its own.
- **The password is not accepted in the query string,** so access logs, browser
  history and the `Referer` header never carry it. Sign-in goes through the form.
- **Three failed attempts ban the IP for 24 hours** (`banAttempts`, `banHours`).
  Requests without a session count just like a wrong password; a successful
  sign-in resets the counter.
- **Banned and unauthorised requests get a `404`.** A 401 or 403 confirms the
  panel exists; a 404 behaves as if it never did. The rest of the site is
  untouched.
- **Nothing is indexable:** every response carries `X-Robots-Tag: noindex,
  nofollow, noarchive, nosnippet`, `Cache-Control: no-store` and
  `Referrer-Policy: no-referrer`. The path is also exempt from prewarming and
  from navigation speculation.
- Actions require an `X-JSkelet-Cache-Panel` header — a header a cross-site form
  cannot send, which is the panel's own CSRF brake.
- Sessions and ban counters live in process memory; persisting them to disk
  would be the wrong trade for a panel whose password changes on every restart.

### What the panel shows

| Area | Contents |
| --- | --- |
| Top bar | Environment, pid, uptime, RSS |
| Cards | HTML entry count and limit, HTML bytes in memory, stale entry count, data entry count, Redis state (`connected` / `bypassed` / `off`), prewarm progress |
| Entry list | HTML: key, fresh/stale, size, status code, remaining TTL, dependency count, precompressed bodies. Data: key, fresh/stale, remaining TTL |

The list is **filtered by key** and the filter runs on the server: a data cache
can hold tens of thousands of keys. At most 500 rows come back per request and
the counter in the heading says how many matches were cut. HTML bodies and
cached values are **never returned** — the panel's job is to show state, not to
export content.

### What you can do from it

| Action | Equivalent call |
| --- | --- |
| Invalidate (target + `hard`) | `invalidateHtmlCache(target, { hard })` |
| `drop` a single row | `dropHtmlCacheKey(key)` / `dropDataCacheKey(key)` |
| Clear HTML cache | `clearHtmlCache()` |
| Clear data cache (optional prefix) | `clearDataCache(prefix)` |
| Drop shared keys | Scans and unlinks the `html` or `data` namespace in Redis |
| Prewarm | `prewarm()` — the pass runs in the background, progress shows in the card |

Each one propagates to the shared tier as well: clearing a single replica's
cache is what produces the "I cleared it and it is still old" question in a
clustered setup.

Dropping a single row is not the same as `invalidateHtmlCache()`: that one
matches a path pattern and takes down **every** query variant of a path, while
`dropHtmlCacheKey()` takes the exact key — `/list?page=2` goes and
`/list?page=3` stays hot.

## Prewarm — warming up at startup

The equivalent of Next's build-time prerender, except the output is not written
to disk: since the cache lives in process memory, the warm-up also happens when
the process comes up. The gain is the same — the first visitor does not wait
for a cold render — but the data is not frozen; every entry ages with the
route's `revalidate` and is refreshed in the background with
stale-while-revalidate.

The warm-up is done with **real HTTP requests**
(`http://127.0.0.1:<port>`), so that the cache key, the compression and the
middleware chain are exactly the same as with normal traffic.

### `hooks.prewarmPaths()`

The application declares which paths get warmed; usually it is the very same
function that produces the sitemap.

```js
// jskelet.config.mjs
export default {
  hooks: {
    async prewarmPaths() {
      const slugs = await getAllArticleSlugs();
      return ["/", "/markets", ...slugs.map((slug) => `/news/${slug}`)];
    },
  },
};
```

Rules:

- If it does not return an array a warning is printed and no warm-up happens.
- Only strings starting with `/` are taken.
- Ones starting with one of the `prewarmSkip` prefixes are skipped. The default
  list: `/api/`, `/_fragment/`, `/__jskelet/`. Session-dependent pages should
  not be warmed.
- Deduplication **preserves order**: when no `priority` is given, the order the
  application provides is meaningful — put the most important pages first.
- If this hook is not defined the warm-up is never set up; not even the timer
  is started.

### Round logic

1. The list is collected. If it is longer than `max` (400 by default) a slice is
   selected: the paths matching `priority` are taken first **on every round**,
   and the remaining slots are filled from the queue.
2. `concurrency` workers send requests in parallel (4 in prod, 1 in dev). A
   single worker in dev: so the scan does not compete for CPU with the render of
   the page you currently have open in the browser.
3. If `rps` is given, the round never goes above that rate — no matter the
   parallelism. In dev, 4 requests per second apply by default: rendering runs
   on a single event loop, so an unpaced round leaves page requests and the dev
   panel's live channel waiting behind it.
4. **A single serial retry round** is performed for the paths that hit a
   **transient** failure (`concurrency: 1`). Permanent answers like `400`, `403`
   or `404` are not retried: a deterministic error does not get better on the
   second try and those calls spend quota for nothing. The summary shows them as
   `N not retried (permanent)`.
5. The wait before the retry is `retryDelayMs`, but when the rate limit is on and
   something is holding it back, that wins: retrying 2 seconds into a 10 second
   circuit breaker would just earn the same 429 up front.
6. A summary is logged:
   `[prewarm] warmed 128/130 pages, 2 failed, 5 recovered on the retry pass (12.4s)`

Then comes how much the pass actually touched the upstream:

```text
[prewarm] 12 upstream calls for 430 data reads (97% from the data cache, 38 coalesced)
```

This is the one line that tells you which way to turn the knob. If the ratio is
low the fix is not the rate limit but a longer `withDataCache` TTL — the brake
slows calls down, it does not reduce their number. The same counters are
available through `getDataCacheStats()` and on the dev report's **Data cache**
card.

Request errors and the per-page render warnings (`was produced with missing
data`, `returned notFound() while upstream is failing`, `could not be
produced`) raised during the pass are not logged one by one. They are counted
while the pass runs and printed after the summary, most frequent kinds first:

```text
[prewarm] 137 problems were not logged individually:
  94× missing data, upstream is failing permanently (403 /api/v1/polls)
  37× missing data, upstream is failing permanently (400 /api/v1/posts)
  6× 500 Cannot read properties of undefined (reading 'title')
```

This way a momentary upstream failure cannot bury the "warmed …" line under
hundreds of stack traces. Errors from real traffic are logged immediately as
before; for the detail of a single path, look at the **Prewarming** tab in the
dev panel.

### Warm-up order: `priority`

```js
// jskelet.config.mjs
cache: () => ({
  prewarm: {
    priority: [
      "/",
      "/markets/:path*",
      /-comments$/,
    ],
  },
}),
```

The pattern syntax (`/news/:slug`) and a plain `RegExp` can be used together;
the latter is for rules the pattern syntax does not cover, such as "everything
ending in `-comments`". Whatever is written first is warmed first; paths that
match nothing go to the queue and keep their relative order.

### Drip warm-up: `rotate` + `rps` + `intervalSeconds`

On a site with 10,000 paths, warming everything in a single round is neither
possible (the HTML cache holds 500 entries) nor right (the API quota runs out).
The correct behaviour is to spread the list over time:

```js
prewarm: {
  max: 300,               // 300 pages per round
  rps: 4,                 // at most 4 requests per second
  intervalSeconds: 300,   // a round every 5 minutes
  rotate: true,           // the queue continues where it left off
  priority: ["/", "/markets/:path*"],
}
```

In this setup the priority pages are refreshed on every round, the rest of the
queue is walked end to end across rounds, and upstream never sees more than four
requests per second. Used together with the data cache, the warm-up barely
reaches the API after the second round: it reads from the data layer.

With rotation on, the paths left outside the limit are not lost, they are left
for the next round; the log distinguishes this:
`… , 700 deferred to the next pass`. With `rotate: false` you get the classic
behaviour — every round warms the same first slice of the list and the rest is
never warmed (`… , 700 over the limit`).

If a round takes longer than `intervalSeconds`, a new round is not started;
overlapping rounds would put twice the load on upstream.

The requests go out with the headers `user-agent: jskelet-prewarm`
(`brand.prewarmUserAgent`) and `accept-encoding: br, gzip`; the second one so
that the compressed body enters the cache too.

If `DEV_TOKEN` is set, the warm-up carries the token as a cookie; otherwise the
dev gate returns 404 for all pages and the cache never fills.

The request list in the dev panel and the terminal filter out requests carrying
`prewarmUserAgent`: so that hundreds of warm-up requests do not flood the view.
Progress shows up in the badge next to the bubble.

### Timing

- The warm-up starts at boot **with a delay**: so it does not compete with the
  first real requests. The default delay is 500 ms in prod and 3000 ms in dev.
  Longer in dev, because a file save restarts the process and the timer dies
  with it; it only warms up once the server stays quiet for a while.
- If `PREWARM_INTERVAL_SECONDS` / `cache().prewarm.intervalSeconds` > 0 the
  round is repeated periodically. Because entries age with `revalidate` and the
  visitor does not wait thanks to stale-while-revalidate, this is **optional**;
  it is for setups that also want to keep pages that are never visited warm.
- All timers are `unref()`ed: they do not delay process shutdown.
- No warm-up failure takes the process down.

### Settings

Order of precedence: **environment variable → config → code default.** Env
comes first so that one-off experiments can be done without editing the config.

| Setting | Env | `cache().prewarm` | Default |
| --- | --- | --- | --- |
| On/off | `PREWARM=0` disables it, `PREWARM=1` overrides the config and enables it | `enabled` | `true` |
| Maximum paths per round | `PREWARM_MAX` | `max` | `400` |
| Parallelism | `PREWARM_CONCURRENCY` | `concurrency` | prod 4, dev 1 |
| Requests per second | `PREWARM_RPS` | `rps` | prod `0` (unlimited), dev 4 |
| Startup delay (ms) | `PREWARM_DELAY_MS` | `delayMs` | prod 500, dev 3000 |
| Retry round delay (ms) | `PREWARM_RETRY_DELAY_MS` | `retryDelayMs` | `2000` |
| Period (seconds) | `PREWARM_INTERVAL_SECONDS` | `intervalSeconds` | `0` (off) |
| Queue rotation | — | `rotate` | `true` |
| Warm-up order | — | `priority` | `[]` |

Numeric settings only accept **positive and finite** values; an invalid value
silently falls through to the next layer.

### Triggering by hand

```js
import { prewarm, prewarmProgress } from "jskelet";

await prewarm({ origin: "http://127.0.0.1:3000" });          // paths from the hook
await prewarm({ origin, paths: ["/", "/markets"] });        // only these paths
await prewarm({ origin, quiet: true });                       // without printing a summary
```

If `paths` is given the hook is never called. The return value is
`{ ok, failed, total, elapsed }`.

`prewarmProgress` holds the live state and the dev panel reads it:

```js
{
  active, done, total, ok, failed, startedAt, finishedAt,
  entries: [{ path, status, ms, bytes, cache, error }],
}
```

The `cache` field inside `entries` is that path's `X-JSkelet-Cache` response;
from there you can see whether the warm-up round really returned `MISS` and
filled the cache.

## Diagnosis: common situations

- **Every request returns `MISS`.** The route was not given a `revalidate`, or
  the pattern inside `cache().html` gives 0 seconds. Or the page returns a code
  other than `status: 200`.
- **The page returns `MISS` but upstream is healthy.** A transient upstream
  failure may have been reported; look for the line `was produced with missing
  data, not caching it` in the log.
- **Stale data all the time.** `revalidate` is too high; remember that the real
  lag is at most `revalidate` + one refresh round.
- **The cache is bloating.** Because query parameters go into the key, campaign
  parameters may be multiplying entries.
- **The warm-up never runs.** `hooks.prewarmPaths` is not defined, `PREWARM=0`
  is set, or `cache().prewarm.enabled === false`.
- **The warm-up round pushes the API into 429.** No `rps` was given. Lowering
  `concurrency` is not enough; the setting that protects the quota is the total
  rate. The lasting fix is the data cache: after the second round the warm-up
  does not reach upstream.
- **The warm-up list is longer than `max` and its tail never warms.** `rotate`
  may be `false`; the `over the limit` phrase in the log shows this.
- **A whole section returns 404.** Upstream may be down. The page is now retried
  once and, failing that, a 503 that does not enter the cache is returned
  instead of a 404; look for the `returned notFound() while upstream is failing`
  line in the log. If you still see 404s, the failure may come from a non-`fetch`
  client (which needs `reportUpstreamFailure()`) or `cache().trackUpstream` is
  off.

## What's next

- The full reference of config fields and the env table:
  [07-configuration.md](./07-configuration.md)
- Watching the cache from the dev panel: [09-dev-tools.md](./09-dev-tools.md)
- Using it together with a CDN/reverse proxy: [10-deployment.md](./10-deployment.md)
