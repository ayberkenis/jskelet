/**
 * En son yüklenen modül: tek segmentli yolları etiket olarak dener.
 *
 * Sıra burada kritik. Bu route `10-pages.mjs`ten önce kaydedilirse
 * `/iletisim` bir etiket sanılır. Sayısal önek düzeni tam bu yüzden var;
 * ayrıntı: docs/03-routing.md
 */
import { getPostsByTag, getTags } from "../lib/posts.js";

export default function register(app, { route, permanentRedirect }) {
  app.get(
    "/:slug",
    route(async ({ params }) => {
      const { slug } = params;

      // Eski düz `/etiket-adi` biçimi kalıcı olarak yeni şemaya taşınır.
      if (getTags().includes(slug)) permanentRedirect(`/etiket/${slug}`);

      return {
        view: "pages/not-found",
        status: 404,
        metadata: {
          title: "Sayfa bulunamadı",
          robots: { index: false, follow: false },
        },
        data: { suggestions: getPostsByTag("performans").slice(0, 2) },
      };
    }),
  );
}
