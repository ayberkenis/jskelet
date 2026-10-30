# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
While the project is on `0.x`, minor releases may contain breaking changes; each
one is listed under a **Breaking** heading.

## [Unreleased]

### Added

- `data-island-on="focusin, click"` defers an island's download until the
  first matching event on the host. It wins over eager, idle, visibility and
  the hidden-host path, so a header search field can sit above the fold
  without pulling its module until the user focuses it. Empty or invalid
  event lists warn and do not mount.

### Changed

- Cacheable HTML pages carry a weak `ETag` on every encoding and answer a
  matching `If-None-Match` with `304 Not Modified`. Previously the validator
  was only written for uncompressed responses, so browsers that accept brotli
  downloaded the full page on every navigation. The value is computed once
  per cache entry. Private pages and fragments still send no ETag.
- A cache MISS no longer waits for the stored brotli body (quality 5) or for
  the write to Redis/disk. Both happen in the background; the response that
  rendered the page compresses its own body at quality 4. This takes
  0.7–2 ms off the MISS TTFB.
- `express.static` only runs for paths that exist as files under `public/`.
  It used to build a 404 error with a stack trace for every page request
  before handing it on. Together with the access log changes below, a cached
  page in the blog example went from about 1,850 to about 10,200 requests per
  second under load.
- Access log lines are written to stdout once per event-loop turn instead of
  once per request, and the timestamp is no longer formatted through `Intl`
  on every line. Under load the two cost about 45% of the CPU of a cache HIT.
- `Accept-Encoding` negotiation results are remembered per header value, and
  `onVisit` prewarm extracts links from a cached page once instead of on
  every visit.

- Responses that are compressed on every request (dynamic, `private` and
  `fragment` HTML, plus anything the compression middleware handles) use
  brotli quality 4 instead of 5. Cached HTML is still stored at quality 5,
  because it is compressed once. On 7–35 KB pages, quality 4 is 3–4× cheaper
  in CPU and about 6% larger. In the blog example, dynamic pages served about
  20–25% more requests per second.
- The in-process HTML cache keeps one brotli body and one gzip body per
  entry. Previously it kept a single compressed body, so mixed brotli and gzip
  clients made a cached page recompress on almost every hit. Both bodies count
  toward the existing 256 MB budget.
- Elements with bound (`:attr`) attributes compile their static attributes
  into the surrounding HTML at build time. Only bound values are checked at
  render time. Output is byte-for-byte identical. The framework's default
  `layout.render.js` was regenerated.
- `renderHeadMeta()` builds tags by direct concatenation and caches resolved
  canonical URLs. On a simple page, the time `renderPage` spends outside the
  view dropped by about 40%.
- `isHtmlCacheFresh()` (used by `onVisit` prewarm on every public response)
  uses a path index instead of scanning the whole HTML cache for each link.

- Page stylesheets are built as one asset containing global CSS followed by
  page CSS. Routes that declare `styles` load the combined asset instead of
  applying `app.css` and page utilities in separate cascade steps, preventing
  the intermediate layout shifts that occur when those sheets arrive apart.
- Redis HTML is stored as a small JSON meta key, a raw brotli `:body` key, and
  optional `:enc:br` / `:enc:gzip` keys on a second connection. HTML command
  timeouts use their own circuit breaker and no longer bypass the data cache.
- `.jsk` codegen merges adjacent static HTML into fewer `+=` ops and drops
  template indentation (newline-only whitespace). A lone space between
  inline siblings is kept; `pre` / `textarea` / `script` / `style` / `code`
  preserve whitespace. Framework default `layout.render.js` regenerated.
- `.jsk` page layout no longer copies the full helpers object into `data`
  each render (EJS layouts still receive helpers as locals).
- `esc()` skips the regex replace when the string has no special characters;
  `attrs()` builds the attribute string without an intermediate array.
- Compiled templates and JS components load with parallel `import` on first
  render; production skips the `.jsk` mtime scan when a template manifest
  already exists.
- `icon()` caches the sprite URL in production; `Image` `fill` without an
  extra `class` skips `twMerge`; `optimizedImage()` materializes CDN-prefixed
  variant URLs once at load time.
- `scripts/measure-ssr.mjs` microbench for fixture `renderView` /
  `renderPage` and live cache MISS/HIT timings against a running app.
- HTML cache awaits brotli on write so the MISS response can reuse it;
  `rememberHtmlEncoding` updates the byte budget by delta instead of
  rescanning the store. Short negative cache skips empty L2 (Redis/disk)
  lookups after a miss.
- Data cache early-refreshes near TTL (same lead formula as HTML) and skips
  repeated empty L2 reads the same way; `produceMs` is stored on entries.
- Image optimizer coalesces concurrent work for the same `url+w+q` and caches
  DNS safety checks for 60s.
- Disk/Redis L2 decode uses async brotli (no sync decompress on the event
  loop). `cache()` skips `JSON.stringify` for a single primitive argument.
- `preconnectHints()` adds `build.assets.prefix` origin automatically. Build
  runs Fonts and Icon sprite in parallel; precompress writes `.br`/`.gz` in
  parallel per file.
- Cold SSR without prewarm: `warmRenderEngine()` runs before listen; page
  `.jsk` templates load lazily (layout + `components/*` stay eager); production
  `ensureTemplatesCompiled` returns on manifest without walking sources.
- L2 read races a 50ms budget then produces locally; Redis `storeEncoded`
  defaults to on.
- `renderPage` runs the body with `page.metadata` in parallel with the
  `metadata` hook + `layoutContext` chain.
- `sendHtml` always negotiates brotli/gzip for HTML (including
  `fragment` / `private`), instead of relying on compression middleware.
- Transient upstream `notFound()` defaults to an immediate 503 with
  background retry (`cache().transientRetry.background`; set `false` for the
  old sync loop). `warmRenderEngine` / `resetRenderEngine` are exported.

### Breaking

- Redis `storeEncoded` defaults to `true` (was `false`). Opt out with
  `cache().redis.storeEncoded: false` if L2 size must stay minimal.
- Transient retry no longer delays the visitor by default
  (`background: true`). Set `cache().transientRetry.background: false` to
  wait for sync retries before responding.

### Fixed

- In `jskelet dev` (and `jskelet build --watch`), changing `build.client`
  (`splitting`, `groups`, `chunkGroup`, `hoistShared`), `clientEnv` or the
  client directory in `jskelet.config.mjs` now rebuilds the client bundle with
  the new settings. Before, only the server restarted and the esbuild watch
  context kept the old config until the dev server was restarted by hand. A
  config that fails to load keeps the previous settings. `loadConfig({ force:
  true })` also re-imports the file now; it used to get the cached module
  back from Node.
