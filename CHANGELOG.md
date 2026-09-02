# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
While the project is on `0.x`, minor releases may contain breaking changes; each
one is listed under a **Breaking** heading.

## [Unreleased]

### Breaking

- The cache admin panel moved to a top-level `admin()` config section at
  `/_jskelet/admin` (was `cache().panel` at `/_jskelet/cache`). Enable with
  `admin() { return { enabled: true } }` or `JSKELET_ADMIN=1`. `JSKELET_CACHE_PANEL` and
  `cache().panel` are removed. Auth is unchanged (per-process password in the
  server log, cookie session, 404 for strangers); the action CSRF header is now
  `X-JSkelet-Admin`.

### Fixed

- Cloudflare analytics in the cache panel no longer asks for an open-ended
  window. Queries used only `datetime_geq`, so Cloudflare closed the range at
  query time and a default 24h lookback became `1d` plus network delay — Free
  zones reject anything wider than one day. Both ends are now pinned from the
  same clock (`datetime_leq` included).

### Added

- Top-level `logs` config for persistent sinks: daily NDJSON files
  (`logs.file`) and batched S3 PutObject (`logs.s3`) with embedded SigV4 — no
  `@aws-sdk` dependency. `kinds` selects `http` / `event` / `error`; `console`
  toggles runtime stdout lines. `JSKELET_LOG_BUCKET` / `JSKELET_S3_BUCKET`
  (+ optional `JSKELET_S3_KEY_PREFIX`) may be a plain bucket or a
  `bucket/prefix/…` path; with credentials present the sink turns on without
  `enabled: true`. `JSKELET_S3_API_URL` sets the S3-compatible endpoint
  (region defaults to `auto`). Env: `JSKELET_LOG_BUCKET`, `JSKELET_S3_*`.
- Admin panel pages under `/_jskelet/admin`: Overview, Cache, Routes, Views,
  Logs and System. Configurable `allowIps` (exact or CIDR), `blockBots` (default
  on — crawler UAs get 404 before login), and `logSize`. Live Logs use an
  in-process ring plus SSE (`/api/logs/stream`) with client-side filters for
  method, status, cache, kind, path/route and text. Routes and Views are
  read-only inventories; HTTP finish middleware records timings only while the
  panel is enabled.
- `trailingSlash` in `jskelet.config.mjs` (default `false`). When `true`,
  canonical page URLs end with `/` and return 200; a request without the slash
  is sent to the slashed form with a 308 (not 301). File URLs and
  `/.well-known/**` are left alone. When `false`, no slash is enforced — unlike
  Next.js, the default does not strip trailing slashes.
- `cache().query`, a pattern → allowlist mapping that decides which query
  parameters belong to the HTML cache key. An allowlist caches one entry per
  distinct value of the listed parameters and ignores the rest, so every
  `?utm_source=…` variant of a path shares one copy; `true` puts the whole query
  in the key and `[]` ignores it entirely. Parameters enter the key sorted, so
  `?a=1&b=2` and `?b=2&a=1` are one entry.
- A cache admin panel surface (now under `admin()` — see Breaking) that lists
  what the in-process tier holds (key, size, status, remaining TTL, dependency
  count, precompressed bodies for HTML; key and TTL for data), reports whether
  the Redis tier is connected or bypassed, and runs the operations you would
  otherwise hand-write an admin route for: targeted invalidation with an
  optional hard mode, dropping a single entry, clearing either cache, unlinking
  the shared keys and triggering a prewarm pass. Unlike the dev overlay it does
  not look at `NODE_ENV`, because "why is this page stale" is a production
  question — but nothing is mounted until it is explicitly enabled, so the path
  does not exist by default. Access is a 32-character password regenerated on
  every process start and printed once to the server log; there is no persistent
  secret to leak and a deploy revokes old access on its own. The password is
  never accepted in a query string, three failed attempts ban the IP for 24
  hours, and every banned or unauthorised response is a `404` rather than a 401
  that would confirm the panel exists. The panel is excluded from indexing,
  prewarming and navigation speculation.
