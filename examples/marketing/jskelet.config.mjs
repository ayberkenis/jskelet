/**
 * Pazarlama sitesi: her sayfa anonim, herkese aynı HTML gider ve içerik
 * derleme zamanında bilinir. Bu, HTML TTL cache'inin en verimli çalıştığı
 * profil — bu yüzden `revalidate` değerleri uzun ve prewarm tüm siteyi ısıtır.
 *
 * Site iki dilli: varsayılan İngilizce köke, Türkçe `/tr` altına kurulu.
 * Dil çözümlemesi tek yerde (`lib/i18n.js`) yaşıyor; buradaki hook'lar yalnızca
 * onu okuyor.
 *
 * Tam referans: node_modules/jskelet/docs/07-yapilandirma.md
 */
import { getContent } from "./lib/content.js";
import { docPaths } from "./lib/docs.js";
import {
  DEFAULT_LOCALE,
  PAGES,
  alternatePaths,
  localePath,
  pagePaths,
  resolveLocale,
} from "./lib/i18n.js";
import { getRelease } from "./lib/release.js";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";
const HOUR = 3600;

export default {
  brand: { lang: DEFAULT_LOCALE },

  // Logo hem header'da hem hero'da bu CDN'den geliyor; bağlantıyı geciktirmek
  // doğrudan LCP'ye yazılır.
  preconnect: ["https://cdn.ayberkenis.com.tr"],

  /**
   * Bilinçli olarak boş: site sistem font yığınını kullanıyor, yani hiç web
   * font isteği yok. Sayfanın kendi iddiası bu; `fonts: [...]` eklemek o
   * iddiayı bozardı.
   */
  fonts: [],

  /**
   * Sprite yalnızca bu dizinlerde geçen ikonları içerir. `lib` de taranıyor:
   * içerik sözlüklerindeki `icon: "Lightning"` alanları şablona değişkenle
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
          { key: "Content-Language", value: DEFAULT_LOCALE },
        ],
      },
      {
        // Eşleşen tüm kurallar sırayla uygulanır ve aynı başlığı yazan sonraki
        // kural kazanır: `/tr` altındaki sayfalar bu yüzden doğru dili alıyor.
        source: "/tr/:path*",
        headers: [{ key: "Content-Language", value: "tr" }],
      },
    ];
  },

  async redirects() {
    return [
      // Route adları İngilizceye taşındı; eski Türkçe adresler kalıcı olarak
      // yeni yollara gidiyor. Pazarlama sitelerinde bu bağlantılar dışarıda
      // yaşamaya devam ediyor, kırmak doğrudan trafik kaybı.
      { source: "/nasil-calisir", destination: PAGES.howItWorks, permanent: true },
      { source: "/kiyaslama", destination: PAGES.compare, permanent: true },
      { source: "/tasima", destination: PAGES.migrate, permanent: true },
      { source: "/belgeler", destination: PAGES.docs, permanent: true },

      // Kaçınılmaz "eski kampanya URL'i" durumu.
      { source: "/features", destination: PAGES.howItWorks, permanent: true },
      { source: "/benchmarks", destination: PAGES.compare, permanent: true },
      { source: "/releases", destination: PAGES.changelog, permanent: true },
    ];
  },

  async rewrites() {
    return {
      beforeFiles: [
        // Çok dilli sitelerde dil öneki altında bir sitemap aranması yaygın.
        // Ayrı bir dosya üretmek yerine aynı uca yazıyoruz: sitemap zaten her
        // dilin girdisini ve alternatiflerini içeriyor.
        { source: "/tr/sitemap.xml", destination: "/sitemap.xml" },
        { source: "/tr/robots.txt", destination: "/robots.txt" },
      ],
    };
  },

  async cache() {
    return {
      /**
       * İçerik yalnızca deploy ile değişiyor, dolayısıyla TTL'i kısa tutmanın
       * bir faydası yok: bir saat boyunca bellekten servis edilir. Tablo yol
       * listesinden türetiliyor, yani yeni bir sayfa ya da dil eklendiğinde
       * burada güncellenecek bir şey kalmıyor.
       */
      html: Object.fromEntries(
        [...pagePaths(), ...docPaths()].map((pathname) => [pathname, HOUR]),
      ),

      prewarm: {
        enabled: true,
        // Sayfa sayısı belge bölümüyle iki katına çıktı; sınır listeyi
        // kesmeyecek kadar yukarıda durmalı, yoksa ısıtma sessizce yarısını
        // atlar.
        max: 80,
        concurrency: 4,
        intervalSeconds: 0,
      },
    };
  },

  hooks: {
    metadata() {
      const t = getContent(DEFAULT_LOCALE);

      return {
        titleTemplate: t.meta.titleTemplate,
        description: t.meta.description,
        siteUrl: SITE_URL,
        locale: t.ogLocale,
        openGraph: {
          siteName: "JSkelet",
          type: "website",
          image: "https://cdn.ayberkenis.com.tr/jskelet/jskelet.png",
        },
        twitter: { card: "summary_large_image" },
      };
    },

    layoutContext({ pathname }) {
      const { locale, basePath } = resolveLocale(pathname);
      const t = getContent(locale);
      const release = getRelease();

      const paths = Object.fromEntries(
        Object.entries(PAGES).map(([key, page]) => [
          key,
          localePath(locale, page),
        ]),
      );

      return {
        pathname,
        locale,
        // `lang` özel yorumlanır: `<html lang>` bunu okur.
        lang: t.htmlLang,
        // Sayfaya özel bir gövde sınıfı gerektiğinde bu alan genişletilebilir.
        // Temel renkler Tailwind'in taradığı layout'ta; aksi hâlde CSS'e girmez.
        bodyClass: "",
        t,
        paths,
        release,
        nav: t.nav.map((item) => ({
          href: paths[item.key],
          label: item.label,
          // Belge bölümünün alt sayfaları da "Docs" başlığına ait: eşitlik
          // kontrolü tek başına `/docs/routing` üzerinde menüyü sönük
          // bırakıyordu.
          // Ana sayfa önek kontrolünden muaf: `/tr` her Türkçe yolun öneki.
          active:
            pathname === paths[item.key] ||
            (paths[item.key] !== paths.home &&
              pathname.startsWith(`${paths[item.key]}/`)),
        })),
        // Dil değiştirici ve `hreflang` etiketleri aynı listeden besleniyor;
        // ayrıştıklarında düğmenin götürdüğü yer ile arama motoruna bildirilen
        // adres farklı oluyor.
        languages: alternatePaths(basePath).map((alternate) => ({
          ...alternate,
          label: getContent(alternate.locale).label,
          short: getContent(alternate.locale).short,
          current: alternate.locale === locale,
        })),
        structuredData: [
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "JSkelet",
            applicationCategory: "DeveloperApplication",
            operatingSystem: `Node.js ${release.nodeLabel}`,
            softwareVersion: release.version,
            license: release.license,
            inLanguage: t.htmlLang,
            url: `${SITE_URL}${paths.home}`,
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          },
        ],
      };
    },

    notFound() {
      // Hook yol bilgisi almıyor, yani 404 dili seçilemez; varsayılan dil
      // basılıyor ve sayfa her iki dile de bağlantı veriyor.
      const t = getContent(DEFAULT_LOCALE);

      return {
        view: "pages/not-found",
        data: {
          t,
          locale: DEFAULT_LOCALE,
          paths: Object.fromEntries(
            Object.entries(PAGES).map(([key, page]) => [
              key,
              localePath(DEFAULT_LOCALE, page),
            ]),
          ),
        },
        metadata: {
          title: t.notFound.title,
          robots: { index: false, follow: false },
        },
      };
    },

    prewarmPaths() {
      return [...pagePaths(), ...docPaths()];
    },
  },
};
