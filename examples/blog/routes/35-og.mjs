/**
 * Dinamik Open Graph görselleri.
 *
 * Next.js `opengraph-image.tsx` + `ImageResponse` karşılığı: HTML değil
 * PNG/SVG döndürdüğü için `route()` kullanılmaz. `ogHandler` Express
 * handler'ı üretir; controller `metadata.openGraph.image` ile bu URL'yi
 * işaret eder.
 */
import { getPost } from "../lib/posts.js";

export default function register(app, { ogHandler, notFound }) {
  app.get(
    "/og/blog/:slug.png",
    ogHandler(async ({ params }) => {
      const post = getPost(params.slug);
      if (!post) notFound();

      return {
        title: post.title,
        description: post.excerpt,
        siteName: "JSkelet Blog",
        // Örnek marka rengi — uygulama kendi paletini verir.
        background: "#0f172a",
        accent: "#38bdf8",
      };
    }),
  );
}
