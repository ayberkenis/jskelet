# 01 — Getting started

This document explains how to get JSkelet running from scratch: installing the
package, scaffolding the skeleton with `jskelet init`, writing your first route
and your first island, what the resulting directory layout means, and the CLI's
four commands. By the end you will have a page in the browser that is rendered
on the server, cached, and whose island hydrates on visibility. For the
*reasons* behind the decisions see
[02-architecture.md](./02-architecture.md), and for the full reference of every
config field mentioned here see
[07-configuration.md](./07-configuration.md).

## Requirements

- **Node.js 22 or newer.** `package.json` → `engines` enforces this. The
  framework uses new Node surfaces such as `node:async_hooks`,
  `fs.readdirSync(..., { recursive: true })`, `--env-file-if-exists` and
  `module.register()` directly.
- If you are going to use Tailwind CSS, the `postcss`, `@tailwindcss/postcss`
  and `tailwindcss` packages. These are **optional peer dependencies** of the
  framework; if they are not installed the CSS step is skipped and the site
  stays unstyled but working (details: [08-build.md](./08-build.md)).

## Installation

```bash
mkdir benim-sitem && cd benim-sitem
npm init -y
npm pkg set type=module
npm install jskelet
npm install -D postcss @tailwindcss/postcss tailwindcss lightningcss
```

`type: "module"` is required: route modules, components and the config file are
loaded as ESM.

Then add the scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "jskelet dev",
    "build": "jskelet build",
    "start": "jskelet start"
  }
}
```

## `jskelet init`

```bash
npx jskelet init
```

This command installs a working minimal skeleton into the directory you are in.
It **does not overwrite existing files**: running it a second time only fills in
what is missing and prints the number of skipped files as a warning. The goal is
to skip the "I installed it but nothing works" stage entirely — `jskelet dev`
runs right afterwards.

The files it creates:

```
jskelet.config.mjs          config: brand, preconnect, cache(), hooks
routes/10-pages.mjs         the "/" route
views/pages/home.ejs        home page template
views/pages/not-found.ejs   404 template
views/components/button.js  example component (a function returning an HTML string)
client/entries/main.js      island bootstrap
client/islands/counter.js   example island
styles/globals.css          Tailwind entry + @source directives
jsconfig.json               checkJs + the "@/*" alias
.gitignore                  node_modules/, .jskelet/, public/assets/, .env
```

Then:

```bash
npm run dev
```

In the terminal you will see a banner, aligned build lines and a `Ready`
summary; `http://localhost:3000` serves the page. A dev overlay bubble sits in
the bottom right corner, opened with `Alt+D`
([09-dev-tools.md](./09-dev-tools.md)).

## Directory layout

None of the directory names are fixed; all of them can be overridden via
`jskelet.config.mjs` → `paths`. The values below are the defaults
(`src/config/defaults.js`).

| Directory | Default | Contents |
| --- | --- | --- |
| `views` | `views` | EJS layout, pages and components |
| `public` | `public` | Static files; build output is written here too |
| `client` | `client` | Island runtime sources and entries |
| `routes` | `routes` | Route modules |
| `styles` | `styles/globals.css` | Tailwind/PostCSS entry **file** |
| `generated` | `.jskelet` | Intermediate build output: `manifest.json`, `metafile.json`, `images.json` |

In addition to these the framework always derives two paths and accepts no
separate setting for them: `public/assets` (hashed build output) and
`public/fonts` (self-hosted fonts).

A typical project:

```
benim-sitem/
├── jskelet.config.mjs
├── jsconfig.json
├── routes/
│   ├── 10-pages.mjs
│   └── 90-catch-all.mjs
├── views/
│   ├── layout.ejs
│   ├── pages/
│   │   ├── home.ejs
│   │   └── not-found.ejs
│   └── components/
│       └── card.js
├── client/
│   ├── entries/
│   │   └── main.js
│   └── islands/
│       └── counter.js
├── styles/
│   └── globals.css
├── public/
│   └── (static files; build → public/assets)
└── .jskelet/
    └── manifest.json
```

## Your first route

Route modules **do not derive URLs automatically from the file system**; every
module writes its own paths explicitly with `app.get(...)`. The module contract:
a default export or a named export called `register`, with the signature
`(app, api)`.

```js
// routes/10-pages.mjs
export default function register(app, { route }) {
  app.get(
    "/",
    route(
      async () => ({
        view: "pages/home",
        metadata: { title: "Ana sayfa" },
        data: { heading: "JSkelet çalışıyor", items: ["Bir", "İki"] },
      }),
      { revalidate: 60 },
    ),
  );
}
```

The `api` object comes with `route`, `renderView`, `renderPage`, `notFound`,
`redirect` and `permanentRedirect` ready to use, so route files don't have to
import them one by one from the framework. `route()` wraps the controller: the
HTML cache, the notFound/redirect control flow, compression and the
`X-JSkelet-Cache` header all come from it. The controller's only job is to
return a page definition.

