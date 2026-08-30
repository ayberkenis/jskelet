/**
 * Sitenin bütün HTML sayfaları. Her sayfa iki dilde kayıtlı ve tek bir döngüden
 * geçiyor: yol tablosu `lib/i18n.js`, metin `lib/content/<dil>.js`, şablon ise
 * dilden bağımsız. Yeni bir dil eklemek buraya bir satır bile yazmayı
 * gerektirmiyor.
 *
 * Hepsi anonim ve içerik derleme zamanında bilindiği için `revalidate` uzun;
 * gerçek TTL'ler `jskelet.config.mjs` içindeki `cache().html` tablosundan
 * geliyor ve buradaki değeri ezer. İkisini birlikte yazmanın faydası: config'i
 * olmayan bir kurulumda da makul bir davranış kalıyor.
 */
import { getContent } from "../lib/content.js";
import { LOCALES, PAGES, alternatePaths, localePath } from "../lib/i18n.js";
import { getPayload } from "../lib/payload.js";
import { COMMANDS, getRelease } from "../lib/release.js";

const HOUR = 3600;
const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

/** Sayfa anahtarı → şablon. Anahtarlar `PAGES` ile aynı kümedir. */
const VIEWS = {
  home: "pages/home",
  howItWorks: "pages/how-it-works",
  compare: "pages/compare",
  migrate: "pages/migrate",
  docs: "pages/docs",
  changelog: "pages/changelog",
  download: "pages/download",
};

export default function register(app, { route }) {
  for (const locale of LOCALES) {
    const t = getContent(locale);
    const paths = localizedPaths(locale);

    for (const [key, basePath] of Object.entries(PAGES)) {
      const pathname = paths[key];

      app.get(
        pathname,
        route(
          async () => ({
            view: VIEWS[key],
            metadata: {
              title: t.pages[key].title,
              description: t.pages[key].description,
              canonical: pathname,
              locale: t.ogLocale,
              // Şema hreflang bilmiyor; ham etiket için ayrılmış alan bu.
              extraTags: hreflangTags(basePath),
            },
            data: {
              t,
              locale,
              paths,
              ...pageData(key, t, locale),
            },
          }),
          { revalidate: HOUR },
        ),
      );
    }
  }
}

/**
 * Bir dildeki tüm sayfaların yolları. Şablonlar bağlantı kurarken bu haritayı
 * okuyor; her `<a>`da dil öneki hesaplamak, bir gün unutulacak bir tekrar.
 *
 * @param {import("../lib/i18n.js").Locale} locale
 * @returns {Record<string, string>}
 */
function localizedPaths(locale) {
  return Object.fromEntries(
    Object.entries(PAGES).map(([key, basePath]) => [
      key,
      localePath(locale, basePath),
    ]),
  );
}

/**
 * Sayfaya özel veriler. Ölçülen değerler (`getPayload`, `getRelease`) burada
 * çözülüyor: şablonun dosya okumaması gerekiyor.
 *
 * @param {string} key
 * @param {ReturnType<typeof getContent>} t
 * @param {import("../lib/i18n.js").Locale} locale
 * @returns {object}
 */
function pageData(key, t, locale) {
  switch (key) {
    case "home":
      return {
        pillars: t.pillars,
        payload: getPayload(),
        fit: t.fit,
        // Ana sayfada kısa bir seçki; tamamı taşıma sayfasında.
        faq: t.faq.slice(0, 4),
        release: getRelease(),
        commands: COMMANDS,
      };

    case "howItWorks":
      return { pipeline: t.pipeline, pillars: t.pillars };

    case "compare":
      return {
        comparison: t.comparison,
        fit: t.fit,
        payload: getPayload(),
        // Ölçüm aynı dildeki ana sayfayı yokluyor: başka bir dilin yolunu
        // ölçmek ilk turda kaçınılmaz bir MISS üretirdi.
        cachedUrl: localePath(locale, PAGES.home),
      };

    case "migrate":
      return { migration: t.migrate.items, faq: t.faq };

    case "docs":
      return { docs: t.docs.items };

    case "changelog":
      return { entries: t.changelog.entries, release: getRelease() };

    case "download":
      return { release: getRelease(), commands: COMMANDS };

    default:
      return {};
  }
}

/**
 * `hreflang` etiketleri. Mutlak URL zorunlu, bu yüzden `SITE_URL` üzerinden
 * kuruluyor; `x-default` varsayılan dile işaret eder.
 *
 * @param {string} basePath
 * @returns {string[]}
 */
function hreflangTags(basePath) {
  const alternates = alternatePaths(basePath);

  return [
    ...alternates.map(
      ({ locale, href }) =>
        `<link rel="alternate" hreflang="${locale}" href="${SITE_URL}${href}">`,
    ),
    `<link rel="alternate" hreflang="x-default" href="${SITE_URL}${basePath}">`,
  ];
}
