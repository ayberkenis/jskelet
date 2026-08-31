/**
 * Statik sayfalar ve ana sayfa.
 *
 * Dosya adındaki sayısal önek yükleme sırasını belirler; yakalayıcı route'lar
 * (`90-catch-all.mjs`) en sonda olmalı.
 */
import { getPosts, getTags } from "../lib/posts.js";

export default function register(app, { route, redirect }) {
  app.get(
    "/",
    route(async () => {
      const posts = getPosts();

      return {
        view: "pages/home",
        metadata: { title: "Ana sayfa", canonical: "/" },
        // `head` sayfaya özel `<head>` içeriği: LCP görselinin preload'ı
        // buraya konur, çünkü preconnect'ten sonra en erken yer burası.
        data: { posts, tags: getTags() },
      };
    }),
  );

  app.get(
    "/iletisim",
    route(
      async ({ query }) => ({
        view: "pages/contact",
        metadata: { title: "İletişim", canonical: "/iletisim" },
        data: { sent: query.sent === "1" },
      }),
      // Form sayfası kısa süre cache'lenir. `?sent=1`in de cache'lenmesi için
      // config'te `cache().query` altında izin verilmesi gerekiyor; izin
      // verilmediğinde sayfa dinamik davranır, yani başarı mesajı hiçbir
      // koşulda yanlış sayfada görünmez.
      { revalidate: 300 },
    ),
  );

  /**
   * Form gönderimi. POST cache'lenmez (`route()` yalnızca GET'i cache'ler),
   * ama yine de `route()` içinden geçmek hata yönetimini kazandırır.
   */
  app.post("/iletisim", (req, res) => {
    const message = String(req.body?.message ?? "").trim();

    if (!message) {
      // Kontrol akışı hatası: Express error handler yakalar ve yönlendirir.
      redirect("/iletisim");
    }

    console.log(`[iletisim] new message (${message.length} characters)`);
    res.redirect(303, "/iletisim?sent=1");
  });
}
