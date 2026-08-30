# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
While the project is on `0.x`, minor releases may contain breaking changes; each
one is listed under a **Breaking** heading.

## [Unreleased]

### Added

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
- The dev report now includes the data cache entry count under `cache.data`.

### Changed

- `notFound()` is no longer served as a 404 when a transient upstream failure
  (`429`, `5xx`, network error) was reported during the same render. Those pages
  now respond with an uncached `503` and `Retry-After`, so a temporary rate limit
  is not frozen into "this page does not exist" for the whole TTL.
- Responses produced with missing data are no longer offered to shared caches:
  a `degraded` render is sent with `private, no-store` instead of
  `public, s-maxage=…`. The `X-JSkelet-Cache` diagnostic header is still written.
- The prewarm summary distinguishes paths left for the next pass
  (`700 deferred to the next pass`) from paths dropped entirely
  (`700 over the limit`).
- The changelog page of the marketing example is generated from the installed
  package's `CHANGELOG.md` instead of a hand-written list, and shows the version
  published on npm next to the installed one.

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
