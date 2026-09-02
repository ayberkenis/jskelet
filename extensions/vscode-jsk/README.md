# JSK for VS Code / Cursor

Syntax highlighting, language configuration, and snippets for [JSkelet](https://github.com/ayberkenis/jskelet) `.jsk` templates.

## Install (local / this repo)

From the repository root:

```bash
code --install-extension extensions/vscode-jsk
```

Or in Cursor / VS Code: **Extensions → … → Install from Location…** and pick
`extensions/vscode-jsk`.

To try changes without installing, open this folder and press **F5** (Extension
Development Host), or from the monorepo root use the **JSK: Extension** launch
config under `.vscode/launch.json`.

## Features

- Language id `jsk` for `*.jsk`
- Highlighting for `{{ }}` / `{{{ }}}`, `{#if}` / `{#each}` / `{#include}`,
  `{# … #}` comments, PascalCase components, and `:prop` bindings on HTML tags
  (nested `'…'` string literals in expressions get a distinct color)
- Bracket / comment / fold helpers
- Snippets: `if`, `ifel`, `each`, `eachi`, `inc`, `var`, `raw`, `cmt`, `comp`,
  `Link`, `Image`, `island`

## Not yet

Diagnostics from the compiler, go-to-definition for components, and completions
from `views/components` are deferred — highlighting + snippets first.

## Package

```bash
npx @vscode/vsce package --cwd extensions/vscode-jsk
```
