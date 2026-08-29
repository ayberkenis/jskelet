/**
 * Belgeler dizini. Ayrı bir dosyada duruyor çünkü ileride her belgeyi kendi
 * sayfasında render eden bir route buraya ekleniyor; sayfa listesinin
 * `10-pages.mjs` içinde şişmesi istenmiyor.
 */
import { docs } from "../lib/content.js";

export default function register(app, { route }) {
  app.get(
    "/belgeler",
    route(
      async () => ({
        view: "pages/docs",
        metadata: {
          title: "Belgeler",
          description:
            "On bir bölüm: başlangıçtan cache'e, build hattından Next.js taşımasına.",
          canonical: "/belgeler",
        },
        data: { docs },
      }),
      { revalidate: 3600 },
    ),
  );
}