The `10-` prefix in the file name determines the load order. Because `routes/`
is scanned alphabetically, you should put catch-all routes such as `/:slug` in a
file with a higher number; otherwise `/hakkinda` will be mistaken for a slug.
Details: [03-routing.md](./03-routing.md).

The template side is plain EJS:

```ejs
<%# views/pages/home.ejs %>
<section class="wrapper">
  <h1 class="text-3xl font-bold"><%= heading %></h1>
  <%- list({ items }) %>
  <div data-island="counter" data-island-props='{"start":5}'></div>
</section>
```

Here `list` is a function defined in `views/components/list.js` and it has not
been imported: every named export under `views/components/**` automatically
becomes a template local ([04-rendering.md](./04-rendering.md)).

## Your first island

An island is a small module that adds behaviour to the HTML the server
produced. The contract has two parts.

**1. A marker in the template:** give an element `data-island="ad"`. Props are
carried as JSON inside `data-island-props`.

```ejs
<div data-island="counter" data-island-props='{"start":5}'></div>
```

**2. A `mount` in the module:** the island provides a named export called
`mount(element, props)`.

```js
// client/islands/counter.js
/**
 * @param {HTMLElement} element
 * @param {{ start?: number }} props
 */
export function mount(element, props) {
  let value = props.start ?? 0;

  const button = document.createElement("button");
  button.type = "button";

  const paint = () => {
    button.textContent = `Tıklama: ${value}`;
  };

  button.addEventListener("click", () => {
    value += 1;
    paint();
  });

  paint();
  element.append(button);
}
```

**3. Registration:** `client/entries/main.js` maps the island name to a dynamic
import and starts the runtime.

```js
import { registerAll, start } from "jskelet/client";

registerAll({
  counter: () => import("../islands/counter.js"),
});

start();
```

It is critical that the values are dynamic imports: the module is downloaded
only if that island actually exists on the page **and** when the element becomes
visible. In other words, growing this map does not grow the initial payload.
Hydration strategies (`data-island-eager`, `data-island-idle`) and the complete
runtime API are in [05-islands.md](./05-islands.md).

## CLI commands

`bin/jskelet.mjs` offers four subcommands. Each runs in a separate Node process;
the reason is that `dev` manages two long-lived processes and the server needs
ESM resolve hooks (`--import`) at process start.

| Command | What it does |
| --- | --- |
| `jskelet dev` | Build watch + server, in a single terminal. Live reload, CSS hot-swap, dev overlay. `NODE_ENV=development`. |
| `jskelet build` | One-shot prod build: fonts → icon sprite → CSS → client JS → images → manifest → precompress. `production` if `NODE_ENV` is not given. |
| `jskelet start` | Prod server. If there is no build output it produces it first. `production` if `NODE_ENV` is not given. |
| `jskelet init` | Installs a minimal skeleton into the current directory; leaves existing files alone. |

An unknown command, or a call with no arguments, prints the usage text.

Every command runs with two Node flags:

- `--env-file=.env` — passed only if the file really exists; otherwise no flag
  is added and no warning is printed.
- `--import <register.mjs>` — installs the ESM hooks that resolve the
  `compilerOptions.paths` aliases (`@/lib/x`) from `jsconfig.json` /
  `tsconfig.json` and extensionless relative imports (`./cache` →
  `./cache.js`). (`jskelet dev` installs these hooks in its own child
  processes, not in the outer process.)

## Import paths

The `package.json` → `exports` map defines the stable surface. In examples, use
only these specifiers:

| Specifier | Contents |
| --- | --- |
| `jskelet` | Server API: `route`, `renderPage`, `renderView`, `renderNotFound`, `createApp`, `startServer`, `notFound`, `redirect`, `permanentRedirect`, `cache`, `withRequestCache`, `reportUpstreamFailure`, `asset`, `hasAsset`, `optimizedImage`, `getSpriteIds`, `headHints`, `renderHeadMeta`, HTML cache functions, `prewarm`, `createProxy`, `getConfig`, `loadConfig` and the html/tag helpers |
| `jskelet/server` | The same module as `jskelet` (an alias for readability) |
| `jskelet/client` | Browser runtime: `register`, `registerAll`, `hydrate`, `observeDocument`, `start`, `createStore`, DOM helpers, `startSafeImages` |
| `jskelet/html` | `esc`, `attrs`, `cx`, `cn`, `jsonScript` |
| `jskelet/tags` | `link`, `image`, `icon`, `preloadImage`, `toKebab` |
| `jskelet/log` | Console output helpers (`banner`, `event`, `task`, `size`, `ms`, …) |
| `jskelet/register` | Alias + extension hooks via `node --import jskelet/register` |
| `jskelet/layout` | The path to the framework's default `layout.ejs` file |

## What's next

- Why it works this way: [02-architecture.md](./02-architecture.md)
- More routes and catch-all patterns: [03-routing.md](./03-routing.md)
- Taking over the layout, and metadata: [04-rendering.md](./04-rendering.md)
- Tuning the cache: [06-caching.md](./06-caching.md)
