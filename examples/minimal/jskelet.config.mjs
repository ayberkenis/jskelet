/**
 * En küçük çalışan yapılandırma.
 *
 * Bu dosyanın tamamı opsiyoneldir — silinse bile uygulama ayağa kalkar,
 * yalnızca metadata varsayılanları ve 404 sayfası framework'ün jenerik
 * hâline döner. Buradaki her alan `docs/07-yapilandirma.md` içinde açıklanıyor.
 */
export default {
  brand: { lang: "tr" },

  async cache() {
    return {
      // Ana sayfa 60 saniye önbellekte kalır. Süre dolunca eski HTML anında
      // döner ve tazeleme arkada çalışır: ziyaretçi render beklemez.
      html: { "/": 60 },
      // Edge'in taze penceresi bittikten sonra eski HTML'i sunacağı süre.
      // 0 yazılırsa direktif hiç basılmaz.
      staleWhileRevalidate: 60,
    };
  },

  hooks: {
    metadata() {
      return {
        titleTemplate: "%s | JSkelet Minimal",
        description: "JSkelet'in en küçük örnek uygulaması.",
        siteUrl: "http://localhost:3000",
      };
    },

    layoutContext() {
      return { bodyClass: "bg-white text-slate-900" };
    },

    notFound() {
      return {
        view: "pages/not-found",
        metadata: { title: "Sayfa bulunamadı", robots: { index: false } },
      };
    },
  },
};
