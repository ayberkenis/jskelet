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
      const tags = getTags();

      // `.jsk` ifadelerinde slice/filter/include-locals yok; hazır veri gider.
      const featuredPosts = posts.slice(0, 2);
      const tagPanels = tags.map((tag, index) => ({
        tag,
        active: index === 0,
        hidden: index !== 0,
        tabSrc:
          index === 0 ? null : `/_fragment/posts-by-tag?tag=${encodeURIComponent(tag)}`,
        posts:
          index === 0
            ? posts.filter((post) => post.tags.includes(tag))
            : [],
      }));

      return {
        view: "pages/home",
        metadata: { title: "Ana sayfa", canonical: "/" },
        // `head` sayfaya özel `<head>` içeriği: LCP görselinin preload'ı
        // buraya konur, çünkü preconnect'ten sonra en erken yer burası.
        data: { featuredPosts, tags, tagPanels },
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
