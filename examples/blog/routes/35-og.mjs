/**
 * Dinamik Open Graph görselleri.
 *
 * Next.js `opengraph-image.tsx` + `ImageResponse` karşılığı: HTML değil
 * PNG/SVG döndürdüğü için `route()` kullanılmaz. `ogHandler` Express
 * handler'ı üretir; controller `metadata.openGraph.image` ile bu URL'yi
 * işaret eder.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPost } from "../lib/posts.js";

const blogRoot = fileURLToPath(new URL("..", import.meta.url));

const ogFonts = [
  { path: "fonts/Inter-Regular.ttf", family: "Inter" },
  { path: "fonts/Inter-Bold.ttf", family: "Inter" },
].filter((font) => existsSync(path.join(blogRoot, font.path)));

export default function register(app, { ogHandler, notFound }) {
  app.get(
    // Express 5: `:slug.png` → `.` regex sanılır; uzantı kaçışlı yazılmalı.
    "/og/blog/:slug\\.png",
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
        // Slim imajda sistem fontu yok. librsvg woff2'den kare basar;
        // PNG için ttf/otf. Dosya yoksa dizi boş kalır, görsel yine döner.
        ...(ogFonts.length ? { fonts: ogFonts } : {}),
      };
    }),
  );
}
