# JSkelet documentation

JSkelet is a framework that "feels frameworkless", built for SEO- and
speed-focused sites: it produces complete HTML on the server with Express 5 +
EJS, adds interactivity with vanilla JS islands, compiles CSS into a single
stylesheet with Tailwind v4, and instead of ISR uses an HTML TTL cache that
lives in process memory with stale-while-revalidate. No React, no TypeScript;
plain JavaScript and JSDoc.

This directory is the full reference for the framework. To read it in order,
start from the beginning; if you are looking for a specific topic, go straight
to the relevant entry.

## Read in order

| Document | Topic |
| --- | --- |
| [01-getting-started.md](./01-getting-started.md) | Installation, `jskelet init`, first route, first island, directory structure, CLI commands |
| [02-architecture.md](./02-architecture.md) | Architectural decisions and their rationale: the island model, complete server HTML, cache strategy, middleware order |
| [03-routing.md](./03-routing.md) | The route module contract, load order, the controller contract, `ctx`, `notFound`/`redirect`, config redirects/rewrites |
| [04-rendering.md](./04-rendering.md) | EJS layout, pages, automatic component registration, `html`/`tags` helpers, metadata → `<head>`, hooks |
| [05-islands.md](./05-islands.md) | The `data-island` contract, hydration strategies, `client/entries/*`, `createStore`, DOM helpers, `startSafeImages` |
| [06-caching.md](./06-caching.md) | `withHtmlCache`, `revalidate`, stale-while-revalidate, the cache key, `X-JSkelet-Cache`, in-request cache, degraded render, prewarm |
| [07-configuration.md](./07-configuration.md) | Full `jskelet.config.mjs` reference, the `source` pattern syntax, environment variable table |
| [08-build.md](./08-build.md) | The build pipeline, the manifest, hashed assets, CSS/Tailwind `@source`, fonts, icon sprite, image optimization, precompress |
| [09-dev-tools.md](./09-dev-tools.md) | The `jskelet dev` flow, watch directories, CSS hot-swap, devtools overlay (Alt+D), the report page, the dev gate |
| [10-deployment.md](./10-deployment.md) | Prod build + start, environment variables, Docker, reverse proxy, health check |
| [11-migration.md](./11-migration.md) | Migrating from Next.js: the equivalence table and a step-by-step plan |

## Quick access by topic

- **How do I add a page?** → [03-routing.md](./03-routing.md) and
  [04-rendering.md](./04-rendering.md)
- **I want something to happen when a button is clicked** →
  [05-islands.md](./05-islands.md)
- **Why is the page returning `MISS` / why am I seeing stale data?** →
  [06-caching.md](./06-caching.md)
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
`robots.txt`/`sitemap.xml`/`rss.xml` and four islands (theme, tabs, search,
form).

```bash
npm --prefix examples/blog install
npm --prefix examples/blog run dev
```

**`examples/marketing/`** — the framework's own marketing site: hero, comparison
table, live latency measurement, FAQ, docs index, release notes and a download
page. The byte counts on the page are read in `lib/payload.js` from the site's
**own** build output, and the release info in `lib/release.js` from the
installed package's `package.json`; the latency numbers are measured in the
browser by the `latency` island. With a long TTL (one hour) and a prewarm that
warms every page, it shows the profile in which the cache works most
efficiently.

The site is also **bilingual**: English by default at the root, Turkish under
`/tr`, with the same route names in both languages. There is no i18n in the
framework; language resolution lives in `lib/i18n.js` as the application's own
contract and is wired to a dictionary via `hooks.layoutContext`. This is the
place to look if you want to see how to build a multilingual site with this
surface.

```bash
npm --prefix examples/marketing install
npm --prefix examples/marketing run dev
```

In all three examples, `node smoke.mjs` verifies that the endpoints respond as
expected while the server is up.
