# 06 — Caching and prewarm

This document explains JSkelet's ISR substitute in full detail: the HTML TTL
cache and its stale-while-revalidate behaviour, where `revalidate` comes from,
how the cache key is built, the values of the `X-JSkelet-Cache` header, why the
compressed body is kept in the cache, per-request memoization
(`withRequestCache` / `cache()`), the data cache (`withDataCache`), how upstream
failures affect the cache (`reportUpstreamFailure`) and the prewarm round at
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
webhook: it drops one section's data so the next HTML refresh picks up the new
content.

## Degraded render: `reportUpstreamFailure`

If upstream went down during the render, the output contains missing data.
Rather than serving such HTML for the whole TTL, the right behaviour is to
**never write it** to the cache: the next request tries again.

The dependency direction is deliberately inverted: the framework does not know
about the data layer, the data layer notifies the framework. If nobody ever
calls it, the cost is an empty array.

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

The framework separates the two cases: if a **transient** upstream failure was
reported during the render, `notFound()` is not served as a 404.

| During the render | Result of `notFound()` |
| --- | --- |
| A transient failure exists (`429`, `5xx`, network error) | `503`, `Retry-After: 30`, `no-store` — **not** written to the cache, the next request produces the real content |
| A permanent failure (`404`, `403`…) or no failure | A normal `404` |

The log line:
`[render] /news/x returned notFound() while upstream is failing (429 /api/...), serving an uncached 503 instead`

So when upstream runs out of quota the page is produced dynamically, without
being written to the cache; nothing is frozen as "missing".

## Managing the cache

`jskelet` exports these functions:

| Function | What it does |
| --- | --- |
| `withHtmlCache(key, ttlSeconds, producer)` | For using the cache directly. If `ttlSeconds` is 0 the producer always runs. |
| `clearHtmlCache()` | Empties the store completely. |
| `getHtmlCacheSize()` | The number of entries. |
| `getHtmlCacheEntries()` | A dump: `{ key, bytes, status, stale, expiresIn, encodings }`. The HTML body is not returned, only its size. |

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
process it is called in.

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
2. `concurrency` workers send requests in parallel (4 in prod, 2 in dev). Less
   parallelism in dev: so the scan does not compete for CPU with the render of
   the page you currently have open in the browser.
3. If `rps` is given, the round never goes above that rate — no matter the
   parallelism.
4. **A single serial retry round** is performed for the failed paths after
   waiting `retryDelayMs` (`concurrency: 1`). The wait is deliberate: rate limit
   windows are on the order of seconds, so retrying immediately just earns the
   same 429.
5. A summary is logged:
   `[prewarm] warmed 128/130 pages, 2 failed, 5 recovered on the retry pass (12.4s)`

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
| Parallelism | `PREWARM_CONCURRENCY` | `concurrency` | prod 4, dev 2 |
| Requests per second | `PREWARM_RPS` | `rps` | `0` (unlimited) |
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
- **A whole section returns 404.** Upstream may be down. In that case a 503 that
  does not enter the cache is now returned instead of a 404; look for the
  `returned notFound() while upstream is failing` line in the log.

## What's next

- The full reference of config fields and the env table:
  [07-configuration.md](./07-configuration.md)
- Watching the cache from the dev panel: [09-dev-tools.md](./09-dev-tools.md)
- Using it together with a CDN/reverse proxy: [10-deployment.md](./10-deployment.md)