- The blog example's `search`, `tabs` and `contact-form` islands passed
  arguments to `qs()` / `qsa()` in the wrong order (`selector, root` instead of
  `root, selector`), so they failed to mount.
- `clearHtmlCache()`, `invalidateHtmlCache()` and `dropHtmlCacheKey()` also
  forget renders that are still running. Before, a request that arrived right
  after a purge joined the in-flight render and received HTML produced from
  the data that had just been invalidated.
- A purge that lands while a page is being written to the `.jskelet/cache/`
  disk tier no longer lets that write put the purged HTML back. The same holds
  for a background share that finishes after a soft invalidation.

- Without Redis, every HTML cache hit rewrote the page to the
  `.jskelet/cache/` disk tier. `storeEncoded` defaults to on, but only the
  Redis path updated the "already shared" counter. Hits no longer write. In the
  blog example, cache-hit throughput rose from about 1,100 to 2,900 requests
  per second and median latency fell from 27 ms to 9 ms.
- Concurrent disk-cache writes for the same key no longer share a temp file
  name. On Windows, they failed with `EPERM` / `ENOENT` and logged
  `[disk-cache] write failed`. Writes to one file are now serialized, and the
  newest value is written last.
- Shared HTML cache keys (Redis and the `.jskelet/cache/` disk tier) now
  change when the layout or other view sources change, not only when CSS/JS
  assets do. `buildId` is `{assets}-{templates}`, where `templates` is a
  fingerprint of `.jsk` / `.ejs` / component files under the view roots, the
  layout file, and the framework version. Previously a layout-only change kept
  serving the old `<head>` from Redis until the TTL expired, even after a
  restart or deploy.
- `hydrate()` mounts zero-box hosts (`hidden` / no layout box) through
  `mountWhenReady()` instead of calling `mountIsland()` immediately, so
  `data-island-idle` on a hidden host still waits for `load` plus idle time.
  `data-island-eager` is unchanged (mounts right away).
- S3 PutObject uses path-style URLs for bucket names that contain dots
  (e.g. `static.investvio.dev`). Virtual-hosted
  `bucket.s3.region.amazonaws.com` fails TLS because the cert only covers
  `*.s3.region.amazonaws.com` (one label). Fetch errors are also shortened.

### Added

- `build.client.hoistShared` folds modules shared between islands into the
  shell entry (`main.js`), instead of letting esbuild emit one small chunk per
  `main` + island combination. Everything the shell imports statically, and
  every module reached by at least `minImporters` islands or entries, goes
  into the shell. Islands then contain only their own code. `exclude`
  (bare packages or path prefixes, like `groups`) and group members stay in
  their own files. `exclude` only keeps the matched module out: the shared
  application helpers it uses (for example `dates.js`) can still go into the
  shell, and the excluded module reaches them through a proxy, so
  page-specific code can be excluded without leaving small shared chunks.
  `node_modules` files reached only through an excluded vendor stay with it. Only the names islands actually import are kept, so the
  shell stays tree-shaken. In the blog example, every page now loads `main.js`
  plus its own islands. Before, it also loaded a 3.8 KB shared chunk.
  An `import("…")` of a module that is already in the shell emits no file;
  it resolves to the shell's copy through `Promise.resolve()`. Before, each
  such call left a small entry file of its own (a few hundred bytes up to a
  couple of KB), so lazy imports can now be written without checking where
  the module ended up. Variable or template specifiers still go through a
  small proxy file.
  esbuild's shared runtime chunk (interop helpers and the `process.env`
  define) is folded into the shell too. Every chunk the shell imports
  statically now ends up inside it, and other files read those values
  from the shell instead of importing the chunk. The critical path is now
  `main.js` alone, without the extra ~1 KB request on every page. Source
  maps still point to the original files. Rewritten files are rehashed
  from their new contents, so a cached island cannot keep serving the old
  file and its 1 KB chunk request. If folding fails, the build warns and
  keeps esbuild's output.
- `start({ rootMargin })` sets how far ahead the visibility observer starts
  loading an island (`IntersectionObserver` syntax, default `"200px 0px"`).
  `"100% 0px"` starts one screen early. An invalid value warns and falls
  back to the default.
- `earlyHints` config option: sends `103 Early Hints` with the `preconnect`
  origins and selected build assets (`main.js` by default) while a page is
  rendering. It is skipped when the page comes from the HTML cache. Off by
  default; see `docs/07`.

- `formatDate(value, locale, options)` in `jskelet/html`: the same output as
  `new Date(value).toLocaleDateString(locale, options)`, with a cached
  `Intl.DateTimeFormat`. `toLocaleDateString` builds a new formatter on every
  call (about 65 µs); the cached version takes about 1.5 µs. In the blog
  example, post cards spent most of their render time formatting dates. Invalid
  and missing dates return an empty string.
- `cache().redis.htmlCommandTimeoutMs` (default `2000`) limits only the HTML
  Redis connection. `commandTimeoutMs` stays `200` for data, publish, and scan.
  The admin Redis card shows both timeouts.
- `stylesheets({ blocking: false })` and `<Stylesheets :blocking="false" />`
  emit each stylesheet with `media="print"` and an `onload` that switches it
  to `all`, plus a `<noscript>` fallback, so the links do not block rendering.
  The default stays render-blocking.
- `stylesheets({ blocking: "(min-width: 1024px)" })` and
  `<Stylesheets blocking="(min-width: 1024px)" />` make stylesheets
  render-blocking only where the media query matches. On other screens they
  load without blocking and apply once loaded, with the same `<noscript>`
  fallback as `blocking: false`.
- `modulePreload("client/bundles/chrome.js")` and
  `<ModulePreload src="client/bundles/chrome.js" />` emit
  `<link rel="modulepreload">` tags for a client module's hashed chunk and its
  static imports, so critical island bundles start downloading with the HTML
  instead of waiting for `main.js` and its `import()`. URLs follow
  `build.assets.prefix`, shared chunks are emitted once per request, and
  dynamic imports stay lazy. The client build writes the source-to-chunk map
  to `.jskelet/preload.json`; without a build the helper emits nothing.
- Dev tools **Server** tab can clear the HTML cache for the open page, every
  HTML entry, or the data cache. Live stats include HTML/data entry counts;
  new endpoints under `devBasePath`: `POST /cache/clear-html`,
  `/cache/clear-data`, and `/cache/invalidate`.
- On-demand HTML cache via `cache().prewarm: false`: visited pages still
  write to L1 and Redis/disk L2 with the usual `html` TTLs, but classic
  prewarm, `onVisit` link warming, and early-expiry HTTP refresh stay off
  (`PREWARM=1` does not override). Mutually exclusive with
  `hooks.prewarmPaths`. Resolved `prewarm.mode` is `"off"` | `"classic"` |
  `"onVisit"`.
