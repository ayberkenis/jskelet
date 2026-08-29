/**
 * robots.txt, sitemap.xml ve sağlık kontrolü.
 *
 * HTML döndürmedikleri için `route()` kullanılmaz — `route()` layout içinde EJS
 * render eder. Düz Express handler'ı yeterli, cache başlığı elle yazılır.
 */
import { pagePaths } from "../lib/content.js";

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
    // Sitemap ve prewarm aynı listeden beslenir; ayrıştıklarında ısıtılan sayfa
    // ile indekslenen sayfa farklı oluyor ve bu fark gözden kaçıyor.
    const urls = pagePaths()
      .map((pathname) => `<url><loc>${SITE_URL}${pathname}</loc></url>`)
      .join("");

    res.type("application/xml");
    res.setHeader("Cache-Control", cacheFor(3600));
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    );
  });

  app.get("/api/healthcheck", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, uptime: process.uptime() });
  });
}
