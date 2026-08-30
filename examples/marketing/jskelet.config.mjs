/**
 * Pazarlama sitesi: her sayfa anonim, herkese aynı HTML gider ve içerik
 * derleme zamanında bilinir. Bu, HTML TTL cache'inin en verimli çalıştığı
 * profil — bu yüzden `revalidate` değerleri uzun ve prewarm tüm siteyi ısıtır.
 *
 * Tam referans: node_modules/jskelet/docs/07-yapilandirma.md
 */
import { pagePaths } from "./lib/content.js";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

export default {
  brand: { lang: "tr" },

  /**
   * Bilinçli olarak boş: site sistem font yığınını kullanıyor, yani hiç web
   * font isteği yok. Sayfanın kendi iddiası bu; `fonts: [...]` eklemek o
   * iddiayı bozardı.
   */
  fonts: [],

  /**
   * Sprite yalnızca bu dizinlerde geçen ikonları içerir. `lib` de taranıyor:
   * içerik listelerindeki `icon: "Lightning"` alanları şablona değişkenle
   * geldiği için statik olarak yalnızca orada görünüyor.
   */
  icons: { scan: ["views", "client", "lib"] },

  clientEnv: ["SITE_URL"],

  /**
   * Sitenin tamamı prewarm ile ısıtılmış ve bir saat sıcak kalıyor; yani
   * spekülatif bir istek sunucuda render tetiklemiyor, hazır buffer'ı
   * gönderiyor. Prerender'ı açmanın maliyetinin en düşük olduğu profil bu.
   */
  navigation: {
    prefetch: "moderate",
    prerender: "conservative",
    viewTransition: true,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },

  async redirects() {
    return [
      // Pazarlama sitelerinde kaçınılmaz olan "eski kampanya URL'i" durumu.
      { source: "/features", destination: "/nasil-calisir", permanent: true },
      { source: "/benchmarks", destination: "/kiyaslama", permanent: true },
    ];
  },

  async rewrites() {
    return {
      afterFiles: [{ source: "/docs", destination: "/belgeler" }],
    };
  },

  async cache() {
    return {
      /**
       * İçerik yalnızca deploy ile değişiyor, dolayısıyla TTL'i kısa tutmanın
       * bir faydası yok: bir saat boyunca bellekten servis edilir.
       */
      html: {
        "/": 3600,
        "/nasil-calisir": 3600,
        "/kiyaslama": 3600,
        "/tasima": 3600,
        "/belgeler": 3600,
      },

      prewarm: {
        enabled: true,
        max: 50,
        concurrency: 4,
        intervalSeconds: 0,
      },
    };
  },

  hooks: {
    metadata() {
      return {
        titleTemplate: "%s · JSkelet",
        description:
          "Sunucuda tam HTML, island'larla etkileşim, bellekte HTML TTL cache. React yok, hydration şelalesi yok.",
        siteUrl: SITE_URL,
        locale: "tr_TR",
        openGraph: { siteName: "JSkelet", type: "website" },
        twitter: { card: "summary_large_image" },
      };
    },

    layoutContext({ pathname }) {
      return {
        pathname,
        // Arka plan burada değil `<html>`de; gerekçesi layout'un başında.
        bodyClass: "text-slate-900 dark:text-slate-100",
        nav: [
          { href: "/nasil-calisir", label: "Nasıl çalışır" },
          { href: "/kiyaslama", label: "Kıyaslama" },
          { href: "/tasima", label: "Taşıma" },
          { href: "/belgeler", label: "Belgeler" },
        ],
        structuredData: [
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "JSkelet",
            applicationCategory: "DeveloperApplication",
            operatingSystem: "Node.js 22+",
            url: SITE_URL,
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          },
        ],
      };
    },

    notFound() {
      return {
        view: "pages/not-found",
        metadata: {
          title: "Sayfa bulunamadı",
          robots: { index: false, follow: false },
        },
      };
    },

    prewarmPaths() {
      return pagePaths();
    },
  },
};