- A language picker in the cache panel header, Turkish and English. The first
  visit follows the browser's language, the choice is kept in `localStorage` and
  carries over to the login page, and switching costs no request. To keep this
  from leaking UI concerns into the server, an `/action` response now returns
  `{ ok, code, params }` instead of an English sentence and the panel builds the
  text — the framework's log and API stay in one language while the panel
  speaks two.
- Cloudflare cache management, from the panel and from code. Set
  `JSKELET_CLOUDFLARE_KEY` and `JSKELET_CLOUDFLARE_ZONE_ID` (or
  `cache().cloudflare`) and the panel gains the CDN tier next to the origin one:
  purge everything, purge every URL currently held in memory with one button or
  a single row with `cf purge`, purge by prefix, host or cache tag, toggle
  development mode, cache level, browser cache TTL, query string sorting,
  Always Online, Tiered Cache, Regional Tiered Cache and Cache Reserve, clear
  Cache Reserve, and read the cache hit ratio. This matters because
  `invalidateHtmlCache()` refreshes the origin while the copy your visitors get
  keeps being served from the edge until its TTL expires. The same surface is
  exported as `purgeCloudflare()`, `toCloudflareUrls()`,
  `fetchCloudflareOverview()`, `fetchCacheAnalytics()`, `fetchPathEdges()` and
  `getCloudflareStatus()`; none of them throw, so a CDN outage returns
  `{ ok: false, error }` instead of breaking a publish flow. Long purge lists
  are batched at Cloudflare's 100-keys-per-request limit and sent sequentially
  to stay inside the rate limit. The token is read from the environment, is
  never returned in a response, and only cache related zone settings can be
  changed.
- An edge breakdown for a single path: `fetchPathEdges()` reports which
  Cloudflare colos served it from cache and which went to the origin. This is
  observation, not inventory — Cloudflare has no endpoint that lists which
  edges currently hold a URL, and no way to warm an edge you pick, so the panel
  says as much rather than implying otherwise.
- `getRedisDetails()` reports where the shared tier actually points — address,
  TLS, database, namespace, which kinds are shared and whether the purge channel
  is subscribed — because "connected" alone does not explain a Redis that shares
  nothing because of a wrong namespace. The password is never part of the
  output. `inspectRedis()` counts the keys per kind plus `DBSIZE` and
  `used_memory`; it runs a `SCAN`, so the panel keeps it behind its own button
  instead of the refresh loop. When Redis is off, the panel explains what a
  shared tier would buy and shows the memory and disk state of the host instead,
  which is the number that decides whether `maxEntries` is too high.
- `dropHtmlCacheKey()` and `dropDataCacheKey()` drop one exact cache key.
  `invalidateHtmlCache()` matches a path pattern and takes down every query
  variant of a path, which is the right default for a webhook but wrong when you
  want `/list?page=2` gone and `/list?page=3` left hot.

- An adaptive per-host rate limit for upstream calls, `cache().upstream`. It sits
  in the `fetch` wrapper rather than in the prewarm pass, because what spends the
  quota is the API call, not the page: one render may make one call or twenty, so
  `prewarm.rps` could never bound the real thing. A token bucket caps the average
  rate, a concurrency limit caps the calls in flight, and `rate` is treated as a
  ceiling that the limiter pulls down on its own — a 429 or 503 halves the rate,
  `Retry-After` stops the bucket for exactly as long as the upstream asked, and
  clean windows climb back one step at a time. A host that returns
  `breakerFailures` rate limits in a row is bypassed for `breakerCooldownMs`,
  which stops the worst waste: because a 429 counts as transient, the HTML
  produced by a throttled call is never stored, so a pass in that state spends
  quota and keeps nothing. Only 429 and 503 penalise the rate; a 400 or 500 is
  not a quota problem. Off by default — set `rate` to turn it on.
