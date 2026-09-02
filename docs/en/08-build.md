# 08 — Build

This document describes every job `jskelet build` does and the order it does them
in: font copying, icon sprite generation, Tailwind CSS compilation, the island
bundle via esbuild, image optimisation, writing the manifest and precompression.
It also covers how hashed assets reach the templates through
`asset()`/`hasAsset()`, why Tailwind's `@source` directives are mandatory and how
optional peer dependencies behave. How the output is served at runtime is in
[02-architecture.md](./02-architecture.md), and the watch flow that triggers the
build is in [09-dev-tools.md](./09-dev-tools.md).

## The pipeline and its order

```
0. Templates      .jsk → .jskelet/templates/*.mjs (always; no-op if none)
1. Fonts          if config.fonts is set
2. Icon sprite    if config.icons !== false
3. CSS            if the styles entry file exists
4. Client JS      if client/entries/ exists
5. Images         if config.images !== false, not watch, and sharp is installed
6. Manifest       .jskelet/manifest.json
7. Precompress    if not watch
```

Template compilation finishes **before** asset scanning; there is no parse on
the request path. Tailwind `@source` and the icon scan read source `.jsk` files
(not the generated `.mjs`).

The order is not arbitrary:

- **CSS comes after the icon sprite.** The sprite is an asset and produces no
  classes, but it does give a manifest key.
- **Precompress is last:** everything that gets compressed must already be
  produced.
- **Images never run on a watch pass:** re-encoding with `sharp` is expensive.

Tasks only run if the relevant configuration exists. A project that does not
define any fonts never sees the font step; this is the build-side counterpart of
the principle that "the framework does not impose its own assumptions on every
project".

The terminal output gives aligned step lines and an `output` block at the end:
the raw and brotli size of every asset, largest to smallest.

## The manifest and hashed assets

The build output is written under `public/assets/` with **content-hashed** names,
and the logical name → public URL mapping is put in the `.jskelet/manifest.json`
file:

```json
{
  "app.css": "/assets/app.4f2a1b9c07.css",
  "sprite.svg": "/assets/sprite.dc973997bd.svg",
  "main.js": "/assets/js/main.9E1AB2C3.js",
  "inter-400.woff2": "/fonts/inter-400.woff2"
}
```

The hash is the first 10 hex characters of sha256: more than enough against
collisions and it keeps file names readable. Because they are hashed, these files
can be given `Cache-Control: public, max-age=31536000, immutable`.

### `asset(name)` and `hasAsset(name)`

They are passed to templates automatically; in server code,
`import { asset, hasAsset } from "jskelet"`.

```ejs
<% if (hasAsset('app.css')) { %>
<link rel="stylesheet" href="<%= asset('app.css') %>">
<% } %>
```

- `asset(name)` returns the hashed URL if it is in the manifest, otherwise
  `/assets/<name>`.
- `hasAsset(name)` tells you whether it is in the manifest.

If the build has not run, the application still comes up: `hasAsset()` is false
and the layout never emits the stylesheet and script tags. When `jskelet build`
is forgotten you get an unstyled but working page instead of an error. If the
manifest is missing entirely, a warning is printed once:
``[assets] no manifest — run `jskelet build`.``

The manifest is re-read **on every request in dev** (watch builds change the
hashes) and once in prod.

### Manifest consistency in watch mode

On a watch pass, a recompiled asset is written to a new hash and the old one is
deleted. That is why the manifest has to be updated too (`patchManifest`):
otherwise the HTML asks for the deleted file, gets a 404, and the page stays
unstyled or JS-less for the rest of the dev session. Both the CSS and the client
tasks patch their own key on every pass; the other keys are preserved.

## CSS — Tailwind v4

The entry file is `paths.styles` (default `styles/globals.css`). If the file does
not exist, the step is skipped with a warning.

