# JSkelet documentation

JSkelet is a framework that "feels frameworkless", built for SEO- and
speed-focused sites: it produces complete HTML on the server with Express 5 +
build-time `.jsk` (EJS is an optional legacy peer), adds interactivity with
vanilla JS islands, compiles CSS into a single stylesheet with Tailwind v4, and
instead of ISR uses an HTML TTL cache that lives in process memory with
stale-while-revalidate. No React; the framework source is plain JavaScript with
JSDoc. Apps may write client islands and entries in TypeScript, and the
published package ships declaration files.

This directory is the full reference for the framework. To read it in order,
start from the beginning; if you are looking for a specific topic, go straight
to the relevant entry.

The Turkish edition of the same documents lives one directory up, in
[`docs/`](../README.md). Both editions are kept in sync by hand, so if you
change one, change the other.

## Read in order

| Document | Topic |
| --- | --- |
| [01-getting-started.md](./01-getting-started.md) | Installation, `jskelet init`, first route, first island, directory structure, CLI commands |
| [02-architecture.md](./02-architecture.md) | Architectural decisions and their rationale: the island model, complete server HTML, cache strategy, middleware order |
| [03-routing.md](./03-routing.md) | The route module contract, load order, the controller contract, `ctx`, `notFound`/`redirect`, config redirects/rewrites |
| [04-rendering.md](./04-rendering.md) | `.jsk` layout/pages, automatic component registration, `html`/`tags`, metadata → `<head>`, hooks; EJS legacy |
| [05-islands.md](./05-islands.md) | The `data-island` contract, hydration strategies, `client/entries/*`, `createStore`, DOM helpers, `startSafeImages` |
| [06-caching.md](./06-caching.md) | `withHtmlCache`, `revalidate`, stale-while-revalidate, the cache key, `X-JSkelet-Cache`, in-request cache, degraded render, prewarm |
| [07-configuration.md](./07-configuration.md) | Full `jskelet.config.mjs` reference, the `source` pattern syntax, environment variable table |
| [08-build.md](./08-build.md) | The build pipeline, the manifest, hashed assets, CSS/Tailwind `@source`, fonts, icon sprite, image optimization, precompress |
| [09-dev-tools.md](./09-dev-tools.md) | The `jskelet dev` flow, watch directories, CSS hot-swap, devtools overlay (Alt+D, SEO highlight), the report page, the dev gate |
| [10-deployment.md](./10-deployment.md) | Prod build + start, environment variables, Docker, reverse proxy, health check |
| [11-migration.md](./11-migration.md) | Migrating from Next.js: the equivalence table and a step-by-step plan |
| [12-dashboards-and-sessions.md](./12-dashboards-and-sessions.md) | Per-visitor pages: `private: true`, signed cookie sessions, CSRF, `fragment()`, swapping regions and the form loop |

## Quick access by topic

- **How do I add a page?** → [03-routing.md](./03-routing.md) and
  [04-rendering.md](./04-rendering.md)
- **I want something to happen when a button is clicked** →
  [05-islands.md](./05-islands.md)
- **Why is the page returning `MISS` / why am I seeing stale data?** →
  [06-caching.md](./06-caching.md)
- **How do I write a page that depends on the session?** →
  [12-dashboards-and-sessions.md](./12-dashboards-and-sessions.md)
- **What does each config field do?** → [07-configuration.md](./07-configuration.md)
- **Styles are missing / icons don't show up** → [08-build.md](./08-build.md)
- **Going live** → [10-deployment.md](./10-deployment.md)

## Runnable examples

All three are in working order; most of the examples in the docs were taken from
them.

**`examples/minimal/`** — two routes, one component, one island, minimal config.
The smallest working form of the framework.

```bash
npm --prefix examples/minimal install
npm --prefix examples/minimal run dev
```

**`examples/blog/`** — a dynamic route (`/blog/:slug`), tag pages, the whole of
the `redirects`/`rewrites`/`headers`/`cache` configuration, tab panels arriving
as fragments, form submission, prewarm,
`robots.txt`/`sitemap.xml`/`rss.xml`, dynamic OG images (`/og/blog/:slug.png`)
and four islands (theme, tabs, search, form).

```bash
npm --prefix examples/blog install
npm --prefix examples/blog run dev
```

**`examples/dashboard/`** — the opposite axis from the other two: per-visitor
pages. Sign-in with a signed cookie session, a `private: true` protected panel,
a paginated table fragment, a CSRF-protected mutation form and an island that
returns a cleanup function. It also has a public landing page, so a cached
response and a `no-store` one sit side by side in the same application.

```bash
npm --prefix examples/dashboard install
npm --prefix examples/dashboard run dev
```

In all three examples, `node smoke.mjs` verifies that the endpoints respond as
expected while the server is up.