- `getUpstreamLimiterStatus()` reports the current rate, calls in flight, 429
  count and breaker state per host. The dev panel's Server tab shows the same.
- `getDataCacheStats()` counts how the data cache was used: fresh hits, stale
  hits, misses, coalesced concurrent reads, values promoted from the shared tier
  and — the only number that reaches the quota — real producer runs. A prewarm
  pass now prints its own share of that (`12 upstream calls for 430 data reads
(97% from the data cache)`), which is what tells you whether the fix is a
  longer TTL or a rate limit. The dev report has a Data cache card for it.

- The dev overlay header now shows the installed JSkelet version next to the
  title, labelled `latest` when it matches npm and `outdated` with the newer
  version when it does not, so you can tell at a glance which version the
  project runs without opening the Server tab.
- An optional Redis tier behind both caches, turned on with
  `cache().redis: { enabled: true, url }` and `npm install ioredis`. The
  in-process cache stays primary and every request still reads it; Redis only
  does the two things a single process cannot. An instance that has never seen a
  path finds the HTML another replica already produced, so a fresh container or a
  post-deploy replacement does not re-render and re-fetch everything from
  scratch. And `invalidateHtmlCache()`, `clearHtmlCache()` and
  `clearDataCache()` now reach every replica over pub/sub instead of only the one
  that received the webhook — until now the others waited out the TTL and a
  visitor saw old or new content depending on where they landed. Keys live under
  `_jskelet:{namespace}:{buildId}:…`, where the build id makes HTML from a
  previous deploy expire on its own rather than pointing at asset files that no
  longer exist. Personalised (`storable: false`), degraded and non-200 responses
  are never shared. If `ioredis` is missing, Redis is unreachable or it goes down
  mid-flight, a warning is printed and the site keeps serving from memory.
- `getRedisStatus()` reports whether the shared tier is connected, which key
  prefix and build id it is using, and how many command failures there have
  been — usable from a healthcheck endpoint. The same summary appears in the dev
  panel report.
- Servers started with `startServer()` now shut down on `SIGTERM`/`SIGINT`
  instead of being killed: the listener is closed and the Redis connection is
  drained so in-flight writes are not cut mid-command.
- Targeted HTML invalidation: `invalidateHtmlCache(target, { hard })` takes a
  path, the config pattern syntax (`/news/:slug`), a regular expression or a list
  of them, and returns how many entries were affected. By default it **stales**
  the entries rather than deleting them, so a webhook that touches hundreds of
  pages does not turn into hundreds of cold renders at the worst possible moment:
  visitors keep getting the old HTML while the refresh runs in the background,
  once per key. Matching is done against the path, so every query variant of a
  page is covered by one call, and a render already in flight when the purge
  arrives is not stored.
- `clearDataCache()` now refreshes the HTML too. The `withDataCache` keys read
  during a render are recorded, so dropping `news:abc` stales every page that
  actually read it — the article, the home page listing it and the tag page —
  without the application declaring any tags. Turn it off with
  `cache().trackDependencies: false`; `getHtmlCacheEntries()` reports the
  dependency count per page as `deps`.
- Invalidated paths go to the front of the next prewarm pass, so an updated page
  is refreshed without waiting for a visitor, while still respecting the `rps`
  limit. The pass summary counts them separately.
- An upstream data cache: `withDataCache(key, ttlSeconds, producer)` and the
  `dataCache(fn, { key, revalidate })` wrapper, with `clearDataCache(prefix?)`,
  `getDataCacheSize()` and `getDataCacheEntries()` alongside them. It keeps JSON
  rather than HTML, so its default limit is 10,000 entries: a long-tail page that
  was never prewarmed still renders without touching the API. Concurrent reads of
  the same key collapse into one upstream request, an expired entry is served
  immediately while it refreshes in the background, a failing producer falls back
  to the stale value, and empty answers (`null`/`undefined`) are not stored
  unless `storeEmpty: true` is passed.
