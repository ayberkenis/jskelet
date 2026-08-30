/**
 * Kişiye özel bir uygulamanın yapılandırması.
 *
 * `examples/blog` public bir siteyi gösteriyor: cache, prewarm, SEO. Burası
 * tam tersi ekseni gösteriyor — oturum, `no-store`, CSRF ve fragment. İki
 * örneğin config'lerini yan yana koymak farkı en hızlı anlatan yer.
 *
 * Tam referans: node_modules/jskelet/docs/07-yapilandirma.md
 */
const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

export default {
  brand: { lang: "tr" },

  security: {
    /**
     * Oturum ve CSRF cookie'lerini imzalayan sır. Örnekte varsayılan var ki
     * `npm start` tek komutla çalışsın; gerçek bir kurulumda **yalnızca**
     * ortam değişkeni kullanılır.
     */
    cookieSecret: process.env.JSKELET_SECRET ?? "ornek-icin-sabit-sir",

    csrf: {
      /**
       * Çift gönderim token'ı açık: formlar `csrfField()` basıyor. Yalnızca
       * `Origin` kontrolü de çoğu vakayı kapatıyor ama panelde mutasyonlar
       * gerçek veriye dokunuyor, ikinci katman burada karşılığını veriyor.
       */
      token: true,

      /** Webhook uçları tarayıcıdan gelmiyor, token da göndermiyorlar. */
      exclude: ["/webhook/:path*"],
    },
  },

  /**
   * Panel yolları spekülasyon dışı: `/panel/cikis` gibi yan etkili bir
   * bağlantının önden getirilmesi kullanıcıyı sessizce oturumdan atardı.
   */
  navigation: {
    prefetch: "conservative",
    exclude: ["/panel/:path*", "/giris", "/cikis"],
  },

  icons: { scan: ["views", "client", "routes"] },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Panel bir çerçeveye gömülmemeli: clickjacking ile bir mutasyon
          // butonunun üzerine görünmez bir katman konabilir.
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // Oturuma bağlı hiçbir sayfa arama motoruna girmemeli. `route()` zaten
        // `no-store` yazıyor; bu, indekslemeye karşı ikinci katman.
        source: "/panel/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },

  async cache() {
    return {
      /**
       * Yalnızca public sayfalar. Panel yolları burada **bilinçli olarak
       * yok**: `private: true` ile kaydedildikleri için bir desen onları
       * cache'lenebilir hâle getiremez, ama listeye yazmamak da niyeti
       * okunur kılıyor.
       */
      html: { "/": 300, "/giris": 300 },

      /** Oturum gerektiren sayfalar ısıtılamaz; ısıtıcının oturumu yok. */
      prewarm: { enabled: true, max: 20 },
    };
  },

  prewarmSkip: ["/api/", "/_fragment/", "/panel", "/cikis"],

  hooks: {
    metadata() {
      return {
        titleTemplate: "%s | JSkelet Panel",
        description: "JSkelet ile kurulmuş örnek bir yönetim paneli.",
        siteUrl: SITE_URL,
        locale: "tr_TR",
      };
    },

    layoutContext({ pathname }) {
      return {
        pathname,
        bodyClass: "min-h-screen bg-slate-50 text-slate-900",
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
      return ["/", "/giris"];
    },
  },
};
