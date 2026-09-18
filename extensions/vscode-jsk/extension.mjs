/**
 * JSK extension: derleyici diagnostikleri + bileşen tamamlama.
 * Tam LSP yok — kayıt / açılışta `compileSource` çalışır.
 */
import * as vscode from "vscode";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CompileError, compileSource } from "./vendor/compile/index.js";
import { scanNamedExports } from "./vendor/compile/scan-exports.js";

const BUILTINS = [
  "Link",
  "Image",
  "Icon",
  "CsrfField",
  "PreloadImage",
  "Stylesheets",
  "BodyScripts",
  "JsonLd",
];

/** @type {vscode.DiagnosticCollection | undefined} */
let diagnostics;

/**
 * @param {vscode.ExtensionContext} context
 */
export function activate(context) {
  diagnostics = vscode.languages.createDiagnosticCollection("jsk");
  context.subscriptions.push(diagnostics);

  const refresh = (doc) => {
    if (doc?.languageId === "jsk") lintDocument(doc);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidSaveTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === "jsk") {
        // Yazarken spam olmasın: kısa debounce
        scheduleLint(e.document);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics?.delete(doc.uri);
    }),
  );

  for (const doc of vscode.workspace.textDocuments) refresh(doc);

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "jsk" },
      {
        async provideCompletionItems(document, position) {
          const line = document.lineAt(position).text.slice(0, position.character);
          if (!/<[A-Za-z]*$/.test(line)) return undefined;
          const names = await collectComponentNames(document.uri);
          return names.map((name) => {
            const item = new vscode.CompletionItem(
              name,
              vscode.CompletionItemKind.Class,
            );
            item.insertText = new vscode.SnippetString(`${name} $0/>`);
            item.detail = "JSK component";
            return item;
          });
        },
      },
      "<",
    ),
  );
}

export function deactivate() {
  diagnostics?.dispose();
  diagnostics = undefined;
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let lintTimer;

/**
 * @param {vscode.TextDocument} doc
 */
function scheduleLint(doc) {
  if (lintTimer) clearTimeout(lintTimer);
  lintTimer = setTimeout(() => lintDocument(doc), 300);
}

/**
 * @param {vscode.TextDocument} doc
 */
function lintDocument(doc) {
  if (!diagnostics) return;
  const source = doc.getText();
  try {
    compileSource(source, {
      viewId: "editor",
      file: path.basename(doc.uri.fsPath),
      knownComponents: null,
    });
    diagnostics.set(doc.uri, []);
  } catch (error) {
    if (!(error instanceof CompileError)) {
      diagnostics.set(doc.uri, [
        new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 1),
          error instanceof Error ? error.message : String(error),
          vscode.DiagnosticSeverity.Error,
        ),
      ]);
      return;
    }
    const line = Math.max(0, (error.line ?? 1) - 1);
    const col = Math.max(0, (error.column ?? 1) - 1);
    const range = new vscode.Range(line, col, line, col + 1);
    // CompileError.message konum + snippet içerir; Problems'ta kısa mesaj yeter.
    const short =
      error.message.split("\n").find((l) => l && !/^\s/.test(l) && !/:\d+:\d+$/.test(l)) ??
      error.message;
    diagnostics.set(doc.uri, [
      new vscode.Diagnostic(range, short.trim(), vscode.DiagnosticSeverity.Error),
    ]);
  }
}

/**
 * @param {vscode.Uri} docUri
 * @returns {Promise<string[]>}
 */
async function collectComponentNames(docUri) {
  const names = new Set(BUILTINS);
  const folder = vscode.workspace.getWorkspaceFolder(docUri);
  const roots = folder
    ? [folder.uri.fsPath]
    : vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];

  for (const root of roots) {
    for (const rel of [
      "views/components",
      "shared/views/components",
    ]) {
      scanComponentDir(path.join(root, rel), names);
    }
    const features = path.join(root, "features");
    if (fs.existsSync(features)) {
      for (const name of fs.readdirSync(features)) {
        scanComponentDir(
          path.join(features, name, "views", "components"),
          names,
        );
      }
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string} dir
 * @param {Set<string>} out
 */
function scanComponentDir(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanComponentDir(full, out);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    if (entry.name === "loader.js" || entry.name === "index.js") continue;
    try {
      const source = fs.readFileSync(full, "utf8");
      for (const name of scanNamedExports(source)) {
        out.add(name);
        out.add(name.charAt(0).toUpperCase() + name.slice(1));
      }
    } catch {
      // ignore unreadable files
    }
  }
}

// VS Code bazı ortamlarda CJS gibi yükler; pathToFileURL sessizce kullanılabilir.
void pathToFileURL;