- `cache().prewarm.priority` decides the warm-up order and accepts both the
  config pattern syntax (`/news/:slug`) and plain regular expressions. Matching
  paths are warmed on every pass.
- Drip prewarming for large sites: `cache().prewarm.rps` (also `PREWARM_RPS`)
  caps requests per second regardless of parallelism, and `rotate` (on by
  default) makes periodic passes continue through the queue where the previous
  one stopped instead of re-warming the same first slice. A pass is skipped while
  the previous one is still running.
- `cache().prewarm.retryDelayMs` (also `PREWARM_RETRY_DELAY_MS`) waits before the
  retry pass, since rate limit windows are measured in seconds.
- `cache().maxEntries` configures the HTML cache limit, which used to be a fixed 500.
- Transient upstream failures are now detected without any application code:
  `globalThis.fetch` is wrapped during startup and `429`, `5xx` and network
  errors raised inside a render are reported on their own, so rate limits stop
  turning existing pages into 404s even when the data layer never calls
  `reportUpstreamFailure()`. Requests outside a render and requests to the
  server itself are ignored, deterministic answers such as `404` are not
  reported, and the wrapper can be turned off with `cache().trackUpstream:
false`.
- `cache().transientRetry` (`{ attempts: 1, delayMs: 300 }` by default) retries a
  page that called `notFound()` while upstream was failing. Each attempt runs in
  a fresh upstream and per-request cache scope, so a page whose data arrives on
  the second try is served and cached as usual instead of degrading to an error.
- The dev report now includes the data cache entry count under `cache.data`.

### Changed

- Admin panel System meters (CPU, memory, disk) show this process's share of
  the host — RSS and project disk footprint against machine totals, plus
  process CPU across all cores — instead of whole-machine fullness. The panel
  content width is wider (`1600px`) so Overview, Routes, Views and System use
  the screen better.
- The release history page in `examples/marketing` now shows one release at a
  time: the newest one is expanded and older releases collapse to a single
  header row with their date, status and change count. Every release used to be
  printed open in a two-column grid, which made the page an unreadable wall as
  soon as a few versions piled up. Version links and the quick-jump strip still
  work, and they open the collapsed release they point at.
- The prewarm retry pass no longer retries permanent failures. A `400`, `403` or
  `404` does not get better on the second try, so those paths are dropped from
  the retry round and counted as `N not retried (permanent)` in the summary. The
  wait before the round now also honours the upstream rate limit: if a
  `Retry-After` or an open circuit breaker is holding calls back, the pass waits
  that out instead of retrying into the same 429.
- Errors and warnings raised during a prewarm pass are no longer logged one per
  page. Request errors and the per-page render warnings (`was produced with
missing data`, `returned notFound() while upstream is failing`, `could not be
produced`) are counted while the pass runs and printed as a single summary
  block afterwards, grouped by message with the most frequent kinds first, so a
  failing upstream can no longer bury the "warmed N/M pages" line under hundreds
  of near-identical lines. Real traffic logs as before, and the dev tools panel
  still shows the per-path detail.
- The marketing example's changelog page is now a timeline: releases are laid out
  along a rail with a sticky version column, each change group gets its own card
  with a coloured rule and item count, and a row of version chips at the top
  jumps straight to a release.
- The dev tools panel is now fed over a WebSocket (`<devBasePath>/ws`) instead of
  polling `/stats` every two seconds. The server pushes statistics as they change
  and sends live reload and CSS hot-swap events over the same connection, so an
  open tab no longer keeps hitting the server while the panel is closed. No new
  dependency is involved; if the socket cannot be opened, the panel falls back to
  the previous SSE plus polling path.
- The server now binds to `::` instead of `0.0.0.0` when no `HOST` is given, so a
  single dual-stack socket answers both IPv6 and IPv4. Browsers resolve
  `localhost` to `::1` first and, unlike ordinary requests, a WebSocket handshake
  does not fall back to IPv4 — which made the dev panel's live channel fail on an
  IPv4-only socket. Where IPv6 is unavailable the bind falls back to `0.0.0.0`.
