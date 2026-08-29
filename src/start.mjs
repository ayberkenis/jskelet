/**
 * Prod sunucu girişi. Build çıktısı yoksa önce üretir, sonra dinlemeye başlar.
 */
import "./build/ensure-build.mjs";
import { startServer } from "./server/create-app.js";

await startServer();
