# JSK for VS Code / Cursor

Syntax highlighting, diagnostics, component completions, and snippets for
[JSkelet](https://github.com/ayberkenis/jskelet) `.jsk` templates.

## Install

From the VS Code / Cursor Extensions view, search for **JSK** (publisher
`ayberkenis`), or:

```bash
code --install-extension ayberkenis.jsk
```

Local / repo checkout:

```bash
code --install-extension extensions/vscode-jsk
```

To try changes without installing, open this folder and press **F5**, or from
the monorepo root use the **JSK: Extension** launch config.

## Features

- Language id `jsk` for `*.jsk`
- Highlighting for `{{ }}` / `{{{ }}}`, `{#if}` / `{#each}` / `{#include}`,
  `{# … #}` comments, PascalCase components, and `:prop` bindings on HTML tags
- On open / save (and debounced edit): compiler diagnostics in Problems
- Completions for built-ins (`Link`, `Stylesheets`, …) and named exports under
  `views/components` (including `features/*/views/components`)
- Snippets: `if`, `ifel`, `each`, `eachi`, `inc`, `var`, `raw`, `cmt`, `comp`,
  `Link`, `Image`, `island`

## Not yet

Go-to-definition, hover docs, formatting, and a full language server are still
deferred.

## Package / publish

From this folder (requires a [Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) with Marketplace publish scope):

```bash
npx @vscode/vsce package
npx @vscode/vsce publish
```

`vscode:prepublish` syncs `src/compile` into `vendor/compile` so the VSIX is
standalone.
