# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
While the project is on `0.x`, minor releases may contain breaking changes; each
one is listed under a **Breaking** heading.

## [Unreleased]

### Added

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
- `cache().maxEntries` configures the HTML cache limit, which used to be a fixed
  500.
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
