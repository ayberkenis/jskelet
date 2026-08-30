# 06 — Caching and prewarm

This document explains JSkelet's ISR substitute in full detail: the HTML TTL
cache and its stale-while-revalidate behaviour, where `revalidate` comes from,
how the cache key is built, the values of the `X-JSkelet-Cache` header, why the
compressed body is kept in the cache, per-request memoization
(`withRequestCache` / `cache()`), how upstream failures affect the cache
(`reportUpstreamFailure`) and the prewarm round at server startup. The
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
```

The order matters: the **per-request cache must be innermost** so that two
calls in the same render collapse into a single upstream request; **upstream
tracking must be inside the HTML cache** so that output produced with missing
data is not written to the cache.

## `revalidate` — where the TTL comes from

A route's TTL can come from two sources, and **the config wins**:

1. `route(controller, { revalidate: 60 })` — the route's own duration.
2. The matching pattern inside `jskelet.config.mjs` → `cache().html`. If it
   exists it overrides the route's value.

```js
// jskelet.config.mjs
export default {
  async cache() {
    return {
      html: {
        "/": 60,
        "/haber/:slug": 300,
        "/etiket/:slug": 120,
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
request is rendered and no `Cache-Control` is written on the response (only
`X-JSkelet-Cache: MISS`).

The cache also only kicks in for `GET` requests.

## The cache key

```
`${req.path}?${new URLSearchParams(query).toString()}`
```

So the path **and all query parameters** are part of the key. `/liste?sayfa=2`
and `/liste?sayfa=3` are separate entries.

The practical consequence: a page that does not depend on the query string
produces a separate entry for every combination when it is called with
different campaign parameters (`?utm_source=…`). Stripping such parameters at
the reverse proxy layer, or turning off the cache (by not supplying
`revalidate`), is a reasonable precaution; the store holds at most 500 entries
and evicts the oldest with LRU.

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
(`[html-cache] arka plan tazelemesi başarısız: …`).

Concurrent refreshes for the same key are collapsed into a single run (the
`inflight` map): a hundred concurrent requests fall to one render.

The gain: after the first warm-up no request waits for a render. The price: the
data in the HTML can be at most `revalidate + one refresh round` behind. That
price is acceptable, because live fields such as prices are updated on the
client over WebSocket.

The store is an LRU: an accessed entry is moved to the end, and once
`MAX_ENTRIES = 500` is exceeded the oldest is evicted.

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
| `0` (network error), `408`, `425`, `429`, `>= 500` | **Transient** | The page is not written to the cache, warning: `[render] <yol> eksik veriyle üretildi, önbelleğe alınmıyor (…)` |
| Others (`400`, `403`, `404`, …) | **Permanent** | Only a warning: `[render] <yol> eksik veriyle üretildi, upstream kalıcı hata veriyor (…)`. The cache is not blocked. |

Permanent failures not blocking the cache is deliberate: deterministic answers
do not get better by retrying. Turning the cache off because of them would mean
rendering the page from scratch on every visit — the content comes back just as
incomplete, and the visitor only pays the render time.

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
  app.post("/_admin/cache/temizle", (req, res) => {
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
      return ["/", "/piyasalar", ...slugs.map((slug) => `/haber/${slug}`)];
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
- Deduplication **preserves order**: since the list is trimmed with
  `PREWARM_MAX`, the priority order the application gives is meaningful — put
  the most important pages first.
- If this hook is not defined the warm-up is never set up; not even the timer
  is started.

### Round logic

1. The list is collected and trimmed with `PREWARM_MAX` (400 by default).
2. `PREWARM_CONCURRENCY` workers send requests in parallel (4 in prod, 2 in
   dev). Less parallelism in dev: so the scan does not compete for CPU with the
   render of the page you currently have open in the browser.
3. **A single serial retry round** is performed for the failed paths
   (`concurrency: 1`). The errors are mostly upstream rate limiting (429): the
   first round strains the API while fetching hundreds of pages at once. The
   retry round gets those pages into the cache; otherwise the visitor pays for
   the cold render.
4. A summary is logged:
   `[prewarm] 128/130 sayfa ısıtıldı, 2 hata, 5 sayfa tekrar turunda kurtarıldı (12.4s)`

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
| Maximum paths | `PREWARM_MAX` | `max` | `400` |
| Parallelism | `PREWARM_CONCURRENCY` | `concurrency` | prod 4, dev 2 |
| Startup delay (ms) | `PREWARM_DELAY_MS` | `delayMs` | prod 500, dev 3000 |
| Period (seconds) | `PREWARM_INTERVAL_SECONDS` | `intervalSeconds` | `0` (off) |

Numeric settings only accept **positive and finite** values; an invalid value
silently falls through to the next layer.

### Triggering by hand

```js
import { prewarm, prewarmProgress } from "jskelet";

await prewarm({ origin: "http://127.0.0.1:3000" });          // paths from the hook
await prewarm({ origin, paths: ["/", "/piyasalar"] });        // only these paths
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
  failure may have been reported; look for the line `eksik veriyle üretildi,
  önbelleğe alınmıyor` in the log.
- **Stale data all the time.** `revalidate` is too high; remember that the real
  lag is at most `revalidate` + one refresh round.
- **The cache is bloating.** Because query parameters go into the key, campaign
  parameters may be multiplying entries.
- **The warm-up never runs.** `hooks.prewarmPaths` is not defined, `PREWARM=0`
  is set, or `cache().prewarm.enabled === false`.

## What's next

- The full reference of config fields and the env table:
  [07-configuration.md](./07-configuration.md)
- Watching the cache from the dev panel: [09-dev-tools.md](./09-dev-tools.md)
- Using it together with a CDN/reverse proxy: [10-deployment.md](./10-deployment.md)
