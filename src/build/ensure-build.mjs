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

if (!fs.existsSync(path.join(config.dirs.generated, "manifest.json"))) {
  await import("./build.mjs");
}
