/**
 * Route modüllerini yükler ve Express'e bağlar.
 *
 * Dosya sistemine dayalı otomatik URL türetme **yok**: her modül kendi
 * yollarını `app.get(...)` ile açıkça yazar. Sebep, Next.js'ten taşınırken
 * öğrenilen bir şey — sıra önemli. `/:slug` gibi tek segmentli bir yakalayıcı
 * `/about` rotasından önce kaydedilirse "about" bir slug sanılır. Sırayı
 * dosya adına gizlemek yerine görünür kılmak, teşhisi kolaylaştırıyor.
 *
 * Sıra iki şekilde belirlenir:
 *   1. `jskelet.config.mjs` → `routes: ["./routes/api.js", …]` (açık liste)
 *   2. Liste yoksa `routes/` dizini alfabetik taranır. Bu durumda dosya adına
 *      sayısal önek verin: `10-pages.js`, `50-blog.js`, `99-catch-all.js`.
 *
 * Modül sözleşmesi: default export ya da `register` adlı named export,
 * `(app, api) => void | Promise<void>` imzasıyla. `api` içinde `route`,
 * `fragment`, `renderView`, `renderPage` ve `notFound`/`redirect` hazır gelir,
 * böylece route dosyaları framework'ten tek tek import yapmak zorunda kalmaz.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { getConfig } from "../config/index.js";
import { fragment, renderPage, renderView, route } from "./render.js";
import {
  notFound,
  permanentRedirect,
  redirect,
  seeOther,
} from "../http/control-flow.js";

const isDev = process.env.NODE_ENV === "development";

/**
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function discover(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      discover(full, out);
      continue;
    }

    if (!/\.(js|mjs)$/.test(entry.name)) continue;
    if (entry.name.startsWith("_")) continue;

    out.push(full);
  }

  return out;
}

/**
 * Route dosyalarına geçilen framework yüzeyi.
 */
const api = {
  route,
  fragment,
  renderView,
  renderPage,
  notFound,
  redirect,
  permanentRedirect,
  seeOther,
};

/**
 * @param {import('express').Express} app
 * @returns {Promise<number>} Bağlanan modül sayısı.
 */
export async function registerRoutes(app) {
  const config = getConfig();

  const files = config.routes
    ? config.routes.map((entry) => path.resolve(config.root, entry))
    : discover(config.dirs.routes);

  if (!files.length) {
    console.warn(
      `[router] no route modules found — is ${path.relative(config.root, config.dirs.routes)}/ empty?`,
    );
    return 0;
  }

  let registered = 0;

  for (const file of files) {
    /** @type {Record<string, unknown>} */
    let module;

    try {
      module = await import(pathToFileURL(file).href);
    } catch (error) {
      // Dev'de eksik/bozuk bir modül tüm sunucuyu düşürmesin: uyar ve devam
      // et. Üretimde fırlat — yarım route tablosuyla yayına çıkmak,
      // sessizce 404 dönen sayfalar demek.
      if (isDev) {
        console.warn(`[router] ${path.basename(file)} failed to load, skipped`, error);
        continue;
      }
      throw error;
    }

    const register = module.default ?? module.register;
    if (typeof register !== "function") {
      console.warn(
        `[router] ${path.basename(file)} exports neither a default nor a 'register' function, skipped`,
      );
      continue;
    }

    await register(app, api);
    registered += 1;
  }

  return registered;
}
