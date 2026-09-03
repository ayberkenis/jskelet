# 09 — Development tools

This document explains what `jskelet dev` does and why it does it that way: how
the two child processes are managed, the shape of the terminal output, the
watched directories and the reason a custom watcher was written instead of using
`node --watch`, the distinction between CSS hot-swap and a full reload, the
devtools overlay opened with `Alt+D`, the detailed report page, and the dev gate
built on `DEV_TOKEN`. The build steps themselves are in
[08-build.md](./08-build.md).

## The `jskelet dev` flow

The command manages two long-lived child processes in a single terminal:

```
jskelet dev
├─ build watch   node src/build/build.mjs --watch
└─ server        node [--env-file=.env] --import <register.mjs> src/start.mjs
```

`NODE_ENV=development` is assigned here in a platform-independent way — no
`cross-env` needed. The child processes also receive `JSKELET_CHILD=1`
(suppresses the build banner) and, if a TTY is present, `JSKELET_COLOR=1`
(forces color on piped output).

Startup order: banner → build steps → server ready → `Ready` summary. The
summary is printed once both the build and the server are ready; otherwise it
got buried among the build lines arriving afterwards.

The server signals readiness with a single line inside `startServer`:

```
jskelet → http://localhost:3000 (development)
```

The shape of this line is a contract; the dev script parses it and prints the
summary line accordingly.

### The shape of the terminal output

Child process output does not stream through as-is. There are two regions and
they never mix:

1. **Startup:** banner, aligned build lines, `Ready` summary.
2. **Runtime:** timestamped, single-line events (HTTP requests, CSS rebuild,
   server restart).

Error stacks are turned into a framed box: because stack lines arrive in
fragments, they are collected after a short silence (60 ms), the error name and
message are parsed, the first three frames are shown, and the project root is
shortened to `.`. When you are developing your own framework, not losing the
error in the stream is the detail that genuinely makes a difference.

Color carries meaning: `✓` green, `✖` red, `⚠` yellow, `↻` cyan; durations and
paths gray. No decorative color is used. If `NO_COLOR` is set, no color is used
at all.

`Ctrl+C` (SIGINT/SIGTERM) shuts down all child processes. If a child exits with
a non-zero code (other than an expected restart), an error is printed and the
dev process exits too.

## Watch directories

Server restarts are managed by the framework's own watcher.

```js
WATCH_DIRS = [
  config.dirs.routes,
  config.dirs.views,
  <root>/lib,
  ...config.watch,   // jskelet.config.mjs → watch
]
```

The `jskelet.config.mjs` file itself is watched as well: when the config
changes, both the server and the build must come up with the new settings.

Watched extensions: `.js`, `.mjs`, `.json`, `.ejs`.

