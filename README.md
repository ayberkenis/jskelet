# JSkelet

**A framework that feels like no framework** — for sites where SEO and speed are
the product.

JSkelet renders **complete HTML** on an Express 5 server with EJS, adds
interactivity through vanilla JS **islands**, compiles CSS into a **single
Tailwind v4 stylesheet**, and instead of ISR keeps an in-process **HTML TTL
cache** with stale-while-revalidate. No React, no TypeScript — plain JavaScript
with JSDoc.

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
  `@phosphor-icons/core` for the icon sprite, `sharp` for image optimization. If
  a package is missing, the matching build step is skipped with a warning and
  the site keeps working.

## What it looks like

A route module receives the app and returns page descriptions. Nothing is
inferred from the file system — URLs are written out.

```js
// routes/10-pages.mjs
import { getPost, getPosts } from "../lib/posts.js";

export default function register(app, { route, notFound }) {
  app.get("/", route(
    async () => ({
      view: "pages/home",
      metadata: { title: "Home", canonical: "/" },
      data: { posts: getPosts() },
    }),
    { revalidate: 60 }, // keep this HTML for 60 seconds
  ));

  app.get("/blog/:slug", route(async ({ params }) => {
    const post = getPost(params.slug);
    if (!post) notFound();
    return { view: "pages/blog-post", data: { post } };
  }));
}
```

Templates are EJS. Every named export under `views/components/**` becomes a
template local automatically, so components need no imports — they are plain
functions returning HTML strings.

```html
<!-- views/pages/home.ejs -->
<section class="wrapper">
  <h1 class="text-3xl font-bold">Latest posts</h1>
  <% posts.forEach(function (post) { %>
  <%- postCard({ post }) %>
  <% }); %>

  <!-- downloaded and wired up once visible -->
  <div data-island="newsletter"></div>
</section>
```

Islands are modules with a default export that receives their root element.

