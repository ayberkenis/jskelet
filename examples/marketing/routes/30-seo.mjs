/**
 * robots.txt, sitemap.xml ve sağlık kontrolü.
 *
 * HTML döndürmedikleri için `route()` kullanılmaz — `route()` layout içinde EJS
 * render eder. Düz Express handler'ı yeterli, cache başlığı elle yazılır.
 */
import { DOCS } from "../lib/docs.js";
import { DEFAULT_LOCALE, LOCALES, PAGES, localePath } from "../lib/i18n.js";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

/** @param {number} seconds */
function cacheFor(seconds) {
  return `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=60`;
}

export default function register(app) {
  app.get("/robots.txt", (req, res) => {
    res.type("text/plain");
    res.setHeader("Cache-Control", cacheFor(3600));
    res.send(
      ["User-agent: *", "Allow: /", `Sitemap: ${SITE_URL}/sitemap.xml`, ""].join(
        "\n",
      ),
    );
  });

  app.get("/sitemap.xml", (req, res) => {
    // Sitemap, prewarm ve route kaydı aynı yol tablosundan besleniyor;
    // ayrıştıklarında ısıtılan sayfa ile indekslenen sayfa farklı oluyor ve bu
    // fark gözden kaçıyor.
    const basePaths = [
      ...Object.values(PAGES),
      // Belge sayfaları da dil önekli ve alternatifli: bölümlerin tamamı
      // indekslenebilir olmalı, dizin sayfası tek başına yeterli değil.
      ...DOCS.map((doc) => `${PAGES.docs}/${doc.slug}`),
    ];

    const urls = basePaths
      .map((basePath) => {
        // Her dil kendi `<url>` girdisini alır ama alternatif listesi ortak:
        // arama motoru bir sayfanın diğer dildeki karşılığını buradan öğrenir.
        const alternates = [
          ...LOCALES.map((locale) => alternate(locale, basePath)),
          alternate("x-default", basePath, DEFAULT_LOCALE),
        ].join("");

        return LOCALES.map(
          (locale) =>
            `<url><loc>${SITE_URL}${localePath(locale, basePath)}</loc>${alternates}</url>`,
        ).join("");
      })
      .join("");

    res.type("application/xml");
    res.setHeader("Cache-Control", cacheFor(3600));
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"` +
        ` xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`,
    );
  });

  app.get("/api/healthcheck", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, uptime: process.uptime() });
  });
}

/**
 * @param {string} hreflang
 * @param {string} basePath
 * @param {import("../lib/i18n.js").Locale} [locale] Yol için kullanılacak dil
 * @returns {string}
 */
function alternate(hreflang, basePath, locale) {
  const href = localePath(
    locale ?? /** @type {import("../lib/i18n.js").Locale} */ (hreflang),
    basePath,
  );

  return `<xhtml:link rel="alternate" hreflang="${hreflang}" href="${SITE_URL}${href}"/>`;
}