`views` is watched too, because most components live in
`views/components/**.js` and, since those modules are imported into the server
once, changes made without a restart never reached the browser (that "I edited
the template and nothing changed" feeling comes from here).

`client/` and `styles/` are **not** in this list: esbuild and the CSS watchers
handle them on their own ([08-build.md](./08-build.md)).

If a directory cannot be watched, a warning is printed and no automatic restart
happens for that directory; everything else keeps working.

### Why `node --watch` was not used

Even when given `--watch-path`, Node watched the project root in this setup.
Whenever build output (`public/assets`, `manifest.json`) or the dev tooling log
was written, the server restarted for nothing — in fact a self-feeding loop was
set up: restart → startup warning → write → restart.

The custom watcher does three things:

1. **Watches only server sources.**
2. **Coalesces changes** (250 ms) and reports which files changed.
3. **Filters out phantom events.** On Windows, `fs.watch` can emit events for a
   file's neighbors when it is written; without comparing `mtime`, a single save
   turned into two restarts. Current timestamps are read up front at startup, so
   the first phantom event is filtered out as well.

The restart line shows the changed file, or how many changed:

```
21:04:12 ↻ server  restarting…  routes/10-pages.mjs
21:04:12   server  restarted    412ms
```

If `JSKELET_VERBOSE=1` is set, all files are listed when more than one changed.

## CSS hot-swap and full reload

The dev server watches `.jskelet/manifest.json` and broadcasts events to the
browser over the live channel (`<devBasePath>/ws`). Since the manifest is
rewritten on every build round, change detection is done through the manifest.

| What changed | Behavior |
| --- | --- |
| Only `app.css` | **CSS hot-swap:** the stylesheet is swapped, the page is not reloaded. State and scroll position are preserved. |
| `main.js`, the sprite, another asset, or more than one key | **Full reload** |

In both cases the HTML cache is cleared first: the stored HTML carries the old
hashed asset URLs and, if not cleared, the page keeps asking for a deleted file.

Manifest events are coalesced over 120 ms. If watching is not supported, live
reload is disabled and everything else keeps working.

When the server restarts, the overlay figures it out from the **boot id**: every
process broadcasts a unique `boot` value, the overlay sees the change, shows the
"restarted" note and does not reset its own state.

## The live channel

Everything the overlay shows — statistics, live reload and CSS hot-swap events —
arrives over a single WebSocket (`<devBasePath>/ws`). The panel used to poll for
statistics every two seconds, so every open tab kept hitting the server even
while the panel was closed. Now the server pushes as things change: when a
request or an error is recorded (coalesced over 120 ms), and every two seconds so
the time-based fields (uptime, memory, the prewarm counter) stay fresh. The
heartbeat is deliberately independent of prewarming: if the channel's tempo
followed a background job, the panel would be tied to that job's rhythm. Nothing
is computed when no panel is connected.

The handshake happens on the HTTP `upgrade` event, and that event never reaches
the middleware chain, so the channel is attached straight to the server after
`listen` (`attachDevSocket`). The server side pulls in no dependency such as
`ws`: all it needs is to write server-to-client text frames and to answer the
client's ping/close frames.

If the socket opens and later drops — that is, the server is restarting — it
reconnects every half second and the indicator reads "server restarting…" in the
meantime. If it never opens, it is retried four times with a widening gap: the
page may have been loaded during the server's restart window, and a single
failure does not mean the channel is unavailable. If those attempts fail too (a
proxy in between may not pass WebSocket through), the overlay falls back to the
old path: the `/events` SSE stream plus polling `/stats`.

## Devtools overlay

A floating bubble in the bottom right; opened with `Alt+D`, closed with `Esc` or
by clicking the backdrop. It is only emitted by the layout when
`NODE_ENV=development`:

```ejs
<% if (devtools) { %>
<script type="module" src="<%= devBasePath %>/overlay.js"></script>
<% } %>
```

The overlay file is **not part of the build.** The server serves it raw from the
framework package; that is why there is no bundler involved. It loads sibling
modules such as `seo.js` with native ESM imports, and it adds nothing to the
production output. The entire UI lives inside a shadow DOM and does not mix with
the page's CSS.

What it shows:

- **Errors:** browser-side JS errors, resource loading errors
  (`img`/`script`/`link`), the server's `console.error` / `console.warn`
  output, and failed SSR / browser `fetch` calls (4xx/5xx or network). Each
  record carries a **page path**, **API URL**, and (on the client) an **island
  name** when known; the response body opens under **show details** as JSON
  instead of `[object Object]`. On the server side `console` is wrapped so
  warnings do not get lost in the terminal; upstream failures still land in the
  overlay even when the app's own logger writes them only to stderr.
- **SEO:** a client-side scan of the current page — title and meta description
  length, `html lang`, viewport, canonical, robots/`noindex`, Open Graph and
  Twitter tags, H1/outline, image `alt`, empty links, and JSON-LD parse errors.
  Findings appear in the panel; turning on **Highlight issues on the page**
  draws red (error) or yellow (warning) boxes on the elements, with a short
  title on the border. Clicking the label (or a row in the panel) opens the
  full explanation. The scan lives in `/seo.js` next to the overlay and is not
  part of the production bundle.
- **Requests:** the method, path, status, duration and `X-JSkelet-Cache` value
  of every HTML request. The same lines are printed to the terminal too.
- **Web Vitals:** TTFB, FCP, LCP, CLS, INP, DCL, load, long task count and
  blocking time.
- **Prewarm:** the progress of the warming round; it can be triggered manually
  from the panel, and individual paths can be retried.
- **Process:** pid, Node version, uptime, RSS and heap usage.
- **Version:** the installed JSkelet version compared against the `latest` tag
  on npm. When a newer release exists, the **Server** tab grows an `update` chip
  and a line that copies the upgrade command. The lookup runs once, 1.5 seconds
  after boot, is cached for six hours in `os.tmpdir()` and is skipped silently
  when the registry is unreachable. Set `JSKELET_VERSION_CHECK=0` to disable it.

Warming requests (`user-agent: jskelet-prewarm`) are filtered out of both the
terminal and the request list: hundreds of requests should not flood the view.
Progress appears in the badge next to the bubble.

### Why state is written to `os.tmpdir()`

If request and error records lived in process memory, history would be erased on
every restart and the overlay would come up empty. So the records are carried
across restarts in a file.

The file is **not written into the project tree**: every write triggered the
watcher and restarted the server, which set up a self-feeding loop (restart →
startup warning → write → restart). Instead, the file is written to
`os.tmpdir()/jskelet-devtools-<hash of the project root>.json`; thanks to the
hash, multiple JSkelet projects on the same machine do not overwrite each
other's records.

The write happens after 300 ms of silence rather than on every request, and its
failure does not stop the dev flow. At most 50 requests and 50 errors are kept.

The panel's open/closed state, its active tab and the browser error log are kept
in tab memory (`sessionStorage`), so after a reload the panel comes back with
the same tab.

## Report page

The bubble shows the current state; the report page produces a view of the whole
site. The address:

```
http://localhost:3000/__jskelet/dev/report
```

(Or wherever `brand.devBasePath` points, if you changed it.)

Its contents:

- **Pages:** the Web Vitals measurements of every visited page, resource count
  and total bytes (broken down by type), island status (how many are ready, and
  their names), API calls made in the browser, and the size/duration/cache
  status of the SSR output. Pages that were never visited but were warmed are
  listed too: the SSR side is known, the client measurements stay empty.
- **Server API calls:** outbound `fetch` calls made during SSR — URL, host,
  method, status, duration, bytes, which page was rendering, and a body summary
  on failures. `globalThis.fetch` is only wrapped in development; the production
  path is left untouched. Requests to our own server (warming, health check) do
  not count as API calls. Failures also appear on the overlay Errors tab.
- **Build output:** the raw/gzip/brotli size of every asset in the manifest, and
  chunk analysis from esbuild's metafile — the size of each output, which
  sources it is made of, which chunks it imports. Sources are reduced to
  readable groups (package name or parent folder), so the question "which
  library accounts for 40 kB of this chunk" can be answered.
- **HTML cache:** entry count and a dump (key, bytes, status, whether it is
  stale, how many seconds until it expires, which encodings are stored).
- **Prewarm:** the full result of the last round.
- **Request and error logs.**

Measurements live on the server, not in the browser tab; resetting is done from
the server as well. Size calculations are not repeated unless the file changed.

The report layer is only loaded in development and never enters the production
output.

## Dev endpoints

Under `brand.devBasePath` (default `/__jskelet/dev`):

| Path | Method | Job |
| --- | --- | --- |
| `/overlay.js` | GET | The overlay script |
| `/seo.js` | GET | SEO scan + page highlight helper (imported by the overlay) |
| `/logo.png` | GET | The overlay logo |
| `/ws` | GET (upgrade) | Live channel: statistics, live reload and CSS hot-swap events |
| `/events` | GET | SSE: the fallback event stream, used only when WebSocket cannot be established |
| `/stats` | GET | Current statistics; the data endpoint of that same fallback |
| `/report` | GET | The report page (HTML) |
| `/report.js` | GET | The report page's script |
| `/report/data` | GET | The report's single data source (JSON) |
| `/vitals` | POST | The measurement bundle sent by the overlay |
| `/report/clear` | POST | Resets page measurements and server API records |
| `/prewarm` | POST | Triggers warming manually. If the body has `paths`, only those paths; 409 if warming is already running. |
| `/clear` | POST | Resets the request and error logs |

All of these endpoints are mounted by `mountDevtools()` only when
`NODE_ENV=development`; thanks to the dynamic import, nothing is loaded into the
production process.

## Dev gate — `DEV_TOKEN`

To hide an environment that is not public yet: while `DEV_TOKEN` is set,
**every** request without the token gets a 404.

```bash
DEV_TOKEN=a-long-random-string npm start
```

Access:

```
https://staging.example.com/?dev_token=a-long-random-string
```

Behavior:

- **404, not 403.** A 403 confirms the environment exists; a 404 acts as if it
  never did.
- Once the token arrives as a query parameter, it is written to a cookie
  (`Path=/`, `SameSite=Lax`, 14 days), so sharing the link is enough. The cookie
  and parameter name is `brand.devTokenCookie` (default `dev_token`).
- The **exact** paths in the `devGateBypass` list are open under all conditions.
  Default: `/api/healthcheck`, `/robots.txt`, `/sitemap.xml`,
  `/site.webmanifest`, `/favicon.ico`. If your health check lives at a different
  path, remember to add it to this list, otherwise your orchestrator will see a
  404.
- Without `DEV_TOKEN` the middleware is entirely disabled and costs nothing in
  production.
- Since warming makes requests to its own server, it carries the token as a
  cookie; without it every page gets a 404 and the cache never fills up
  ([06-caching.md](./06-caching.md)).

In the middleware chain the gate sits after `headers` and **before**
`redirects`: an environment that is not public yet should not leak even its
redirect rules.

## Differences between development and production

| Topic | Development | Production |
| --- | --- | --- |
| EJS template cache | Off | On |
| Manifest reading | On every request | Once |
| Image manifest | On every call | Once |
| Broken route module | Warn + skip | Throw |
| Devtools and report | Mounted | Never loaded |
| `globalThis.fetch` | Wrapped (measurement) | Untouched |
| Prewarm concurrency | 1 | 4 |
| Prewarm rate limit | 4 requests/second | Unlimited |
| Prewarm delay | 3000 ms | 500 ms |
| Missing icon warning | Emitted | Not emitted |
| Precompress | Does not run in watch | Runs |
| Image optimization | Does not run in watch | Runs |

## What's next

- Details of the build steps: [08-build.md](./08-build.md)
- Going to production: [10-deployment.md](./10-deployment.md)
- Reading and clearing the cache: [06-caching.md](./06-caching.md)