The pipeline: PostCSS + `@tailwindcss/postcss` → minification with lightningcss
(if present) → `writeAsset("app.css", …)`.

- **The PostCSS pipeline is set up once:** Tailwind's own cache lives in the
  plugin instance; recreating it on every compile slows watch passes down
  noticeably.
- **lightningcss is optional:** without it, Tailwind's own output is used, and it
  is only a few kB bigger.
- The output is a single file and the layout loads it render-blocking. The
  measurement-based reasoning for not producing a separate "critical CSS" is in
  [02-architecture.md](./02-architecture.md).

### `@source` directives are mandatory

Tailwind v4's class scanning depends on the `@source` directives inside
`globals.css`. Automatic detection only scans the directory the stylesheet lives
in, so the variants used in templates (things like `data-[active=false]:…`) get
**silently dropped**.

```css
@import "tailwindcss" source(none);

@source "../views";
@source "../client";
@source "../routes";

.wrapper {
  max-width: 48rem;
  margin-inline: auto;
  padding-inline: 1rem;
  padding-block: 2rem;
}
```

`source(none)` turns automatic detection off and makes the scanning fully
explicit. **When you add a new top-level directory, add the `@source` line as
well** — this is the most common reason for classes "sometimes not working".

### CSS watch scope

In watch mode three targets are watched: the directory the stylesheet lives in,
`views` and `client`. Template and island files are watched too because the
Tailwind classes come from there; watching only `styles/` would not rebuild when
a new utility is written. Changes are coalesced over 120 ms.

## Client JS — esbuild

Every `.js` file inside `client/entries/*.js` is an entry. If the directory does
not exist or is empty, the step is skipped.

esbuild settings:

| Setting | Value | Reason |
| --- | --- | --- |
| `bundle`, `splitting` | `true` | Shared modules move into a shared chunk |
| `format` | `esm` | `type="module"` scripts |
| `target` | `chrome111`, `edge111`, `firefox111`, `safari16.4` | The lower bound of the ESM + dynamic import + `IntersectionObserver` island model; transpiling to anything older grows the output without winning a single visitor |
| `minify` | `true` | — |
| `sourcemap` | `true` | Diagnostics in the browser |
| `entryNames` | `[name].[hash]` | `immutable` cache |
| `chunkNames` | `chunks/[name].[hash]` | — |
| `legalComments` | `none` | — |

The output lands under `public/assets/js/` and is cleaned first on every pass.
`browserslist` is not read; the target list is hard-coded.

### The `@/` alias

On the esbuild side, `@/` resolves to the project root and extension completion
is performed (`.js`, `.mjs`, `.json`, `/index.js`). The same behaviour as
`alias-hooks.mjs` on the Node side, so the modules under `lib/` can use the same
import style both on the server and in the browser.

### Inlining `clientEnv`

There is no `process` in the browser; modules shared with the server still read
`process.env`. The keys declared through `config.clientEnv` plus `NODE_ENV` are
defined as a single object at build time, which means that reading a key not in
the list returns `undefined` instead of crashing. Details:
[07-configuration.md](./07-configuration.md).

### Manifest keys

Only **real entries** go into the manifest: dynamic imports also carry an
`entryPoint`, and if they were not filtered out every island would become a
separate manifest key. The key is the file name itself (`main.js`, `chart.js`),
the value is the hashed URL.

That is why a controller writing `entries: ["chart.js"]` does not have to know
the hash ([05-islands.md](./05-islands.md)).

### `metafile.json`

The esbuild metafile is written to the `.jskelet/metafile.json` file; the chunk
analysis in the dev panel reads the input/output breakdown from there. If the
write fails, the build does not go down — the analysis data is best-effort. **The
runtime does not depend on this file.**

## Fonts

Self-hosted font files instead of `next/font/google`.

The files sit under `public/fonts/` with **fixed names** (no hash), because the
`url()` paths inside `@font-face` are written by hand; hashing them would force
the stylesheet to change on every build too.

