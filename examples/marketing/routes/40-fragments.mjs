/**
 * `/compare` sayfasındaki canlı ölçümün iki ucu.
 *
 * İkisi de **aynı şablonu** render eder; tek fark cache. Eski kurulum ana
 * sayfayı (büyük HTML) cache HIT ile, küçük bir fragment'ı fresh ile
 * karşılaştırıyordu — transfer boyutu farkı yüzünden "cachesiz daha hızlı"
 * yanılsaması çıkıyordu. Adil kıyas için iki uç da layout'suz aynı gövdeyi
 * döner; biri bellekten, diğeri her seferinde yeniden.
 */
import { getConfig, renderView, withHtmlCache } from "jskelet";
import { getContent } from "../lib/content.js";
import { DEFAULT_LOCALE } from "../lib/i18n.js";

const FRESH_PATH = "/_fragment/render-demo";
const CACHED_PATH = "/_fragment/render-demo-cached";
const TTL = 3600;

/**
 * @returns {Promise<string>}
 */
async function demoHtml() {
  return renderView("partials/render-demo", {
    rows: getContent(DEFAULT_LOCALE).comparison.rows,
  });
}

export default function register(app) {
  const cacheHeader = getConfig().brand.cacheHeader;

  app.get(CACHED_PATH, async (req, res, next) => {
    try {
      const result = await withHtmlCache(CACHED_PATH, TTL, async () => ({
        html: await demoHtml(),
        status: 200,
      }));

      res.status(result.status ?? 200);
      res.setHeader(
        cacheHeader,
        result.cached ? (result.stale ? "STALE" : "HIT") : "MISS",
      );
      res.setHeader(
        "Cache-Control",
        `public, max-age=0, s-maxage=${TTL}, stale-while-revalidate=60`,
      );
      res.type("html").send(result.html);
    } catch (error) {
      next(error);
    }
  });

  app.get(FRESH_PATH, async (req, res, next) => {
    try {
      // Ölçümün anlamı buna bağlı: bu uç önbelleğe girerse iki taraf da
      // cache'ten dönen aynı şeyi ölçer ve karşılaştırma anlamsızlaşır.
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(await demoHtml());
    } catch (error) {
      next(error);
    }
  });
}
