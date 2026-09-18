/**
 * Prod sunucu girişi. Build çıktısı yoksa önce üretir, sonra dinlemeye başlar.
 *
 * `jskelet start --murder` → dolu porttaki dinleyiciyi öldürüp başlar.
 * Port kontrolü build'den önce: doluysa pahalı üretimi hiç başlatma.
 */
import process from "node:process";
import { ensurePortFree } from "./server/port-guard.js";

const port = Number(process.env.PORT ?? 3000);
const murder = process.argv.includes("--murder");

try {
  await ensurePortFree(port, { murder });
  await import("./build/ensure-build.mjs");
  const { startServer } = await import("./server/create-app.js");
  await startServer({ murder, port });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
