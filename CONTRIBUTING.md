# Contributing to JSkelet

Thanks for taking the time to help. This document covers how to set the project
up, what we check before merging, and the architectural rules that a change has
to respect.

By participating you agree to follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug.** Use the bug report template and include your Node version,
  the smallest reproduction you can manage, and whether it happens in `dev`,
  `build` or `start`.
- **Improve the docs.** The reference under [`docs/`](./docs/README.md) is
  written in Turkish. Fixes are welcome, and so are English translations — open
  an issue first so two people do not translate the same file.
- **Send a pull request.** Small, focused changes get reviewed fastest. For
  anything that changes public behaviour, open an issue before writing code so
  we can agree on the approach.

## Setting up

You need **Node.js 22 or newer**.

```bash
git clone https://github.com/ayberkenis/jskelet.git
cd jskelet
npm install
```

Run an example against your working copy to see changes live:

```bash
npm --prefix examples/blog install   # first time only
npm --prefix examples/blog run dev
```

The examples resolve `jskelet` from the repository root, so editing `src/` is
reflected immediately.

## Checks before you open a PR

Lint and unit tests are required; a full build is not.

```bash
npm run lint
npm test
```

If your change affects runtime behaviour, also run one example end to end:

```bash
npm --prefix examples/blog run build
npm --prefix examples/blog run start   # in a second terminal
node examples/blog/smoke.mjs
```

`examples/blog` deliberately exercises every surface of the framework — dynamic
routes, every config section, fragments, forms, prewarm, RSS/sitemap and four
islands — so the smoke test usually catches regressions.

## Architectural rules

These are not style preferences; a change that breaks one of them will be asked
to change.

- **The framework carries no domain knowledge.** Nothing under `src/` may
  contain application-specific URLs, brand names, copy or data shapes.
  Application logic arrives through `hooks` (`metadata`, `layoutContext`,
  `notFound`, `prewarmPaths`); visible names arrive through `brand`.
- **Path resolution happens in one place.** No module counts `../..` to find a
  directory; use `getConfig().dirs`. Relative counting breaks the moment the
  framework lives inside `node_modules/`.
- **A configuration error must not take the site down.** A broken
  `jskelet.config.mjs`, a throwing `headers()` or a failing hook logs a warning
  and falls back to defaults.
- **The server boots without build output.** `asset()` returns the unhashed path
  when there is no manifest and `hasAsset()` returns false, so a forgotten
  `jskelet build` produces an unstyled but working page.
- **Optional dependencies are skipped silently.** `sharp`, `postcss` and
  `@phosphor-icons/core` may be absent. Peer dependencies must be resolved from
  the *application's* `node_modules` using `importFromApp` /
  `tryImportFromApp` in `src/build/resolve-peer.mjs` — never a bare
  `import "postcss"`.
- **Middleware order is a contract.** The numbered comment at the top of
  `src/server/create-app.js` explains the order and the reason for each
  position. If you change it, update the comment too.
- **Cached HTML is identical for everyone.** Nothing personalized may enter a
  page rendered through `route()`. Client-side decisions (theme) stay on the
  client; per-user markup lives in separate fragment endpoints marked
  `no-store`.

Before touching a subsystem, read the document that records why it works the way
it does — most "obvious improvements" are already discussed there:

| Area | Read first |
| --- | --- |
| `src/server/render.js`, templates | [04-render-ve-sablonlar.md](./docs/04-render-ve-sablonlar.md) |
| `src/server/html-cache.js`, `route()` | [06-cache.md](./docs/06-cache.md) |
| `src/server/create-app.js`, middleware | [02-mimari.md](./docs/02-mimari.md) |
| `src/client/**` | [05-islands.md](./docs/05-islands.md) |
| `src/build/**` | [08-build.md](./docs/08-build.md) |
| `src/config/**` | [07-yapilandirma.md](./docs/07-yapilandirma.md) |
| `src/dev-server.mjs`, `src/server/dev/**` | [09-dev-araclari.md](./docs/09-dev-araclari.md) |

## Code style

- **Plain JavaScript with JSDoc.** No TypeScript, no React. Every exported
  function documents its parameters and return type.
- **Comments are written in Turkish and explain *why*.** Do not restate what the
  code does; record a decision, a trade-off or a trap.
- Server and build code uses `node:`-prefixed core modules.
- `src/client/**` runs in the browser: no Node APIs, no `process` (other than
  `clientEnv`, which is substituted at build time), no synchronous network.
- **Tailwind class scanning follows `@source` directives** in
  `styles/globals.css`; automatic detection is off (`source(none)`). A new
  directory that uses classes needs an `@source` line or its classes silently
  disappear.
- **`include` in EJS is async.** `await include('partials/x')` works only in a
  template's own body; inside a `forEach` callback it is a compile error, so use
  a `for` loop.
- Every value that reaches a template must go through `<%= %>` or `esc()`.
  `<%- %>` is only for HTML you know is safe.

## Adding a public surface

If you export something new, update all of these together:

1. `package.json` → `exports`
2. the barrel: `src/index.js` or `src/client/index.js`
3. the relevant document under `docs/`
4. the examples, if the change alters an existing signature

Documentation may only use specifiers from the `exports` map: `jskelet`,
`jskelet/client`, `jskelet/html`, `jskelet/tags`.

Changing a general surface (`route()` signature, hook names, config fields,
client API) means updating `examples/minimal`, `examples/blog` and
`examples/marketing` as well. The examples are the source of the snippets in the
docs and the fastest place to notice drift.

## Commits and pull requests

- Write commit subjects in the imperative mood: `fix stale cache entry on 404`.
- Keep unrelated changes in separate commits.
- Do not commit build output. `public/assets/**` and `.jskelet/**` inside the
  examples are generated.
- In the PR description, say what changed, why, and how you verified it. Fill in
  the checklist in the template.

## Working on Windows

This project is developed on Windows, and two traps come up repeatedly:

- `--import` expects a module specifier. An absolute path like `H:\...` is read
  as a URL with the scheme `h:` and rejected; use `pathToFileURL(...).href`.
- `fs.watch` can emit events for neighbouring files when one file is written.
  The dev server therefore filters events by comparing `mtime`. Do not remove
  that filter when changing watcher logic.

## Reporting a security issue

Do not open a public issue. Follow [SECURITY.md](./SECURITY.md).