If a file is missing, it is downloaded from Google Fonts **once** and is
**expected to be committed**: having the build depend on the network is fragile
in CI. If the download fails, a warning is printed and the page falls back to the
system font stack — the build does not stop.

Only the latin subset (`U+0000-00FF`) is downloaded: the others are dead weight
for most sites, and without `unicode-range` downloading all of them multiplies
the font size.

Usage is written by hand in the stylesheet:

```css
@font-face {
  font-family: "Inter";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/inter-400.woff2") format("woff2");
}
```

Because the `.woff2` extension and the `/fonts/` prefix are in the default
`static` rules, these files automatically get an `immutable` cache.

## Icon sprite

From the individual SVGs inside `@phosphor-icons/core`, it produces a `<symbol>`
set for **only the icons actually used in the source**. Shipping the whole set
means 1500+ icons, i.e. several megabytes; usage scanning typically keeps the
sprite at 10-30 symbols.

- Symbol id: `<kebab-name>-<weight>`, e.g. `arrow-right-bold`.
- The package is resolved from the **application's** `node_modules` (the icon set
  is the application's devDependency); if it is not installed, the step is
  silently skipped.
- The scanned directories default to `views`, `client`, `routes`, `lib`; they can
  be changed with `icons.scan`. Scanned extensions: `.ejs`, `.js`, `.mjs`.
- Weights: `thin`, `light`, `regular`, `bold`, `fill`, `duotone`. An
  unrecognised weight counts as `regular`.

### What the scan finds

| Form in the source | Is it found |
| --- | --- |
| `icon({ name: "ArrowRight", weight: "bold" })` | ✓ name + weight |
| `icon({ name: cond ? "A" : "B" })` | ✓ both constant names |
| `data-icon="flag:fill"` or `"data-icon": "flag:fill"` | ✓ |
| `icon: "XLogo"` / `iconName: "XLogo"` (in configuration lists) | ✓ name; weights are the ones collected from indirect calls |
| `icon({ name: item.icon })` | ✗ the name is not statically visible |

There are two safety nets for the last row: configuration fields that carry a
name (`icon: "XLogo"`) are also searched, and in development `icon()` reads the
symbols in the sprite and prints a one-off warning for a missing one:

```
[icon] missing from sprite: x-logo-regular — write the name as a literal or add
it to the build/tasks/icons.mjs scan.
```

If you see this warning, either write the name as a constant, or add the relevant
directory to the `icons.scan` list, or keep the name in a configuration field in
the form `icon: "XLogo"`.

Names that cannot be found in Phosphor are warned about as a summary at the end
of the build: `N icons missing → …`

## Image optimisation

The build-time counterpart of the `next/image` optimizer. For the png/jpg files
placed by hand under `public/`, it produces webp at a few widths and writes them
to the `.jskelet/images.json` manifest. `image()` looks at that manifest and adds
`srcset` plus intrinsic `width`/`height`; the calling side changes nothing
([04-rendering.md](./04-rendering.md)).

- The outputs land hashed under `public/assets/img/`, which means they fall
  within the scope of the `immutable` cache and precompression.
- **The source files stay where they are:** an image not in the manifest is
  always served as the original.
- The `assets` and `fonts` directories are always skipped; additional ones with
  `images.skip`.
- The widths are used with the ones larger than the source dropped, and the
  source's own width (at most 1920) always makes it into the list. Above 1920 is
  wasteful even on retina screens.
- The variant hash is derived from the **source + the width**: the same content
  gives the same file name on every build, so the `immutable` cache does not go
  stale.
- The encoder signature is written into the manifest (`webp-q78-e4`). When the
  quality setting changes, the signature changes with it and every image is
  re-encoded; otherwise outputs produced with the old setting would silently
  remain.
- If the source has not changed and the outputs are still in place, nothing is
  re-encoded. In a large `public/` directory this brings the build time down from
  minutes to seconds.
