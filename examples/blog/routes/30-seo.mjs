/**
 * robots.txt, sitemap.xml ve RSS.
 *
 * Bunlar HTML döndürmediği için `route()` kullanmazlar — `route()` layout
 * içinde EJS render eder. Düz Express handler'ı yeterli; cache başlığını
 * elle yazıyoruz.
 */
import { allPostPaths } from "../lib/posts.js";

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
    // Sitemap ve prewarm aynı listeden beslenir; ayrıştıklarında ısıtılan
    // sayfa ile indekslenen sayfa farklı oluyor ve fark gözden kaçıyor.
    const paths = ["/", "/blog", "/iletisim", ...allPostPaths()];

    const urls = paths
      .map((path) => `<url><loc>${SITE_URL}${path}</loc></url>`)
      .join("");

    res.type("application/xml");
    res.setHeader("Cache-Control", cacheFor(3600));
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    );
  });

  app.get("/rss.xml", async (req, res) => {
    const { getPosts } = await import("../lib/posts.js");

    const items = getPosts()
      .map(
        (post) =>
          `<item><title><![CDATA[${post.title}]]></title>` +
          `<link>${SITE_URL}/blog/${post.slug}</link>` +
          `<guid>${SITE_URL}/blog/${post.slug}</guid>` +
          `<description><![CDATA[${post.excerpt}]]></description></item>`,
      )
      .join("");

    res.type("application/rss+xml");
    res.setHeader("Cache-Control", cacheFor(1800));
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>` +
        `<title>JSkelet Blog</title><link>${SITE_URL}</link>` +
        `<description>Mimari, cache ve performans</description>${items}` +
        `</channel></rss>`,
    );
  });

  /** Dev panelinin ve yük dengeleyicinin okuduğu uç. */
  app.get("/api/healthcheck", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, uptime: process.uptime() });
  });
}
