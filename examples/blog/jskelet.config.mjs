/**
 * Orta seviye örnek: gerçek bir sitenin ihtiyaç duyduğu her yapılandırma
 * bölümü burada en az bir kez kullanılıyor.
 *
 * Tam referans: node_modules/jskelet/docs/07-yapilandirma.md
 */
import { allPostPaths } from "./lib/posts.js";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

export default {
  brand: { lang: "tr" },

  /** Üçüncü taraf kaynaklar; `<head>`in en başına preconnect olarak basılır. */
  preconnect: ["https://images.unsplash.com"],

  /** Client bundle'a gömülecek env anahtarları (Next'teki `NEXT_PUBLIC_*`). */
  clientEnv: ["SITE_URL"],

  /**
   * Site içi gezinme ipuçları. `prerender` bilinçli olarak kapalı: prerender
   * edilen sayfanın script'leri gerçekten çalışır, yani ölçüm kodunu
   * `prerenderingchange` olayına bağlamadan açmak ziyaret sayılarını şişirir.
   *
   * `exclude`: footer'daki RSS ve sitemap bağlantıları gezinme hedefi değil,
   * önden indirilmeleri boşa istek.
   */
  navigation: {
    prefetch: "moderate",
    viewTransition: true,
    exclude: ["/rss.xml", "/sitemap.xml"],
  },

  /** Build zamanı indirilip `public/fonts/` altına konur, sonra commit edilir. */
  fonts: [{ family: "Inter", weights: [400, 700] }],

  /** İkon sprite taraması: yalnızca bu dizinlerde geçen ikonlar üretilir. */
  icons: { scan: ["views", "client", "routes"] },

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
      // `permanent: true` → 308. Eski URL şeması korunuyor.
      { source: "/yazi/:slug", destination: "/blog/:slug", permanent: true },
      { source: "/posts", destination: "/blog", permanent: true },
    ];
  },

  async rewrites() {
    return {
      afterFiles: [
        // Göreli hedef: istek kendi route tablomuzda devam eder, proxy yok.
        { source: "/feed", destination: "/rss.xml" },
      ],
    };
  },

  async cache() {
    return {
      /**
       * Sayfa HTML'inin önbellekte kalma süresi (saniye). Route'un kendi
       * `revalidate` değerini ezer; 0 verilirse o yol hiç cache'lenmez.
       */
      html: {
        "/": 60,
        "/blog": 60,
        "/blog/:slug": 300,
      },

      /** Açılışta sayfaları önden render edip önbelleğe koyan tarama. */
      prewarm: {
        enabled: true,
        max: 200,
        concurrency: 4,
        intervalSeconds: 0,
      },
    };
  },

  hooks: {
    /** Her sayfanın metadata varsayılanı; sayfa kendi alanlarıyla ezer. */
    metadata() {
      return {
        titleTemplate: "%s | JSkelet Blog",
        description: "JSkelet ile kurulmuş örnek bir blog.",
        siteUrl: SITE_URL,
        locale: "tr_TR",
        openGraph: { siteName: "JSkelet Blog" },
      };
    },

    /**
     * Layout'a her render'da eklenen local'ler. Navigasyon gerçek bir
     * projede upstream'den gelir; `render.js` bunu gövde render'ıyla
     * paralel çalıştırır, yani sıraya girmez.
     */
    layoutContext({ pathname }) {
      return {
        pathname,
        // Arka plan burada değil `<html>`de; gerekçesi layout'un başında.
        bodyClass: "min-h-screen text-slate-900",
        nav: [
          { href: "/", label: "Ana sayfa" },
          { href: "/blog", label: "Blog" },
          { href: "/iletisim", label: "İletişim" },
        ],
        structuredData: [
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "JSkelet Blog",
            url: SITE_URL,
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

    /** Açılışta ısıtılacak yollar — genelde sitemap'i üreten fonksiyonun aynısı. */
    prewarmPaths() {
      return ["/", "/blog", "/iletisim", ...allPostPaths()];
    },
  },
};