```js
// client/islands/newsletter.js
export default function newsletter(el) {
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
   `getConfig()`. `redirects()`, `rewrites()`, `headers()` and `cache()` follow
   the subset of `next.config` syntax people actually use. A broken config, a
   throwing `headers()` or a failing hook logs a warning and falls back to
   defaults — it never takes the site down.
2. **Static assets** are served from `public/` with hashed filenames and
   long-lived cache headers, and precompressed `.br` / `.gz` variants are picked
   automatically.
3. **`route()`** wraps your controller. It builds a cache key, checks the HTML
   TTL cache, and on a miss renders the page. When a cached entry is stale it is
   returned immediately while revalidation runs in the background.
4. **Render** composes metadata, layout context and your view into one HTML
   document. Hooks (`metadata`, `layoutContext`, `notFound`, `prewarmPaths`)
   are where application knowledge lives — the framework itself carries none.
5. **Hydration** happens in the browser: the island registry finds
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
- **Islands.** Interactivity attaches to elements carrying `data-island`.
  Modules are dynamically imported on visibility by default;
  `data-island-eager` and `data-island-idle` pick a different strategy. A small
  store handles sharing state between islands.
- **HTML TTL cache.** Per-route `revalidate`, stale-while-revalidate on expiry,
  and prewarm that fills the cache at boot so the first visitor is not the one
  who pays for rendering.
- **Fast navigation.** The `navigation` config section emits Speculation Rules
  to prefetch or prerender links and enables view transitions — without adding
  any client runtime.
- **Familiar configuration.** `redirects()`, `rewrites()`, `headers()`,
  `cache()`, plus `brand`, `images`, `security` and `hooks` sections.
- **A real build pipeline.** Fonts, an SVG sprite generated from the icons you
  actually use, Tailwind v4 CSS, esbuild bundles with code splitting, webp
  variants, hashed output and brotli/gzip precompression.
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
- **No targeted cache invalidation.** There is TTL and there is "clear
  everything".
- **No global state management** beyond the small island store.

If you are building an app-shaped interface behind a login — a dashboard, an
editor, an admin panel — page HTML cannot be cached and this framework is the
wrong tool. The reasoning and a feature-by-feature comparison with Next.js live
in [docs/11-tasima.md](./docs/11-tasima.md).

## Project layout

`jskelet init` scaffolds this shape, and every directory is configurable through
the `paths` section of the config:

```
my-site/
├── jskelet.config.mjs   # config, hooks, headers, redirects
├── routes/              # loaded in filename order (10-, 20-, …)
├── views/
│   ├── pages/           # EJS pages
│   ├── partials/        # header, footer, …
│   └── components/      # named exports become template locals
├── client/
│   ├── entries/main.js  # registers islands, calls start()
│   └── islands/         # one module per island
├── styles/globals.css   # Tailwind entry with @source directives
├── lib/                 # your data access
└── public/              # build output plus static files
```

Two things bite newcomers:

- **Tailwind class scanning follows `@source` directives** in
  `styles/globals.css`, because automatic detection is turned off with
  `source(none)`. A new directory that uses classes needs an `@source` line, or
  its classes silently vanish from the stylesheet.
- **`include` in EJS is async.** `await include('partials/x')` only works in a
  template's own body; inside a `forEach` callback it is a compile error, so use
  a `for` loop there.

## Configuration

`jskelet.config.mjs` exports a single object. Every section is optional.

```js
export default {
  brand: { name: "My Site", lang: "en" },
  icons: { scan: ["views", "client"] },

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
      prewarm: { enabled: true, max: 50, concurrency: 4 },
    };
  },

  hooks: {
    metadata: () => ({ titleTemplate: "%s · My Site", siteUrl: "https://example.com" }),
    layoutContext: ({ pathname }) => ({ pathname, year: new Date().getFullYear() }),
    prewarmPaths: async () => ["/", "/pricing"],
  },
};
```

The complete reference — every field, default and failure mode — is
[docs/07-yapilandirma.md](./docs/07-yapilandirma.md).

## CLI

| Command | What it does |
| --- | --- |
| `jskelet dev` | Watch build plus server, live reload, devtools overlay |
| `jskelet build` | Production build: fonts → sprite → CSS → JS → images → manifest → precompress |
| `jskelet start` | Production server; builds first if output is missing |
| `jskelet init` | Scaffolds a minimal skeleton into the current directory |

## Public API

Only the specifiers in the `exports` map are supported:

| Specifier | Contents |
| --- | --- |
| `jskelet` | `route`, `createApp`, `startServer`, `notFound`, `redirect`, `cache`, `asset`, `getConfig`, HTML cache and prewarm helpers |
| `jskelet/client` | `register`, `registerAll`, `hydrate`, `start`, `createStore`, DOM helpers |
| `jskelet/html` | `attrs`, `cn`, `cx`, `esc`, `jsonScript` |
| `jskelet/tags` | `icon`, `image`, `link`, `preloadImage` |

Anything reachable by a deeper path is internal and may change without notice.

## Deployment

The server is a plain Express 5 app, so anything that can run a Node process
works: a `Dockerfile` (see `examples/marketing/Dockerfile`), a systemd unit, or
a PaaS. Run `jskelet build` at image build time, put a reverse proxy in front
for TLS, and expose a health endpoint (the default dev gate bypass list already
includes `/api/healthcheck`, so a route there is reachable in every mode).
Details, including cache sizing
behind multiple instances, are in [docs/10-dagitim.md](./docs/10-dagitim.md).

## Documentation

The full reference lives under [docs/](./docs/README.md). It is currently
written in Turkish; translations are a welcome contribution.

| Document | Topic |
| --- | --- |
| [01-baslangic](./docs/01-baslangic.md) | Installation, first route, first island, directory layout, CLI |
| [02-mimari](./docs/02-mimari.md) | Decisions and their reasoning, middleware order |
| [03-routing](./docs/03-routing.md) | Route modules, controller contract, load order |
| [04-render-ve-sablonlar](./docs/04-render-ve-sablonlar.md) | Layout, components, helpers, metadata |
| [05-islands](./docs/05-islands.md) | Island contract, hydration, store, DOM helpers |
| [06-cache](./docs/06-cache.md) | TTL, stale-while-revalidate, keys, prewarm |
| [07-yapilandirma](./docs/07-yapilandirma.md) | Complete `jskelet.config.mjs` reference |
| [08-build](./docs/08-build.md) | Build pipeline, manifest, Tailwind `@source`, sprite |
| [09-dev-araclari](./docs/09-dev-araclari.md) | Dev workflow, overlay, report page, dev gate |
| [10-dagitim](./docs/10-dagitim.md) | Production, Docker, reverse proxy, health checks |
| [11-tasima](./docs/11-tasima.md) | Migrating from Next.js: mapping table and plan |

If you work with AI agents, [AGENTS.md](./AGENTS.md) summarizes the rules that
apply to this repository.

## Examples

```bash
npm --prefix examples/minimal   install && npm --prefix examples/minimal   run dev
npm --prefix examples/blog      install && npm --prefix examples/blog      run dev
npm --prefix examples/marketing install && npm --prefix examples/marketing run dev
```

- **`examples/minimal`** — two routes, one component, one island. The smallest
  thing that runs.
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
