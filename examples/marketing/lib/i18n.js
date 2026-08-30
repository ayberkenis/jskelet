/**
 * Sitenin iki dili var ve varsayılanı İngilizce. Framework'te i18n yok; bu
 * dosya uygulamanın kendi sözleşmesi.
 *
 * İki karar burada sabitleniyor:
 *
 * 1. **Varsayılan dil yol öneki taşımaz.** İngilizce `/docs`, Türkçe
 *    `/tr/docs`. Varsayılana da önek vermek `/` için bir yönlendirme zinciri
 *    ve kanonik adres tartışması getiriyor; kazancı yok.
 * 2. **Route adları her dilde İngilizce.** Slug'ları çevirmek iki ayrı yol
 *    tablosu, iki ayrı cache anahtarı kümesi ve her bağlantıda bir çeviri
 *    araması demek. Yol adı geliştiriciye, sayfa metni ziyaretçiye bakar.
 */

/** @typedef {"en" | "tr"} Locale */

/** @type {Locale} */
export const DEFAULT_LOCALE = "en";

/** @type {Locale[]} */
export const LOCALES = ["en", "tr"];

/**
 * Sitenin yol tablosu. Tek kaynak: route kaydı, nav, sitemap, prewarm ve
 * cache TTL tablosu hepsi buradan türetiliyor, yani yeni bir sayfa eklerken
 * yalnızca burası ve içerik sözlükleri değişiyor.
 */
export const PAGES = {
  home: "/",
  howItWorks: "/how-it-works",
  compare: "/compare",
  migrate: "/migrate",
  docs: "/docs",
  changelog: "/changelog",
  download: "/download",
};

/**
 * Dile göre gerçek URL. `basePath` her zaman `PAGES` içindeki İngilizce yol.
 *
 * @param {Locale} locale
 * @param {string} basePath
 * @returns {string}
 */
export function localePath(locale, basePath) {
  if (locale === DEFAULT_LOCALE) return basePath;
  return basePath === "/" ? `/${locale}` : `/${locale}${basePath}`;
}

/**
 * Bir isteğin yolundan dili ve dilsiz yolu çıkarır. Layout hem dili hem de
 * "hangi sayfadayım" bilgisini buna bakarak buluyor.
 *
 * @param {string} pathname
 * @returns {{ locale: Locale, basePath: string }}
 */
export function resolveLocale(pathname) {
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) continue;
    if (pathname === `/${locale}`) return { locale, basePath: "/" };
    if (pathname.startsWith(`/${locale}/`)) {
      return { locale, basePath: pathname.slice(locale.length + 1) };
    }
  }

  return { locale: DEFAULT_LOCALE, basePath: pathname };
}

/**
 * Sitemap ve prewarm için her dildeki her yol.
 *
 * @returns {string[]}
 */
export function pagePaths() {
  return LOCALES.flatMap((locale) =>
    Object.values(PAGES).map((basePath) => localePath(locale, basePath)),
  );
}

/**
 * Aynı sayfanın diğer dildeki karşılıkları. `hreflang` etiketleri ve dil
 * değiştirici aynı listeden besleniyor; ayrıştıklarında değiştiricinin
 * götürdüğü yer ile arama motoruna bildirilen adres farklı oluyor.
 *
 * @param {string} basePath
 * @returns {Array<{ locale: Locale, href: string }>}
 */
export function alternatePaths(basePath) {
  return LOCALES.map((locale) => ({
    locale,
    href: localePath(locale, basePath),
  }));
}
