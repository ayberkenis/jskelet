/**
 * Tek route modülü.
 *
 * `route()` controller'ı sarar: HTML cache, notFound/redirect kontrol akışı,
 * brotli/gzip ve `X-JSkelet-Cache` başlığı buradan gelir. Controller'ın tek
 * işi bir sayfa tanımı döndürmek.
 */
export default function register(app, { route }) {
  app.get(
    "/",
    route(async () => ({
      view: "pages/home",
      metadata: { title: "Ana sayfa" },
      data: {
        heading: "JSkelet çalışıyor",
        items: ["Sunucu render", "HTML TTL cache", "Görünürlükte island"],
      },
    })),
  );

  app.get(
    "/hakkinda",
    route(
      async () => ({
        view: "pages/about",
        metadata: { title: "Hakkında", canonical: "/hakkinda" },
      }),
      // Route kendi süresini verir; config'teki `cache().html` bunu ezebilir.
      { revalidate: 300 },
    ),
  );
}