- A single corrupt/unreadable image does not bring the build down: a warning is
  printed and, because it is not in the manifest, the original file continues to
  be served.
- Old outputs that no longer appear in the manifest are deleted.

This step requires `sharp`. If it is not installed the step is silently skipped
and `image()` falls back to the original file. It never runs on a watch pass.

## Precompress

Produces brotli (quality 11) and gzip (level 9) copies of the built assets:
`app.<hash>.css.br`, `app.<hash>.css.gz`, …

- Only `public/assets/` is covered: the files there are hashed and `immutable`,
  meaning their contents never change and recompressing them on every request is
  wasted CPU. Compressing once at build time with quality 11 both zeroes out the
  server load and gives a ratio you could never afford at runtime (as against
  quality 5 at request time).
- Files placed by hand under `public/` are left to runtime compression, because
  they are small and requested rarely.
- Compressed extensions: `.css`, `.js`, `.mjs`, `.svg`, `.json`, `.xml`,
  `.txt`, `.map`. Already-compressed formats (woff2, png, jpg, webp) are skipped.
- Files under 1 KB are skipped: the gain does not cover the header cost.
- `.br`/`.gz` copies left over from the previous pass are deleted first, so they
  cannot go stale.
- It does not run in watch mode: quality-11 brotli on every change is slow.

These files are served by the `staticPrecompressed` middleware; if there is no
copy, the request is handed over to `express.static`
([02-architecture.md](./02-architecture.md)).

## Optional peer dependencies

| Package | The step that needs it | What happens without it |
| --- | --- | --- |
| `postcss` | CSS | The CSS step **throws** (a required import) |
| `@tailwindcss/postcss` | CSS | The CSS step **throws** |
| `tailwindcss` | CSS (peer) | Tailwind directives cannot be resolved |
| `lightningcss` | CSS minification | Tailwind's output is used, a few kB bigger |
| `sharp` | Image optimisation | The step is skipped; `image()` uses the original |
| `@phosphor-icons/core` | Icon sprite | The step is skipped; `icon()` produces an empty `<use>` |

If you are not going to use CSS, simply never create the `paths.styles` file: the
step is skipped with a warning and postcss is not needed.

The packages are resolved from the **application's** `node_modules`, not the
framework's own. If the framework is installed via a `file:` or workspace link,
its source files run in their own directory and a plain `import "postcss"` looks
at the framework's tree — not yours. That is why resolution is started from the
application root.

## Suggested `.gitignore`

```
node_modules/
.jskelet/
public/assets/
.env
```

`public/fonts/` **should be committed** (so the build does not depend on the
network), `public/assets/` should not be (it is regenerated on every build).

## `jskelet start` and a missing build

`jskelet start` first looks at the `.jskelet/manifest.json` file; if it is
missing, it runs the build itself. In a Docker image the build has already
happened so this is a no-op; the point is that someone running `npm start`
directly does not end up facing an unstyled page.

## Diagnostics: common situations

- **No styles at all.** The build has not run (`hasAsset('app.css')` is false) or
  the `paths.styles` file does not exist. Check the `CSS` line in the build
  output.
- **Some Tailwind classes do not work.** They were written in a directory whose
  `@source` directive is missing.
- **An icon looks empty.** That symbol is not in the sprite; in dev, look for the
  `[icon] missing from sprite` warning.
- **The islands never open.** `main.js` is not in the manifest (the entry
  directory is empty or the build was skipped) or there is a build error.
- **The page suddenly went unstyled in dev.** The manifest and the file on disk
  have diverged; restarting `jskelet dev` is enough.

## What's next

- The watch flow and CSS hot-swap: [09-dev-tools.md](./09-dev-tools.md)
- Prod build + start and Docker: [10-deployment.md](./10-deployment.md)
- Using `entries` and the island bundle: [05-islands.md](./05-islands.md)
