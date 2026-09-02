/**
 * Framework yönetim paneli (`/_jskelet/admin`).
 *
 * Dev overlay'den ayrı: `NODE_ENV`'e bakmaz, yalnızca `admin().enabled` /
 * `JSKELET_ADMIN` ile açılır. Kapalıyken modül yüklenmez ve yol yoktur.
 *
 * Şifre süreç başlangıcında üretilir ve log kutusunda bir kez basılır.
 */
import process from "node:process";
import * as log from "../../log.mjs";
import { getConfig } from "../../config/index.js";
import { PASSWORD } from "./auth.js";
import { createAdminRouter } from "./router.js";
import { configureEventLog, requestLogMiddleware } from "./event-log.js";

/** @type {typeof import('../../config/defaults.js').DEFAULT_ADMIN} */
let settings;

/**
 * @returns {typeof import('../../config/defaults.js').DEFAULT_ADMIN}
 */
function getSettings() {
  return settings;
}

/**
 * Paneli uygulamaya bağlar, istek log middleware'ini kurar ve şifreyi loglar.
 *
 * @param {import('express').Express} app
 */
export function mountAdmin(app) {
  settings = getConfig().admin;

  configureEventLog({
    basePath: settings.basePath,
    logSize: settings.logSize,
    prewarmUserAgent: String(getConfig().brand.prewarmUserAgent ?? ""),
  });

  app.use(settings.basePath, createAdminRouter(getSettings, app));
  // Route'lardan önce mount edilir; `finish` anında Express `req.route`
  // doldurmuş olur. Admin yolları ring'e yazılmaz.
  app.use(requestLogMiddleware());

  const port = process.env.PORT ?? 3000;
  log.box({
    title: "ADMIN",
    lines: [
      `http://localhost:${port}${settings.basePath}`,
      "",
      `password  ${PASSWORD}`,
      "",
      "Valid until this process restarts.",
    ],
  });
}
