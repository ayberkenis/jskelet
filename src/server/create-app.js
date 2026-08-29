/**
 * Express uygulamasını kurar ve dinlemeye başlar.
 *
 * Middleware **sırası** bu dosyanın asıl değeri; her konumun bir sebebi var
 * ve yer değiştirmek sessiz bozulmalara yol açıyor:
 *
 *   1. rewrites(beforeFiles) — statik dosyalardan da önce çalışmalı, yoksa
 *      `/assets/x.js` yolunu başka bir yere taşıyan kural işlemez.
 *   2. compression — static'ten önce; sonra gelirse statik dosyalar sıkışmaz.
 *   3. headers → devGate → redirects — gate'in 404'ü redirect'ten önce.
 *   4. staticPrecompressed → express.static — build'de üretilmiş `.br`/`.gz`
 *      kopyalar varsa onlar servis edilir (kalite 11), yoksa istek altındaki
 *      static'e düşer ve middleware anında sıkıştırır (kalite 5).
 *   5. body parser'lar — statikten sonra: görsel isteklerinde gövde ayrıştırma
 *      maliyeti ödenmesin.
 *   6. rewrites(afterFiles) — statik denendikten sonra, sayfalardan önce.
 *   7. route'lar → 404 → hata yönetimi.
 */
import path from "node:path";
import process from "node:process";
import express from "express";
import { compression } from "./middleware/compression.js";
import { headersMiddleware } from "./middleware/headers.js";
import { staticPrecompressed } from "./middleware/static-precompressed.js";
import { devGate } from "./middleware/dev-gate.js";
import { redirects } from "./middleware/redirects.js";
import { configRewrites } from "./middleware/upstream-proxy.js";
import { getConfig, loadConfig } from "../config/index.js";
import { IMMUTABLE_CACHE } from "../config/defaults.js";
import { registerRoutes } from "./router.js";
import { renderNotFound } from "./render.js";
import { startPrewarm } from "./prewarm.js";
import { isNotFoundError, isRedirectError } from "../http/control-flow.js";

/**
 * @param {{ root?: string, configFile?: string }} [options]
 * @returns {Promise<import('express').Express>}
 */
export async function createApp(options = {}) {
  // Config middleware'lerden önce okunur; yoksa uyarı basar, akış durmaz.
  await loadConfig(options);
  const config = getConfig();

  const app = express();

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Powered-By", config.brand.poweredBy);
    next();
  });

  app.set("etag", "strong");
  // Ters proxy arkasında doğru protokol ve istemci IP'si için.
  app.set("trust proxy", true);

  app.use(configRewrites("beforeFiles"));
  app.use(compression());
  app.use(headersMiddleware());
  app.use(devGate());
  app.use(redirects());

  app.use(staticPrecompressed(config.dirs.public));
  app.use(
    express.static(config.dirs.public, {
      index: false,
      redirect: false,
      maxAge: "1y",
      setHeaders(res, filePath) {
        // Hash'siz statik dosyalar için kısa cache; hash'liler immutable.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", IMMUTABLE_CACHE);
        }
      },
    }),
  );

  // Dev overlay yalnızca development'ta; dinamik import sayesinde prod
  // sürecine hiçbir şey yüklenmez.
  if (process.env.NODE_ENV === "development") {
    const { mountDevtools } = await import("./dev/devtools.js");
    mountDevtools(app);
  }

  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  app.use(express.json({ limit: "256kb" }));

  app.use(configRewrites("afterFiles"));

  await registerRoutes(app);

  app.use(async (req, res, next) => {
    try {
      res.status(404).type("html").send(await renderNotFound());
    } catch (error) {
      next(error);
    }
  });

  // Hata yönetimi: notFound/redirect kontrol akışı burada da yakalanır,
  // çünkü bir controller dışında (ör. middleware içinde) fırlatılabilir.
  app.use(async (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (isRedirectError(error)) {
      res.redirect(error.statusCode, error.location);
      return;
    }

    if (isNotFoundError(error)) {
      res.status(404).type("html").send(await renderNotFound());
      return;
    }

    console.error(`[500] ${req.method} ${req.originalUrl}`, error);
    res.status(500).type("html").send(FALLBACK_ERROR);
  });

  return app;
}

const FALLBACK_ERROR =
  '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  "<title>500</title></head><body><h1>500</h1>" +
  "<p>Bir şeyler ters gitti. Lütfen daha sonra tekrar deneyin.</p></body></html>";

/**
 * Uygulamayı kurup dinlemeye başlar. CLI `jskelet start` bunu çağırır;
 * gömülü kullanımda `createApp()` tercih edilir.
 *
 * @param {{ root?: string, configFile?: string, port?: number, host?: string }} [options]
 * @returns {Promise<import('http').Server>}
 */
export async function startServer(options = {}) {
  const app = await createApp(options);
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";

  // Tek bir istek hatası süreci düşürmesin; logla ve ayakta kal. Bir haber
  // sitesinde tek sayfanın hatası tüm siteyi indirmemeli.
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("[uncaughtException]", error);
  });

  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      // Bu satırın biçimi sözleşme: `jskelet dev` sunucunun hazır olduğunu
      // buradan anlar ve özet satırını ona göre basar.
      console.log(
        `jskelet → http://localhost:${port} (${process.env.NODE_ENV ?? "production"})`,
      );
      startPrewarm({ port });
      resolve(server);
    });
  });
}
