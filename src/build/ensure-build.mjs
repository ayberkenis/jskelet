/**
 * `jskelet start` öncesi çalışır: build çıktısı yoksa üretir.
 *
 * Docker imajında build zaten yapıldığı için bu bir no-op; amaç `npm start`ı
 * doğrudan çalıştıran birinin stilsiz bir sayfayla karşılaşmaması.
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/index.js";

const config = await loadConfig();

const generated = config.dirs.generated;
const needsAssets = !fs.existsSync(path.join(generated, "manifest.json"));
const needsTemplates = !fs.existsSync(path.join(generated, "templates", "manifest.json"));

if (needsAssets || needsTemplates) {
  await import("./build.mjs");
}