- When `build.assets.prefix` is set, the CSS build rewrites root-absolute
  `url()` paths under `static.prefixes` (e.g. `/fonts/…`) to the CDN
  prefix so they match the S3 key (`…/js/fonts/…`). Default upload
  `include` is `["assets", "fonts"]`; prefix also forces `fonts` into
  `include`. Font uploads run PutBucketCors with
  `upload.corsOrigin` (default `"*"`, set `null` to skip).
- `asset(name, { origin: "document" })` skips `build.assets.prefix` and
  returns the site-origin `/assets/…` path. `icon()` always resolves the
  sprite this way so SVG `<use href>` keeps working when other assets are
  on a CDN (the origin still serves `public/assets/`).
- Dev overlay **API** tab (between Performance and Server): outbound
  `fetch` calls for the current page — browser and SSR — with host
  rollup, duration, status, and a detail pane on click (component,
  URL, timing, size, response body when captured). Browser calls are
  attributed to the island/module (mount, stack, or last interaction);
  SSR calls to the first `lib/` / `routes/` / `controllers/` / `views/`
  frame. The live stats channel includes recent server API calls so the
  tab updates without a refresh.
- Optional CDN asset publishing via `build.assets`: `prefix` rewrites
  `asset()` / optimised image URLs (manifest stays relative on disk);
  `upload.bucket` / `keyPrefix` / `region` / `endpoint` come from config only.
  Production `jskelet build` PutObjects `public/assets/` (and optional
  `include` dirs) after precompress. Only credentials are read from env
  (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`, then
  `JSKELET_S3_*`, then ECS task-role / EC2 instance-profile metadata). The
  Assets upload step always appears on production builds; when off it logs a
  one-line reason (`skipped (no build.assets.upload.bucket)`,
  `skipped (credentials missing (no env keys, no ECS task role …))`, …).
  Docker/`RUN jskelet build` has no task role — upload needs CI role or a
  runtime upload. A URL in `upload.bucket` is rejected with a warning (CDN
  origin belongs in `prefix`). Watch mode never uploads. `.br` / `.gz`
  siblings are skipped.

### Changed

- Shared cache entries of 1 KB or more are stored as brotli (`JSK\x01`
  prefix) instead of plain JSON. With Redis off, the same body is written
  under `.jskelet/cache/<buildId>/` so a restart can skip the render. The
  in-process cache is unchanged, smaller records stay JSON, and existing
  plain JSON values are still read.
- Early HTML refresh no longer marks every due page in one second. A pass
  soft-stales at most four entries (soonest expiry first), and the expiry
  warmer refetches them at one request at a time, two per second, instead of
  the classic prewarm rate.
- The data cache stops growing past 64 MB of stored JSON. A single value
  larger than that is not stored; the caller still receives it. HTML cache
  entries keep the raw body plus only the compressed encoding last requested.
- In production, precompressed asset `stat` results (hit or miss) stay in
  memory for the process lifetime. The remote image disk cache drops the
  oldest file once `.jskelet/image-cache/` passes 256 MB.

### Added

- `build.client` configures esbuild code splitting and chunk groups:
  `splitting`, declarative `groups` (bare package / path / `@/` matchers), and
  a `chunkGroup(id)` hook. Matched modules are co-located into one shared
  chunk (webpack-`manualChunks` trade-off: weaker tree-shaking inside the
  group). The client build step also prints the total JS file count.
- `ogImage({ fonts })` registers each `ttf` or `otf` (`path` and `family`)
  with fontconfig so card and raw-SVG text use the site's own files. A slim
  image still needs the `fontconfig` package. `woff` / `woff2` are not drawn
  by the rasterizer (empty boxes); they are embedded only when the response
  is SVG.
- `robots.txt` responses gain a trailing JSkelet note that disallows framework
  endpoints (`/_jskelet/`, `/__jskelet/`, `/_fragment/`, plus a custom admin,
  image, handoff, or dev path when it sits outside those prefixes). Every
  user-agent already named in the file is repeated in that block, so a
  crawler-specific group still sees the rules.

### Breaking

- HTML edge headers
  Cacheable HTML and OG images no longer send `s-maxage`. `route()` writes
  `Cache-Control: public, max-age=0` and
  `CDN-Cache-Control: max-age=<html ttl>, stale-while-revalidate=<cache().staleWhileRevalidate>`
  (default 60; `0` omits the directive). OG images keep their own durations
  (86400 / 604800) on `CDN-Cache-Control`. A layer that only reads
  `Cache-Control` / `s-maxage` (nginx `proxy_cache`) no longer caches this
  HTML. Cloudflare reads `CDN-Cache-Control`.
- File logs are no longer daily plain-text files. With `logs.file.enabled`,
  lines are sealed as zstd chunks (`jskelet-<time>-<n>.ndjson.zst`) and kept
  for at most 5 minutes; the oldest expired chunk is deleted. `logs.drainLog`
  receives each sealed chunk (`{ body, encoding: "zstd", bytes, lines, at }`)
  so the app can forward it. A throwing hook warns and leaves the site up.
  With the file sink off, `drainLog` still runs and nothing is written to disk.
- Dev gate is opt-in
  `DEV_TOKEN` in the environment no longer locks the site. Require the token
  only with `devGate: true` or `DEV_GATE=1`. `DEV_GATE=0` turns the gate off
  even when config enabled it.
- Cache ceilings
  `cache().maxEntries` above 800, `cache().data.maxEntries` above 20,000, and
  `prewarm.onVisit` above `perPage` 20, `rps` 2, or `concurrency` 2 are clamped
  at load with a warning. `onVisit` `rps: 0` is no longer unlimited. The HTML
  cache also stops growing past 256 MB of stored HTML plus compressed bodies;
  a single page larger than that is not stored.

### Fixed

- Visit warming skips pages that are already fresh when the cache key has a
  vary prefix or a trailing `?`. With `vary.host`, warm requests stay on
  loopback and send the public host as `x-forwarded-host`, so a second
  `127.0.0.1` HTML entry is not created. The onVisit queue holds at most 64
  paths.

### Removed

- `examples/marketing` — the marketing site now lives as a standalone app
  outside this repository (`jskelet-marketing`).

## [0.6.0] - 2026-09-21

### Added

- Port reclaim with `--murder`
  `jskelet dev --murder` and `jskelet start --murder` kill whatever already
  holds the listen port and bind in its place. Without the flag the CLI still
  refuses to start, but now with a clear error (pid + hint) instead of a bare
  `EADDRINUSE`.
- Layout built-ins for `.jsk`
  `<Stylesheets />`, `<BodyScripts />`, and `<JsonLd />` emit the asset /
  script / JSON-LD loops from layout without calling helpers in the expression
  language.
- Framework default layout as `.jsk`
  Ships as `src/templates/layout.jsk` with a checked-in `layout.render.js`
  (`node scripts/compile-framework-layout.mjs`, `--check` for drift).
  `jskelet/layout` points at the `.jsk` source; the legacy EJS copy remains at
  `jskelet/layout/ejs`.
- JSK editor tooling
  The VS Code / Cursor JSK extension (v0.2.0) reports diagnostics in Problems
  on open/save and offers PascalCase component completions from
  `views/components`.
- `<!DOCTYPE>` parsing in `.jsk`
  Doctype and other `<!…>` declarations parse correctly instead of hanging the
  template compiler.
- `jskelet migrate` for Next.js App Router
  Codemod with `scan` inventory, `apply` (JSX pages → controller + `.jsk`,
  presentational components → HTML string helpers, `"use client"` → island
  stubs), and `config` draft from `next.config`. Ships with `@babel/parser` /
  `@babel/types`.
- Published TypeScript declarations
  `.d.ts` files under `types/` for `jskelet`, `jskelet/client`, `jskelet/html`,
  `jskelet/tags`, `jskelet/cookies`, and `jskelet/log` (`npm run types`).
- TypeScript client entries and islands
  The client build accepts `.ts` / `.mts` entries and islands via esbuild;
  manifest keys stay `*.js`. Conflicting stems (`main.js` + `main.ts`) fail the
  build. Icon usage scan includes `.ts` / `.mts`.
- Local `icons/` sprite source
  When a flat `icons/` directory is present (`icons.dir`, default `"icons"`),
  it is the exclusive SVG sprite source (`house.svg` / `house-bold.svg`).
  Phosphor is used only when that directory is absent. The hashed sprite still
  lands under `public/assets/` and is precompressed.
- Auth handoff hardening
  `allowedCookieNames` allowlist, pending-ticket and per-IP mint limits, plus
  RFC 6265 cookie-name validation on `serializeCookie` (`isValidCookieName`).

### Fixed

- Clearer `jskelet dev` startup failures
  The CLI prints the real server failure (for example port already in use /
  `--murder` hint) instead of only `server exited (code 1)` when the child
  dies during startup.
- Marketing trust-bar icons after `.jsk` migration
  `icons.scan` now covers `routes/`, so names declared in controllers
  (`Package`, `TextT`, `ShieldCheck`, …) land in the sprite again.
- Open Graph routes with a `.png` suffix
  Paths like `/og/…/:slug.png` escape the dot for Express 5 / path-to-regexp,
  so the handler matches instead of falling through to the HTML 404.
- Safer remote image optimizer redirects
  Redirects are no longer followed blindly; each hop is re-checked against
  `allowHosts`, blocked private addresses, and DNS resolution (open-redirect
  SSRF).

### Breaking

- `ejs` is an optional peer
  Apps that only use `.jsk` need not install it; apps that still have `.ejs`
  views or layouts must `npm i ejs`. Missing EJS when an `.ejs` file is
  rendered throws a clear install/migrate hint.
- Default layout export is `.jsk`
  `jskelet/layout` now resolves to `layout.jsk` (was `layout.ejs`). Use
  `jskelet/layout/ejs` for the legacy file.
- Auth handoff requires cookie allowlist
  `auth.crossSubdomainHandoff` mint needs a non-empty `allowedCookieNames`
  list; `true` alone no longer accepts arbitrary cookie names.
- Production builds omit client sourcemaps
  Development still emits them; production client bundles do not.
- Secret-like `clientEnv` keys fail the build
  Names that look like secrets are rejected instead of being inlined into the
  client bundle.

### Changed

- Marketing changelog as release notes
  `/changelog` hides Unreleased, lists every published release without
  pagination, and shows each note as a titled card with a short headline plus
  a longer explanation (Keep-a-Changelog sections: Added / Changed / Fixed /
  …).
- Examples are `.jsk` only
  `minimal`, `blog`, `dashboard`, and `marketing` use `.jsk` for layouts,
  pages, and partials; EJS files were removed from those trees.
- Stricter, clearer template compiler
  Unknown PascalCase components fail the build. Errors for forbidden function
  calls, unknown includes (with location), and unclosed `{#if}` / `{#each}` at
  EOF are clearer; icon scan recognizes `<Icon name="…" />`.
- Docs present `.jsk` as the default
  Docs / AGENTS / README tell the build-time `.jsk` story first; EJS is
  documented as an optional legacy peer.
- Standalone JSK VSIX packaging
  The VS Code / Cursor extension (`extensions/vscode-jsk`) uses the new 3D
  `.jsk` mark as marketplace and explorer icon, and packages as a standalone
  VSIX (vendors `src/compile`) for Marketplace publish.
- Migrate peers are optional
  `@babel/parser` and `@babel/types` are optional peers used only by migrate.
  They are no longer installed with every `jskelet` install; missing peers
  throw an install hint. Unused `@babel/traverse` was dropped.
- Auth handoff sits after CSRF
  Mint mounts after CSRF so origin checks apply to
  `POST /_jskelet/auth/handoff`.
- Stronger security docs
  Docs (TR/EN) expand `trustProxy` / `csrf.token` guidance and include a
  fuller security-headers example under `headers()`.
- Marketing copy defaults to `.jsk`
  EN/TR marketing and how-it-works examples present `.jsk` as the default
  template surface; the compare column for hand-written Express + EJS stays as
  a competitor. Scaffold and migrate mappings name `.jsk` pages and layouts.
- New geometric brand mark
  Framework and marketing logos live at `src/logo.png` (admin / devtools) and
  `examples/marketing/public/logo.png`. Marketing serves local favicons via
  metadata `extraTags`.
- Development 5xx diagnostics
  In `NODE_ENV=development`, 5xx responses show the error message and stack
  instead of the polished 500 page / `hooks.error()`. Production still returns
  the minimal status page with no internals.
- Marketing fit copy for signed-in panels
  EN/TR fit copy treats dashboards and per-visitor panels as a supported path
  (`private: true`, fragments). The poor-fit column names SPA shells,
  collaborative client trees, streaming/RSC, and built-in real-time transport.
- Marketing copy for 0.5.x surfaces
  EN/TR copy reflects host `vary`, early refresh, classic vs `onVisit`
  prewarm, local `icons/`, shared cookies, and `opengraph-image` → `ogHandler`
  on the migrate table. Pages serve per-locale OG cards at
  `/og/:locale/:page.png`.
- Marketing visual language
  Dark cyan glass look with shared `glass-panel` surfaces, numbered lit feature
  cards, a 3D stack illustration on the home hero, and rotating cyan border
  beams on lit panels.

## [0.5.4] - 2026-09-18

### Added

- Shared cross-subdomain cookies: `brand.sharedCookieRoots` plus `writeSharedCookie` / `clearSharedCookie` on server (`jskelet/cookies`) and client (`jskelet/client`). `Secure` follows https / `x-forwarded-proto` (not `NODE_ENV`); the client read-back fails into handoff when the browser rejects `Domain`. Optional `auth.crossSubdomainHandoff` mounts `POST /_jskelet/auth/handoff` (one-time ticket → `?handoff=`) and documents a `window.name` bridge. Large tokens are refused — put a short session id in the cookie, not a JWT.

## [0.5.3] - 2026-09-18

### Added

- HTML cache key vary (`cache().vary`): `host: true` adds the public Host (`x-forwarded-host` or `Host`, lowercase, no port) as `h=…|` before the path; optional `headers` and `fn(req)` add further segments. Required on host-based locale sites so one locale's HTML is not served on another. Classic prewarm accepts `prewarm.origins` for multi-host warming when vary is on.

### Changed

- Marketing example visual language: darker ink canvas, solid cyan primary CTAs, cyan-only glow/grid (indigo accents removed), and a measured trust bar on the homepage (payload gzip, Node, license, zero web fonts) instead of the marquee.

## [0.5.2] - 2026-09-18

### Added

- Dynamic Open Graph images (Next.js `ImageResponse` / `opengraph-image`): `ogImage`, `sendOgImage`, `ogHandler`, and `ImageResponse` turn card fields or raw SVG into PNG when `sharp` is installed (SVG fallback otherwise). Wired in `examples/blog` as `/og/blog/:slug.png` and `metadata.openGraph.image`.

## [0.5.1] - 2026-09-07

### Added

- Early HTML cache refresh before TTL expiry: the last successful produce time (`produceMs`) sets a lead window (`min(max(produceMs×2, 250ms), ttl/2)`). A still-fresh `HIT` in that window revalidates in the background; idle entries are soft-staled by a sweeper and drained over HTTP even without classic `prewarmPaths` (`PREWARM=0` disables both). In-flight refreshes no longer drop the entry when `staleUntil` elapses.

## [0.5.0] - 2026-09-03

### Added

- Route-level stylesheets: put files in `styles/pages/*.css` and load them from the controller with `styles: ["home.css"]` (same contract as island `entries`). The layout emits them after global `app.css`; dev hot-swaps any changed `.css` manifest key without a full reload.

## [0.4.8] - 2026-09-03

### Added

- Dev overlay Errors tab now lists failed SSR and browser `fetch` calls with page path, API URL, optional island name, and expandable response-body details (JSON instead of `[object Object]`). Server `console.error` / `console.warn` records also carry the current page when they fire during render.

## [0.4.7] - 2026-09-03

### Added

- Visit-driven HTML prewarm (`cache().prewarm.onVisit`): after each public cacheable page response, same-origin links in the HTML are warmed in the background (document order, `perPage` cap). Mutually exclusive with classic prewarm (`max` / `priority` / `rotate` / `hooks.prewarmPaths`, etc.) — mixing them fails at config load.

## [0.4.6] - 2026-09-03

### Fixed

- Remote image optimizer cache hits no longer 404. Disk cache lives under `.jskelet/image-cache/`; Express `sendFile` ignores dotfiles by default, so the file was written but the response still failed. `sendCached` now passes `dotfiles: "allow"`.

## [0.4.5] - 2026-09-03

### Added

- Runtime remote image optimizer: set `images.remote.allowHosts` to proxy allowlisted http(s) images through `/_jskelet/image?url=&w=&q=` as resized webp (disk cache under `.jskelet/image-cache/`). `image()` rewrites matching remote `src` values automatically; `remoteImageUrl()` builds URLs by hand. Requires `sharp` at runtime; without it the endpoint 302-redirects to the source.

## [0.4.4] - 2026-09-02

### Added

- Devtools SEO check: an **SEO** tab in the overlay lists document, heading, image, link and social-tag issues with error/warning severity. Optional page highlights draw red or yellow boxes around the offending elements; the label shows the short title and a click opens the full explanation. Served only in development as `/__jskelet/dev/seo.js` beside the overlay.

### Changed

- Marketing compare live latency demo now measures two same-sized fragments (cached vs `no-store`) with an explicit 80 ms simulated upstream inside the shared producer — a hit skips that wait so the gap is visible even when RTT dominates the wall clock. The island prints transferred bytes, Server-Timing `produce` duration, and a View Source section contrasts `__NEXT_DATA__` payload tax with plain JSkelet HTML. The measured-weight block also shows an estimated Next.js App Router first-load breakdown beside this site’s real gzip totals (clearly labelled estimate, not a build from this repo).

### Fixed

- Missing `/assets/*` responses no longer keep the long-lived `immutable` Cache-Control that `headersMiddleware` stamps for static prefixes. A deploy race (prune-before-write) could 404 a hashed CSS URL for a moment; a CDN then cached that HTML 404 for a year and browsers refused it as a stylesheet (`MIME type 'text/html'`). Catch-all and `notFound` handlers now set `Cache-Control: no-store`. CSS and sprite builds write the new file before pruning older hashes so the same content hash never has a gap.

## [0.4.3] - 2026-09-02

### Added

- Marketing homepage ops storyboard: Redis L2, `/_jskelet/admin` panel mock and Cloudflare purge flow, with tabbed visual scenes animated by the vanilla `motion` API (Framer Motion’s non-React package) via an `ops-story` island.

## [0.4.2] - 2026-09-02

### Changed

- README rewritten for the current surface: build-time `.jsk` as the default template story (EJS still supported), feature-first `init` examples, `mount` island contract, path-based `invalidateHtmlCache` (replacing the outdated “no targeted invalidation” claim), Redis / admin / data-cache callouts, and bilingual doc links under `docs/` and `docs/en/`.

## [0.4.1] - 2026-09-02

### Added

- VS Code / Cursor extension skeleton under `extensions/vscode-jsk`: `.jsk` language id, TextMate highlighting (`{{ }}` / `{#if}` / `{#each}` / components), language config, and snippets. Install from that folder or launch **JSK: Extension** from the repo root. Bound attrs on HTML tags (`:src="… + '/path'"`) highlight nested single-quoted strings.
- Compile-time known components are discovered from **named exports** in `views/components/**/*.js` (plus `.jsk` component files), not from the file basename — so `<SectionHead />` resolves when `sectionHead` lives in `ui.js` without a stub re-export. Docs cover the `.jsk` template-vs-component boundary and a `{ items, error }` loader / `LoadErrorState` pattern so upstream failures are not mistaken for empty data.

### Changed

- Duplicate component named exports (or the same PascalCase tag in two files) now **fail** at build and at server startup instead of warning and letting the second definition win. Overwriting `components/index.js` barrel exports remains allowed.
- Marketing compare/FAQ copy no longer claims targeted invalidation is missing; it points at `invalidateHtmlCache()` (and Redis pub/sub for multi-instance).

## [0.4.0] - 2026-09-02

### Added

- Build-time `.jsk` templates: declarative HTML-like syntax compiled to ESM render modules under `.jskelet/templates/` (no request-time parse, `eval`, or `new Function`). Coexists with EJS; compiled `.jsk` wins when both exist. Syntax: `{{ }}` / `{{{ }}}`, `{#if}` / `{#each}` / `{#include}`, PascalCase components (`:prop` bindings), built-ins `Link` / `Image` / `Icon` / `CsrfField` / `PreloadImage`.
- Feature-first conventions: `paths.features` / `paths.shared`, multi-root views and components, `features/<name>/index.js` route registration after `routes/`. CLI: `jskelet generate feature|page|island`. `jskelet init` scaffolds a feature-first `.jsk` skeleton (`features/home/` with route, page, component and island; global `views/pages/not-found.jsk`).
- Template compile step in `jskelet build`; icon scan and Tailwind docs cover `.jsk` / `features` / `shared`. Bench: `node scripts/bench-templates.mjs`.

### Changed

- `examples/minimal` pages moved to `.jsk`; adds `features/demo` as a co-located route + view sample.

## [0.3.5] - 2026-09-02

### Changed

- S3 logging configuration refactored; docs clarified.

## [0.3.4] - 2026-09-02

### Changed

- S3 logging pipeline now prints connection details at boot.

## [0.3.3] - 2026-09-02

### Changed

- Internal packaging / release bump.

## [0.3.2] - 2026-09-02

### Added

- Top-level `logs` config for persistent sinks: daily NDJSON files (`logs.file`) and batched S3 PutObject (`logs.s3`) with embedded SigV4 — no `@aws-sdk` dependency. `kinds` selects `http` / `event` / `error`; `console` toggles runtime stdout lines. `JSKELET_LOG_BUCKET` (and `logs.s3.bucket`) may be a plain bucket or a `bucket/prefix/…` path. `JSKELET_S3_API_URL` sets the R2/MinIO endpoint (region defaults to `auto`). Missing credentials warn and disable the S3 sink without taking the site down. Env: `JSKELET_LOG_BUCKET`, `JSKELET_S3_ACCESS_KEY_ID`, `JSKELET_S3_SECRET_ACCESS_KEY`, `JSKELET_S3_SESSION_TOKEN`, `JSKELET_S3_REGION`, `JSKELET_S3_API_URL`.

## [0.3.1] - 2026-09-02

### Added

- Admin panel pages under `/_jskelet/admin`: Overview, Cache, Routes, Views, Logs and System. Configurable `allowIps` (exact or CIDR), `blockBots` (default on — crawler UAs get 404 before login), and `logSize`. Live Logs use an in-process ring plus SSE (`/api/logs/stream`) with client-side filters for method, status, cache, kind, path/route and text. Routes and Views are read-only inventories; HTTP finish middleware records timings only while the panel is enabled.
- `trailingSlash` in `jskelet.config.mjs` (default `false`). When `true`, canonical page URLs end with `/` and return 200; a request without the slash is sent to the slashed form with a 308 (not 301). File URLs and `/.well-known/**` are left alone. When `false`, no slash is enforced — unlike Next.js, the default does not strip trailing slashes.
- A cache admin panel surface (now under `admin()` — see Breaking) that lists what the in-process tier holds (key, size, status, remaining TTL, dependency count, precompressed bodies for HTML; key and TTL for data), reports whether the Redis tier is connected or bypassed, and runs the operations you would otherwise hand-write an admin route for: targeted invalidation with an optional hard mode, dropping a single entry, clearing either cache, unlinking the shared keys and triggering a prewarm pass. Unlike the dev overlay it does not look at `NODE_ENV`, because "why is this page stale" is a production question — but nothing is mounted until it is explicitly enabled, so the path does not exist by default. Access is a 32-character password regenerated on every process start and printed once to the server log; there is no persistent secret to leak and a deploy revokes old access on its own. The password is never accepted in a query string, three failed attempts ban the IP for 24 hours, and every banned or unauthorised response is a `404` rather than a 401 that would confirm the panel exists. The panel is excluded from indexing, prewarming and navigation speculation.

### Changed

- Admin panel System meters (CPU, memory, disk) show this process's share of the host — RSS and project disk footprint against machine totals, plus process CPU across all cores — instead of whole-machine fullness. The panel content width is wider (`1600px`) so Overview, Routes, Views and System use the screen better.

### Breaking

- The cache admin panel moved to a top-level `admin()` config section at `/_jskelet/admin` (was `cache().panel` at `/_jskelet/cache`). Enable with `admin() { return { enabled: true } }` or `JSKELET_ADMIN=1`. `JSKELET_CACHE_PANEL` and `cache().panel` are removed. Auth is unchanged (per-process password in the server log, cookie session, 404 for strangers); the action CSRF header is now `X-JSkelet-Admin`.

## [0.2.5] - 2026-09-01

### Fixed

- Cloudflare analytics in the cache panel no longer asks for an open-ended window. Queries used only `datetime_geq`, so Cloudflare closed the range at query time and a default 24h lookback became `1d` plus network delay — Free zones reject anything wider than one day. Both ends are now pinned from the same clock (`datetime_leq` included).

## [0.2.4] - 2026-08-31

### Added

- A language picker in the cache panel header, Turkish and English. The first visit follows the browser's language, the choice is kept in `localStorage` and carries over to the login page, and switching costs no request. To keep this from leaking UI concerns into the server, an `/action` response now returns `{ ok, code, params }` instead of an English sentence and the panel builds the text — the framework's log and API stay in one language while the panel speaks two.

## [0.2.3] - 2026-08-31

### Added

- `cache().query`, a pattern → allowlist mapping that decides which query parameters belong to the HTML cache key. An allowlist caches one entry per distinct value of the listed parameters and ignores the rest, so every `?utm_source=…` variant of a path shares one copy; `true` puts the whole query in the key and `[]` ignores it entirely. Parameters enter the key sorted, so `?a=1&b=2` and `?b=2&a=1` are one entry.
- Cloudflare cache management, from the panel and from code. Set `JSKELET_CLOUDFLARE_KEY` and `JSKELET_CLOUDFLARE_ZONE_ID` (or `cache().cloudflare`) and the panel gains the CDN tier next to the origin one: purge everything, purge every URL currently held in memory with one button or a single row with `cf purge`, purge by prefix, host or cache tag, toggle development mode, cache level, browser cache TTL, query string sorting, Always Online, Tiered Cache, Regional Tiered Cache and Cache Reserve, clear Cache Reserve, and read the cache hit ratio. This matters because `invalidateHtmlCache()` refreshes the origin while the copy your visitors get keeps being served from the edge until its TTL expires. The same surface is exported as `purgeCloudflare()`, `toCloudflareUrls()`, `fetchCloudflareOverview()`, `fetchCacheAnalytics()`, `fetchPathEdges()` and `getCloudflareStatus()`; none of them throw, so a CDN outage returns `{ ok: false, error }` instead of breaking a publish flow. Long purge lists are batched at Cloudflare's 100-keys-per-request limit and sent sequentially to stay inside the rate limit. The token is read from the environment, is never returned in a response, and only cache related zone settings can be changed.
- An edge breakdown for a single path: `fetchPathEdges()` reports which Cloudflare colos served it from cache and which went to the origin. This is observation, not inventory — Cloudflare has no endpoint that lists which edges currently hold a URL, and no way to warm an edge you pick, so the panel says as much rather than implying otherwise.
- `getRedisDetails()` reports where the shared tier actually points — address, TLS, database, namespace, which kinds are shared and whether the purge channel is subscribed — because "connected" alone does not explain a Redis that shares nothing because of a wrong namespace. The password is never part of the output. `inspectRedis()` counts the keys per kind plus `DBSIZE` and `used_memory`; it runs a `SCAN`, so the panel keeps it behind its own button instead of the refresh loop. When Redis is off, the panel explains what a shared tier would buy and shows the memory and disk state of the host instead, which is the number that decides whether `maxEntries` is too high.

### Changed

- The release history page in `examples/marketing` now shows one release at a time: the newest one is expanded and older releases collapse to a single header row with their date, status and change count. Every release used to be printed open in a two-column grid, which made the page an unreadable wall as soon as a few versions piled up. Version links and the quick-jump strip still work, and they open the collapsed release they point at.

### Breaking

- A request that carries a query parameter is now dynamic by default: it is not written to the HTML cache and the response is sent with `private, no-store`, even when a `cache().html` pattern covers the path. Every query variant used to become its own cache entry, which let campaign parameters (`?utm_source=…`) mint unbounded keys and evict real pages from a 500-entry store. Pages whose output genuinely depends on the query keep their cache by listing the relevant parameters under `cache().query`.

## [0.2.2] - 2026-08-31

### Added

- A cache admin panel at `/_jskelet/cache`, turned on with `cache().panel: { enabled: true }` or `JSKELET_CACHE_PANEL=1`. It lists what the in-process tier holds (key, size, status, remaining TTL, dependency count, precompressed bodies for HTML; key and TTL for data), reports whether the Redis tier is connected or bypassed, and runs the operations you would otherwise hand-write an admin route for: targeted invalidation with an optional hard mode, dropping a single entry, clearing either cache, unlinking the shared keys and triggering a prewarm pass. Unlike the dev overlay it does not look at `NODE_ENV`, because "why is this page stale" is a production question — but nothing is mounted until it is explicitly enabled, so the path does not exist by default. Access is a 32-character password regenerated on every process start and printed once to the server log; there is no persistent secret to leak and a deploy revokes old access on its own. The password is never accepted in a query string, three failed attempts ban the IP for 24 hours, and every banned or unauthorised response is a `404` rather than a 401 that would confirm the panel exists. The panel is excluded from indexing, prewarming and navigation speculation.
- `dropHtmlCacheKey()` and `dropDataCacheKey()` drop one exact cache key. `invalidateHtmlCache()` matches a path pattern and takes down every query variant of a path, which is the right default for a webhook but wrong when you want `/list?page=2` gone and `/list?page=3` left hot.
- An adaptive per-host rate limit for upstream calls, `cache().upstream`. It sits in the `fetch` wrapper rather than in the prewarm pass, because what spends the quota is the API call, not the page: one render may make one call or twenty, so `prewarm.rps` could never bound the real thing. A token bucket caps the average rate, a concurrency limit caps the calls in flight, and `rate` is treated as a ceiling that the limiter pulls down on its own — a 429 or 503 halves the rate, `Retry-After` stops the bucket for exactly as long as the upstream asked, and clean windows climb back one step at a time. A host that returns `breakerFailures` rate limits in a row is bypassed for `breakerCooldownMs`, which stops the worst waste: because a 429 counts as transient, the HTML produced by a throttled call is never stored, so a pass in that state spends quota and keeps nothing. Only 429 and 503 penalise the rate; a 400 or 500 is not a quota problem. Off by default — set `rate` to turn it on.
- `getUpstreamLimiterStatus()` reports the current rate, calls in flight, 429 count and breaker state per host. The dev panel's Server tab shows the same.
- `getDataCacheStats()` counts how the data cache was used: fresh hits, stale hits, misses, coalesced concurrent reads, values promoted from the shared tier and — the only number that reaches the quota — real producer runs. A prewarm pass now prints its own share of that (`12 upstream calls for 430 data reads (97% from the data cache)`), which is what tells you whether the fix is a longer TTL or a rate limit. The dev report has a Data cache card for it.
- The dev overlay header now shows the installed JSkelet version next to the title, labelled `latest` when it matches npm and `outdated` with the newer version when it does not, so you can tell at a glance which version the project runs without opening the Server tab.

### Changed

- The prewarm retry pass no longer retries permanent failures. A `400`, `403` or `404` does not get better on the second try, so those paths are dropped from the retry round and counted as `N not retried (permanent)` in the summary. The wait before the round now also honours the upstream rate limit: if a `Retry-After` or an open circuit breaker is holding calls back, the pass waits that out instead of retrying into the same 429.

## [0.2.1] - 2026-08-31

### Changed

- Errors and warnings raised during a prewarm pass are no longer logged one per page. Request errors and the per-page render warnings (`was produced with missing data`, `returned notFound() while upstream is failing`, `could not be produced`) are counted while the pass runs and printed as a single summary block afterwards, grouped by message with the most frequent kinds first, so a failing upstream can no longer bury the "warmed N/M pages" line under hundreds of near-identical lines. Real traffic logs as before, and the dev tools panel still shows the per-path detail.

## [0.2.0] - 2026-08-31

### Added

- An optional Redis tier behind both caches, turned on with `cache().redis: { enabled: true, url }` and `npm install ioredis`. The in-process cache stays primary and every request still reads it; Redis only does the two things a single process cannot. An instance that has never seen a path finds the HTML another replica already produced, so a fresh container or a post-deploy replacement does not re-render and re-fetch everything from scratch. And `invalidateHtmlCache()`, `clearHtmlCache()` and `clearDataCache()` now reach every replica over pub/sub instead of only the one that received the webhook — until now the others waited out the TTL and a visitor saw old or new content depending on where they landed. Keys live under `_jskelet:{namespace}:{buildId}:…`, where the build id makes HTML from a previous deploy expire on its own rather than pointing at asset files that no longer exist. Personalised (`storable: false`), degraded and non-200 responses are never shared. If `ioredis` is missing, Redis is unreachable or it goes down mid-flight, a warning is printed and the site keeps serving from memory.
- `getRedisStatus()` reports whether the shared tier is connected, which key prefix and build id it is using, and how many command failures there have been — usable from a healthcheck endpoint. The same summary appears in the dev panel report.
- Servers started with `startServer()` now shut down on `SIGTERM`/`SIGINT` instead of being killed: the listener is closed and the Redis connection is drained so in-flight writes are not cut mid-command.

### Changed

- Request errors raised during a prewarm pass are no longer logged one by one. They are counted while the pass runs and printed as a single summary line afterwards, grouped by status and message with the most frequent kinds first, so a flaky upstream can no longer bury the "warmed N/M pages" line under hundreds of stack traces. Errors from real traffic are logged as before, and the dev tools panel still shows the per-path detail.

## [0.1.9] - 2026-08-31

### Fixed

- The dev panel's WebSocket handshake was answered with a `Sec-WebSocket-Accept` value derived from a mistyped protocol constant. Browsers verify that value and closed the connection immediately with "Incorrect 'Sec-WebSocket-Accept' header value", so the panel silently fell back to polling.

## [0.1.8] - 2026-08-31

### Changed

- The marketing example's changelog page is now a timeline: releases are laid out along a rail with a sticky version column, each change group gets its own card with a coloured rule and item count, and a row of version chips at the top jumps straight to a release.
- The server now binds to `::` instead of `0.0.0.0` when no `HOST` is given, so a single dual-stack socket answers both IPv6 and IPv4. Browsers resolve `localhost` to `::1` first and, unlike ordinary requests, a WebSocket handshake does not fall back to IPv4 — which made the dev panel's live channel fail on an IPv4-only socket. Where IPv6 is unavailable the bind falls back to `0.0.0.0`.

## [0.1.7] - 2026-08-31

### Changed

- Devtools WebSocket connection handling hardened.

## [0.1.6] - 2026-08-31

### Added

- Targeted HTML invalidation: `invalidateHtmlCache(target, { hard })` takes a path, the config pattern syntax (`/news/:slug`), a regular expression or a list of them, and returns how many entries were affected. By default it **stales** the entries rather than deleting them, so a webhook that touches hundreds of pages does not turn into hundreds of cold renders at the worst possible moment: visitors keep getting the old HTML while the refresh runs in the background, once per key. Matching is done against the path, so every query variant of a page is covered by one call, and a render already in flight when the purge arrives is not stored.
- `clearDataCache()` now refreshes the HTML too. The `withDataCache` keys read during a render are recorded, so dropping `news:abc` stales every page that actually read it — the article, the home page listing it and the tag page — without the application declaring any tags. Turn it off with `cache().trackDependencies: false`; `getHtmlCacheEntries()` reports the dependency count per page as `deps`.
- Invalidated paths go to the front of the next prewarm pass, so an updated page is refreshed without waiting for a visitor, while still respecting the `rps` limit. The pass summary counts them separately.

### Changed

- Prewarming no longer holds up the rest of the dev server. In development it now runs with a single worker and a default limit of 4 requests per second (`prewarm.rps` / `PREWARM_RPS` still override it), so page requests and the dev panel stay responsive while a warm-up round is going on. Production behaviour is unchanged.

## [0.1.5] - 2026-08-30

### Changed

- The dev tools panel is now fed over a WebSocket (`<devBasePath>/ws`) instead of polling `/stats` every two seconds. The server pushes statistics as they change and sends live reload and CSS hot-swap events over the same connection, so an open tab no longer keeps hitting the server while the panel is closed. No new dependency is involved; if the socket cannot be opened, the panel falls back to the previous SSE plus polling path.

## [0.1.4] - 2026-08-30

### Added

- Transient upstream failures are now detected without any application code: `globalThis.fetch` is wrapped during startup and `429`, `5xx` and network errors raised inside a render are reported on their own, so rate limits stop turning existing pages into 404s even when the data layer never calls `reportUpstreamFailure()`. Requests outside a render and requests to the server itself are ignored, deterministic answers such as `404` are not reported, and the wrapper can be turned off with `cache().trackUpstream: false`.
- `cache().transientRetry` (`{ attempts: 1, delayMs: 300 }` by default) retries a page that called `notFound()` while upstream was failing. Each attempt runs in a fresh upstream and per-request cache scope, so a page whose data arrives on the second try is served and cached as usual instead of degrading to an error.

### Changed

- The changelog page of the marketing example is generated from the project's `CHANGELOG.md` instead of a hand-written list, and shows the version published on npm next to the installed one.
- The marketing example reads its markdown (documentation and changelog) from the repository over GitHub's raw endpoint, falling back to the installed package when the network is unavailable, so a deployment that ships without `node_modules` can still serve the docs. In development the local file wins and nothing is cached. The branch is overridable with `DOCS_REF`.

## [0.1.3] - 2026-08-30

### Changed

- Patch release; no user-facing changelog entries beyond 0.1.2.

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

[Unreleased]: https://github.com/ayberkenis/jskelet/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/ayberkenis/jskelet/compare/v0.5.4...v0.6.0
[0.5.4]: https://github.com/ayberkenis/jskelet/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/ayberkenis/jskelet/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/ayberkenis/jskelet/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/ayberkenis/jskelet/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ayberkenis/jskelet/compare/v0.4.8...v0.5.0
[0.4.8]: https://github.com/ayberkenis/jskelet/compare/v0.4.7...v0.4.8
[0.4.7]: https://github.com/ayberkenis/jskelet/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/ayberkenis/jskelet/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/ayberkenis/jskelet/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/ayberkenis/jskelet/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/ayberkenis/jskelet/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/ayberkenis/jskelet/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/ayberkenis/jskelet/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ayberkenis/jskelet/compare/v0.3.5...v0.4.0
[0.3.5]: https://github.com/ayberkenis/jskelet/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/ayberkenis/jskelet/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/ayberkenis/jskelet/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/ayberkenis/jskelet/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/ayberkenis/jskelet/compare/v0.2.5...v0.3.1
[0.2.5]: https://github.com/ayberkenis/jskelet/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/ayberkenis/jskelet/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/ayberkenis/jskelet/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/ayberkenis/jskelet/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/ayberkenis/jskelet/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ayberkenis/jskelet/compare/v0.1.9...v0.2.0
[0.1.9]: https://github.com/ayberkenis/jskelet/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/ayberkenis/jskelet/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/ayberkenis/jskelet/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/ayberkenis/jskelet/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/ayberkenis/jskelet/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/ayberkenis/jskelet/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/ayberkenis/jskelet/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/ayberkenis/jskelet/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/ayberkenis/jskelet/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ayberkenis/jskelet/releases/tag/v0.1.0
