/**
 * Marketplace VSIX bağımsız çalışsın diye `src/compile` → `vendor/compile`.
 * `vsce package` / `publish` öncesi `vscode:prepublish` ile çalışır.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.resolve(extRoot, "../../src/compile");
const outDir = path.join(extRoot, "vendor", "compile");

if (!fs.existsSync(srcDir)) {
  console.error(`sync-compile: kaynak yok: ${srcDir}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const name of fs.readdirSync(srcDir)) {
  if (!name.endsWith(".js")) continue;
  fs.copyFileSync(path.join(srcDir, name), path.join(outDir, name));
}
console.log(`sync-compile: ${outDir}`);