- Prewarming no longer holds up the rest of the dev server. In development it now
  runs with a single worker and a default limit of 4 requests per second
  (`prewarm.rps` / `PREWARM_RPS` still override it), so page requests and the dev
  panel stay responsive while a warm-up round is going on. Production behaviour
  is unchanged.
- `notFound()` is no longer served as a 404 when a transient upstream failure
  (`429`, `5xx`, network error) happened during the same render. The page is
  retried first and, if upstream is still failing, responds with an uncached
  `503` and `Retry-After`. A temporary rate limit is no longer frozen into "this
  page does not exist" for the whole TTL. A retry that gets a clean answer saying
  the page is gone still returns a normal 404.
- Responses produced with missing data are no longer offered to shared caches:
  a `degraded` render is sent with `private, no-store` instead of
  `public, s-maxage=…`. The `X-JSkelet-Cache` diagnostic header is still written.
- The prewarm summary distinguishes paths left for the next pass
  (`700 deferred to the next pass`) from paths dropped entirely
  (`700 over the limit`).
- The changelog page of the marketing example is generated from the project's
  `CHANGELOG.md` instead of a hand-written list, and shows the version published
  on npm next to the installed one.
- The marketing example reads its markdown (documentation and changelog) from
  the repository over GitHub's raw endpoint, falling back to the installed
  package when the network is unavailable, so a deployment that ships without
  `node_modules` can still serve the docs. In development the local file wins
  and nothing is cached. The branch is overridable with `DOCS_REF`.

### Fixed

- The dev panel's WebSocket handshake was answered with a `Sec-WebSocket-Accept`
  value derived from a mistyped protocol constant. Browsers verify that value and
  closed the connection immediately with "Incorrect 'Sec-WebSocket-Accept' header
  value", so the panel silently fell back to polling.

### Breaking

- A request that carries a query parameter is now dynamic by default: it is not
  written to the HTML cache and the response is sent with `private, no-store`,
  even when a `cache().html` pattern covers the path. Every query variant used
  to become its own cache entry, which let campaign parameters
  (`?utm_source=…`) mint unbounded keys and evict real pages from a 500-entry
  store. Pages whose output genuinely depends on the query keep their cache by
  listing the relevant parameters under `cache().query`.

## [0.1.2] - 2026-08-30

### Added

- `route(fn, { private: true })` for pages that depend on the visitor. The HTML
  cache is bypassed, `cache.html` patterns can no longer turn caching on for
  that route, and the response is sent with `private, no-store`, `Vary: Cookie`
  and no ETag.
- A runtime guard against identity leaks: when a cacheable route reads
  `Cookie`, `Authorization` or a session field, the rendered HTML is never
  stored. In development the request fails with an explanation, in production it
  is served with `no-store` and logged.
- `fragment()` for layout-less partial responses, with `no-store` and cache
  bypass built in.
- CSRF protection. Cross-site state-changing requests are rejected based on
  `Origin` and `Sec-Fetch-Site`; requests carrying neither header still pass, so
  webhooks keep working. An optional double-submit token layer is enabled with
  `security.csrf.token` and rendered into forms by the new `csrfField()` helper.
- Signed cookie helpers under `jskelet/cookies`: `parseCookies()`,
  `setCookie()`, `clearCookie()`, `setSignedCookie()`, `getSignedCookie()`,
  `randomToken()` and `safeEqual()`. Defaults are `HttpOnly`, `SameSite=Lax` and
  `Secure` outside development.
- A `security` configuration section: `trustProxy`, `cookieSecret` and `csrf`.
- `seeOther()` for the post/redirect/get flow, which needs 303 rather than the
  method-preserving 307 that `redirect()` sends.
- Island cleanup. A `mount()` function may return a teardown callback; it is now
  stored and called by the new `unmount(root)` export when the subtree leaves
  the DOM.
