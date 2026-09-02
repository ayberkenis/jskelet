# JSkelet

**A framework that feels like no framework** — for sites where SEO and speed are
the product.

JSkelet renders **complete HTML** on an Express 5 server from build-time
**`.jsk` templates** (EJS still works), adds interactivity through vanilla JS
**islands**, compiles CSS into a **single Tailwind v4 stylesheet**, and instead
of ISR keeps an in-process **HTML TTL cache** with stale-while-revalidate — plus
optional Redis sharing and path-based invalidation. No React, no TypeScript —
plain JavaScript with JSDoc.

[![npm version](https://img.shields.io/npm/v/jskelet)](https://www.npmjs.com/package/jskelet)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

- [Quick start](#quick-start)
- [What it looks like](#what-it-looks-like)
- [How it works](#how-it-works)
- [What you get](#what-you-get)
- [What it deliberately does not do](#what-it-deliberately-does-not-do)
- [Project layout](#project-layout)
- [Configuration](#configuration)
- [CLI](#cli)
- [Public API](#public-api)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Examples](#examples)
- [Contributing](#contributing)

## Quick start

```bash
mkdir my-site && cd my-site
npm init -y && npm pkg set type=module
npm install jskelet
npm install -D postcss @tailwindcss/postcss tailwindcss lightningcss
npx jskelet init
npx jskelet dev
```

`http://localhost:3000` serves a page that was rendered on the server, stored in
the HTML cache, and whose island hydrates when it scrolls into view.

Requirements:

- **Node.js 22 or newer.**
- Everything else is an **optional peer dependency**: `postcss`,
  `@tailwindcss/postcss`, `tailwindcss` and `lightningcss` for styles,
  `@phosphor-icons/core` for the icon sprite, `sharp` for image optimization,
  `ioredis` for the shared Redis cache tier. If a package is missing, the
  matching step is skipped with a warning and the site keeps working.

## What it looks like

A feature (or route) module receives the app and registers URLs explicitly.
Nothing is inferred from the file system.

```js
// features/home/index.js
export default function register(app, { route, notFound }) {
  app.get("/", route(
    async () => ({
      view: "pages/home",
      metadata: { title: "Home", canonical: "/" },
      data: { posts: getPosts() },
    }),
    { revalidate: 60 },
  ));

  app.get("/blog/:slug", route(async ({ params }) => {
    const post = getPost(params.slug);
    if (!post) notFound();
    return { view: "pages/blog-post", data: { post } };
  }));
}
```

Templates are `.jsk`: compiled to ESM at build time (no request-time parse or
`eval`). Named exports under `views/components/**` become PascalCase tags —
plain functions that return HTML strings.

```html
<!-- features/home/views/pages/home.jsk -->
<section class="wrapper">
  <h1 class="text-3xl font-bold">Latest posts</h1>
  {#each posts as post}
    <PostCard :post="post" />
  {/each}

  <div data-island="newsletter"></div>
</section>
```

Islands export a named `mount(element, props)` and are registered from the
client entry as dynamic imports.

```js
// features/home/client/newsletter.js
export function mount(el) {
  const form = el.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await fetch("/api/subscribe", { method: "POST", body: new FormData(form) });
  });
}
```

## How it works

A request goes through a fixed middleware order that is documented in the
numbered comment at the top of `src/server/create-app.js`; changing that order
causes silent breakage.

1. **Config** (`jskelet.config.mjs`) is loaded once and exposed through
   `getConfig()`. `redirects()`, `rewrites()`, `headers()`, `cache()` and
   `admin()` follow the subset of `next.config` syntax people actually use. A
   broken config, a throwing `headers()` or a failing hook logs a warning and
   falls back to defaults — it never takes the site down.
2. **Build** turns `.jsk` into modules under `.jskelet/templates/`, bundles
   islands, compiles Tailwind, hashes assets and optionally precompresses them.
3. **Static assets** are served from `public/` with hashed filenames and
   long-lived cache headers; precompressed `.br` / `.gz` variants are picked
   automatically.
4. **`route()`** wraps your controller. It builds a cache key, checks the HTML
   TTL cache, and on a miss renders the page. When a cached entry is stale it is
   returned immediately while revalidation runs in the background.
5. **Render** composes metadata, layout context and your view into one HTML
   document. Hooks (`metadata`, `layoutContext`, `notFound`, `prewarmPaths`)
   are where application knowledge lives — the framework itself carries none.
6. **Hydration** happens in the browser: the island registry finds
   `data-island` elements and dynamically imports the matching chunk when it
   becomes visible (or eagerly / on idle, if asked).

Because cached HTML is shared by every visitor, nothing personalized may appear
in a page rendered through `route()`. Per-user markup belongs in separate
fragment endpoints marked `no-store`, and decisions like theme are made on the
client.

## What you get

- **Full HTML from the server.** First paint does not wait for JavaScript, and
  crawlers see the complete document because content is never assembled in the
  browser.
- **Build-time `.jsk` templates.** Declarative HTML-like syntax compiled to ESM
  before the server starts; EJS remains supported where both exist, `.jsk`
  wins. A VS Code / Cursor extension under `extensions/vscode-jsk` covers
  highlighting and snippets.
- **Feature-first layout.** `features/<name>/` co-locates routes, views,
  components and islands; `jskelet generate feature|page|island` scaffolds the
  next slice. URLs stay explicit.
- **Islands.** Interactivity attaches to elements carrying `data-island`.
  Modules are dynamically imported on visibility by default;
  `data-island-eager` and `data-island-idle` pick a different strategy. A small
  store handles sharing state between islands.
- **HTML TTL cache.** Per-route `revalidate`, stale-while-revalidate on expiry,
  query allowlists, dependency tracking from `withDataCache`, and prewarm that
  fills the cache at boot. `invalidateHtmlCache()` stales a path, pattern or
  RegExp without flushing everything.
- **Optional Redis tier.** With `ioredis`, replicas share HTML/data and
  broadcast invalidation over pub/sub so a webhook reaches every process.
- **Admin panel.** Opt-in at `/_jskelet/admin` (`admin()` or `JSKELET_ADMIN=1`):
  cache inventory, targeted purge, Cloudflare CDN controls, live logs, routes
  and system meters — password printed once per process start.
- **Fast navigation.** The `navigation` config section emits Speculation Rules
  to prefetch or prerender links and enables view transitions — without adding
  any client runtime.
- **Familiar configuration.** `redirects()`, `rewrites()`, `headers()`,
  `cache()`, `admin()`, plus `brand`, `images`, `security`, `logs`,
  `trailingSlash` and `hooks`.
- **A real build pipeline.** Fonts, an SVG sprite from the icons you use,
  Tailwind v4 CSS, esbuild bundles with code splitting, webp variants, hashed
  output and brotli/gzip precompression.
- **Developer experience.** One command, one terminal: watch build plus server,
  CSS hot-swap, automatic restart, and a devtools overlay on Alt+D showing
  requests, errors, upstream calls, a cache dump and Web Vitals.
- **Graceful degradation.** Without build output `asset()` returns the unhashed
  path and `hasAsset()` returns false, so forgetting `jskelet build` yields an
  unstyled but working page instead of a crash.

## What it deliberately does not do

- **No file-system routing.** Paths are written explicitly in route modules.
- **No streaming or RSC.** A page is flushed as one document; slow sections are
  fetched from separate fragment endpoints.
- **No Next.js-style cache tags.** Invalidation is by path, pattern or RegExp
  (`invalidateHtmlCache`), plus data-cache dependency tracking — not arbitrary
  tag graphs.
- **No global state management** beyond the small island store.

An app-shaped interface behind a login — a dashboard, an editor, an admin panel
— cannot benefit from the HTML cache, which is the main reason to pick this
framework. It is supported rather than recommended: `route(fn, { private: true })`
keeps per-visitor pages out of the cache, and signed cookies, CSRF, fragment
endpoints and region swapping cover the rest
([docs/12-panel-ve-oturum.md](./docs/12-panel-ve-oturum.md) /
[docs/en/12-dashboards-and-sessions.md](./docs/en/12-dashboards-and-sessions.md)).
Live data transport is deliberately left to you; pick SSE, WebSocket or polling
yourself. A feature-by-feature comparison with Next.js is in
[docs/11-tasima.md](./docs/11-tasima.md) /
[docs/en/11-migration.md](./docs/en/11-migration.md).

## Project layout

`jskelet init` scaffolds this shape, and every directory is configurable through
the `paths` section of the config:

```
my-site/
├── jskelet.config.mjs      # config, hooks, headers, redirects
├── features/               # feature-first slices (optional but default in init)
│   └── home/
│       ├── index.js        # register(app, api) — URLs stay explicit
│       ├── views/pages/    # .jsk pages for this feature
│       ├── views/components/
│       ├── client/         # islands; register from client/entries
│       └── server/
├── routes/                 # optional; loaded before features (10-, 20-, …)
├── views/                  # shared / app-wide pages (e.g. 404)
├── shared/                 # cross-feature server/views/client
├── client/entries/main.js  # registers islands, calls start()
├── styles/globals.css      # Tailwind entry with @source directives
└── public/                 # build output plus static files
```

Two things bite newcomers:

- **Tailwind class scanning follows `@source` directives** in
  `styles/globals.css`, because automatic detection is turned off with
  `source(none)`. A new directory that uses classes needs an `@source` line, or
  its classes silently vanish from the stylesheet.
- **`.jsk` expression language is intentionally narrow.** Formatting and object
  literals belong in JS components (`views/components/**`), not in the template.

## Configuration

`jskelet.config.mjs` exports a single object. Every section is optional.

```js
export default {
  brand: { name: "My Site", lang: "en" },
  icons: { scan: ["views", "features", "client"] },

  // Speculation Rules plus @view-transition, with no client runtime.
  navigation: { prefetch: "moderate", prerender: "conservative", viewTransition: true },

  async redirects() {
    return [{ source: "/old", destination: "/new", permanent: true }];
  },

  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }] }];
  },

  async cache() {
    return {
      html: { "/": 3600, "/pricing": 3600 },
      query: { "/search": ["q"] }, // only these params enter the cache key
      prewarm: { enabled: true, max: 50, concurrency: 4 },
      // redis: { enabled: true, url: process.env.REDIS_URL },
    };
  },

  // Opt-in production panel at /_jskelet/admin (password in the server log).
  async admin() {
    return { enabled: false };
  },

  hooks: {
    metadata: () => ({ titleTemplate: "%s · My Site", siteUrl: "https://example.com" }),
    layoutContext: ({ pathname }) => ({ pathname, year: new Date().getFullYear() }),
    prewarmPaths: async () => ["/", "/pricing"],
  },
};
```

The complete reference — every field, default and failure mode — is
[docs/07-yapilandirma.md](./docs/07-yapilandirma.md) /
[docs/en/07-configuration.md](./docs/en/07-configuration.md).

## CLI

| Command | What it does |
| --- | --- |
| `jskelet dev` | Watch build plus server, live reload, devtools overlay |
| `jskelet build` | Production build: templates → fonts → sprite → CSS → JS → images → manifest → precompress |
| `jskelet start` | Production server; builds first if output is missing |
| `jskelet init` | Scaffolds a feature-first `.jsk` skeleton into the current directory |
| `jskelet generate` | Scaffolds a `feature` / `page` / `island` |

## Public API

Only the specifiers in the `exports` map are supported:

| Specifier | Contents |
| --- | --- |
| `jskelet` | `route`, `fragment`, `createApp`, `startServer`, `notFound`, `redirect`, `seeOther`, `cache`, `asset`, `getConfig`, cookie helpers, HTML/data cache and prewarm helpers, Redis/Cloudflare status and purge helpers |
| `jskelet/client` | `register`, `registerAll`, `hydrate`, `unmount`, `start`, `swap`, `startForms`, `createStore`, DOM helpers |
| `jskelet/html` | `attrs`, `cn`, `cx`, `esc`, `jsonScript` |
| `jskelet/tags` | `icon`, `image`, `link`, `preloadImage`, `csrfField` |
| `jskelet/cookies` | `parseCookies`, `setCookie`, `clearCookie`, `setSignedCookie`, `getSignedCookie`, `randomToken`, `safeEqual` |

Anything reachable by a deeper path is internal and may change without notice.

## Deployment

The server is a plain Express 5 app, so anything that can run a Node process
works: a `Dockerfile` (see `examples/marketing/Dockerfile`), a systemd unit, or
a PaaS. Run `jskelet build` at image build time, put a reverse proxy in front
for TLS, and expose a health endpoint (the default dev gate bypass list already
includes `/api/healthcheck`, so a route there is reachable in every mode).
Details, including cache sizing behind multiple instances and the optional
Redis tier, are in [docs/10-dagitim.md](./docs/10-dagitim.md) /
[docs/en/10-deployment.md](./docs/en/10-deployment.md).

## Documentation

Full reference in Turkish under [docs/](./docs/README.md) and in English under
[docs/en/](./docs/en/README.md). Both editions are kept in sync.

| Document (TR / EN) | Topic |
| --- | --- |
| [01-baslangic](./docs/01-baslangic.md) / [getting-started](./docs/en/01-getting-started.md) | Installation, first route, first island, directory layout, CLI |
| [02-mimari](./docs/02-mimari.md) / [architecture](./docs/en/02-architecture.md) | Decisions and their reasoning, middleware order |
| [03-routing](./docs/03-routing.md) / [routing](./docs/en/03-routing.md) | Route modules, controller contract, load order |
| [04-render](./docs/04-render-ve-sablonlar.md) / [rendering](./docs/en/04-rendering.md) | `.jsk` / EJS, layout, components, helpers, metadata |
| [05-islands](./docs/05-islands.md) / [islands](./docs/en/05-islands.md) | Island contract, hydration, store, DOM helpers |
| [06-cache](./docs/06-cache.md) / [caching](./docs/en/06-caching.md) | TTL, SWR, keys, prewarm, Redis, invalidation, admin |
| [07-yapilandirma](./docs/07-yapilandirma.md) / [configuration](./docs/en/07-configuration.md) | Complete `jskelet.config.mjs` reference |
| [08-build](./docs/08-build.md) / [build](./docs/en/08-build.md) | Build pipeline, manifest, Tailwind `@source`, sprite |
| [09-dev](./docs/09-dev-araclari.md) / [dev-tools](./docs/en/09-dev-tools.md) | Dev workflow, overlay, report page, dev gate |
| [10-dagitim](./docs/10-dagitim.md) / [deployment](./docs/en/10-deployment.md) | Production, Docker, reverse proxy, health checks |
| [11-tasima](./docs/11-tasima.md) / [migration](./docs/en/11-migration.md) | Migrating from Next.js: mapping table and plan |
| [12-panel](./docs/12-panel-ve-oturum.md) / [dashboards](./docs/en/12-dashboards-and-sessions.md) | Per-visitor pages: `private: true`, sessions, CSRF, fragments |

If you work with AI agents, [AGENTS.md](./AGENTS.md) summarizes the rules that
apply to this repository.

## Examples

```bash
npm --prefix examples/minimal   install && npm --prefix examples/minimal   run dev
npm --prefix examples/blog      install && npm --prefix examples/blog      run dev
npm --prefix examples/marketing install && npm --prefix examples/marketing run dev
npm --prefix examples/dashboard install && npm --prefix examples/dashboard run dev
```

- **`examples/minimal`** — two routes, one component, one island, plus a
  co-located `features/demo` slice. The smallest thing that runs.
- **`examples/blog`** — dynamic routes, tag pages, every config section,
  fragment-loaded tabs, a form, prewarm, RSS and sitemap, four islands. It
  intentionally touches every surface of the framework.
- **`examples/marketing`** — the framework's own marketing site: comparison
  table, changelog and download pages, long TTLs, prewarm covering every page.
  The byte counts on the page are measured from that site's own build output, the
  version details are read from the installed package, and the latency numbers
  are measured in the browser; there are no invented benchmarks. It is also
  bilingual — English at the root, Turkish under `/tr` — which shows how to build
  a multi-language site on a framework that ships no i18n of its own.
- **`examples/dashboard`** — the opposite axis: per-visitor pages. A signed
  cookie session, a `private: true` page that never enters the HTML cache, a
  paginated table fragment, a CSRF-protected form that still works without
  JavaScript, and an island with cleanup. A public landing page sits next to it,
  so a cached response and a `no-store` one are visible side by side.

With a server running, `node smoke.mjs` inside an example verifies that its
endpoints respond as expected.

## Contributing

Bug reports, documentation fixes and pull requests are welcome. Start with
[CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow and local checks, and note
that participation is covered by our
[Code of Conduct](./CODE_OF_CONDUCT.md). Security issues should follow
[SECURITY.md](./SECURITY.md) instead of the public issue tracker.

```bash
npm install
npm run lint
npm test
```

## License

[MIT](./LICENSE) © JSkelet contributors
