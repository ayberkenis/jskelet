/**
 * `/compare` sayfasındaki canlı ölçümün iki ucu.
 *
 * İkisi de **aynı şablonu** ve **aynı üreticiyi** kullanır. Üretici bilerek
 * kısa bir upstream gecikmesi içerir (API/DB simülasyonu): HIT bu adımı
 * atlar, fresh her seferinde öder. Gecikmesiz ucuz bir render'da RTT her iki
 * tarafı da ezer ve cache farkı milisaniyede görünmez kalır.
 */
import { getConfig, renderView, withHtmlCache } from "jskelet";
import { getContent } from "../lib/content.js";
import { DEFAULT_LOCALE } from "../lib/i18n.js";

const FRESH_PATH = "/_fragment/render-demo";
const CACHED_PATH = "/_fragment/render-demo-cached";
const TTL = 3600;

/** Demo'nun ölçülebilir kıldığı sabit upstream maliyeti (ms). */
export const DEMO_UPSTREAM_MS = 80;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @returns {Promise<{ html: string, produceMs: number }>}
 */
async function produceDemo() {
  const started = Date.now();
  // Bilinçli: gerçek sitelerde bu `await getPosts()` / `fetch(api)` olur.
  await sleep(DEMO_UPSTREAM_MS);
  const html = await renderView("partials/render-demo", {
    rows: getContent(DEFAULT_LOCALE).comparison.rows,
  });
  return { html, produceMs: Date.now() - started };
}

/**
 * @param {import('express').Response} res
 * @param {string} cacheDesc
 * @param {number} produceMs
 * @param {string} [exposeExtra]
 */
function writeTiming(res, cacheDesc, produceMs, exposeExtra = "") {
  res.setHeader(
    "Server-Timing",
    `cache;desc=${cacheDesc}, produce;dur=${produceMs}, upstream;dur=${DEMO_UPSTREAM_MS}`,
  );
  const expose = ["Server-Timing", exposeExtra].filter(Boolean).join(", ");
  res.setHeader("Access-Control-Expose-Headers", expose);
}

export default function register(app) {
  const cacheHeader = getConfig().brand.cacheHeader;

  app.get(CACHED_PATH, async (req, res, next) => {
    try {
      let produceMs = 0;
      const result = await withHtmlCache(CACHED_PATH, TTL, async () => {
        const produced = await produceDemo();
        produceMs = produced.produceMs;
        return { html: produced.html, status: 200 };
      });

      const label = result.cached ? (result.stale ? "STALE" : "HIT") : "MISS";
      // HIT/STALE: producer bu istekte koşmadı. MISS: produceMs yukarıda doldu.
      const spent = result.cached ? 0 : produceMs;

      res.status(result.status ?? 200);
      res.setHeader(cacheHeader, label);
      res.setHeader(
        "Cache-Control",
        `public, max-age=0, s-maxage=${TTL}, stale-while-revalidate=60`,
      );
      writeTiming(res, label, spent, cacheHeader);
      res.type("html").send(result.html);
    } catch (error) {
      next(error);
    }
  });

  app.get(FRESH_PATH, async (req, res, next) => {
    try {
      const produced = await produceDemo();
      res.setHeader("Cache-Control", "no-store");
      writeTiming(res, "BYPASS", produced.produceMs);
      res.type("html").send(produced.html);
    } catch (error) {
      next(error);
    }
  });
}