- Client helpers for partial updates: `swap()` and `startSwapLinks()` for
  fetching and replacing a region, `enhanceForm()` and `startForms()` for
  submitting forms without a full page load while keeping the no-JavaScript
  path working.
- A fourth example, `examples/dashboard`: sign-in with a signed cookie session,
  a private page, a paginated table fragment, a CSRF-protected mutation and an
  island with cleanup, covered by its own `smoke.mjs`.
- An npm version badge in the `README`, linking to the package page.
- An English edition of the documentation under `docs/en/`, mirroring every
  chapter of the Turkish `docs/`.
- The dev overlay now compares the installed version against the `latest` tag on
  npm: the Server tab shows the version, marks an `update` chip when a newer
  release exists and offers the upgrade command. The lookup is cached for six
  hours, never blocks the server and can be turned off with
  `JSKELET_VERSION_CHECK=0`.

### Changed

- `trust proxy` is now configurable through `security.trustProxy` instead of
  being always on. The default is unchanged, but a server exposed directly to
  the internet should turn it off: while it is on, a client can forge its own
  `X-Forwarded-For` and rate limiting or audit logs see the wrong address.
- Every message the framework prints is now English: config, router, render,
  cache, prewarm, asset and build warnings, CLI output, the project `jskelet
init` scaffolds, and the devtools overlay and report interfaces. Visitor-facing
  status pages still follow `brand.lang` and keep their Turkish translations.
- The dev overlay and report now show the current JSkelet logo, served with a
  cacheable response instead of being re-fetched on every navigation.

### Fixed

- A page rendered without `revalidate` used to be sent with no `Cache-Control`
  at all, while still carrying a strong ETag. HTTP treats such a response as
  heuristically cacheable, so an intermediate proxy or the browser's back button
  could store a response meant for a single visitor. Dynamic pages now send
  `private, no-store` and no ETag.
- A redirect thrown from a route that reads the session is no longer cacheable
  either; a stored "you need to sign in" redirect used to follow the visitor
  even after signing in.

## [0.1.1] - 2026-08-30

### Added

- English `README`, plus `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  a `LICENSE` file, issue and pull request templates, and a CI workflow.
- An English-first `examples/marketing` with a Turkish translation, serving the
  package documentation under `/docs` and reading its version, dependencies and
  bundle sizes from the installed package.

### Changed

- The install instructions point at the npm package instead of the git
  repository.

### Fixed

- No more white flash between pages: the page background moved onto the root
  element, so it applies before the body paints. Reduced-motion preferences now
  switch off the decorative animations as well, not just page transitions.

## [0.1.0] - 2026-08-30

Initial release.

### Added

- Express 5 server with EJS rendering: `createApp()`, `startServer()`,
  `route()`, `renderPage()`, `renderView()`, `renderNotFound()`.
- In-process HTML TTL cache with stale-while-revalidate, plus prewarm at boot.
- Island runtime with visibility, eager and idle hydration strategies, a small
  cross-island store, and DOM helpers.
- Configuration through `jskelet.config.mjs`: `brand`, `paths`, `navigation`,
  `icons`, `fonts`, `clientEnv`, `redirects()`, `rewrites()`, `headers()`,
  `cache()` and `hooks`.
- Build pipeline: fonts, SVG sprite from used icons, Tailwind v4 CSS, esbuild
  bundles with code splitting, webp variants, hashed output and brotli/gzip
  precompression.
- Dev server with watch build, CSS hot-swap, automatic restart and a devtools
  overlay (requests, errors, upstream calls, cache dump, Web Vitals).
- CLI: `jskelet dev`, `jskelet build`, `jskelet start`, `jskelet init`.
- Documentation under `docs/` and three examples: `minimal`, `blog`,
  `marketing`.

[Unreleased]: https://github.com/ayberkenis/jskelet/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/ayberkenis/jskelet/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ayberkenis/jskelet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ayberkenis/jskelet/releases/tag/v0.1.0
