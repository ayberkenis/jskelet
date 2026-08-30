/**
 * Belge bölümünün veri katmanı: hangi belge hangi dosyadan geliyor, hangi
 * sırada duruyor ve markdown içindeki dosya bağlantıları hangi URL'e çevriliyor.
 *
 * Belgeler sitenin içinde değil, **kurulu paketin içinde** yaşıyor:
 * `node_modules/jskelet/docs/`. Gerekçesi `lib/release.js` ile aynı — sayfada
 * görünen şey kurulu sürümün kendisi olsun. Pratik sonucu da güzel: paket
 * yükseldiğinde site yeni belgeleri kendiliğinden servis eder, kopyalanmış bir
 * dizin eskimeye başlamaz.
 *
 * Yol hesabı `getConfig().root` üzerinden yapılıyor; `../..` sayan bir satır
 * paket `node_modules` içine girdiğinde bozulur.
 */
import fs from "node:fs";
import path from "node:path";

import { getConfig } from "jskelet";

import { DEFAULT_LOCALE, LOCALES, PAGES, localePath } from "./i18n.js";
import { renderMarkdown } from "./markdown.js";

/**
 * @typedef {import("./i18n.js").Locale} Locale
 *
 * @typedef {object} DocEntry
 * @property {string} slug URL parçası; her dilde aynı
 * @property {string} group Sidebar bölümü anahtarı
 * @property {Record<Locale, string>} files Dile göre kaynak dosya
 *
 * @typedef {object} DocPage
 * @property {string} slug
 * @property {string} group
 * @property {string} title Belgenin `#` başlığı
 * @property {string} intro İlk paragraf; meta açıklaması olarak kullanılır
 * @property {string} html Gövde
 * @property {import("./markdown.js").TocEntry[]} toc
 * @property {string} editUrl Kaynak dosyanın GitHub adresi
 * @property {string} file Kaynak dosyanın paket içindeki yolu
 * @property {boolean} translated Bu dilde ayrı bir çeviri var mı
 */

const REPOSITORY = "https://github.com/ayberkenis/jskelet";
const BRANCH = "master";

/** Sidebar bölümleri, göründükleri sırada. Başlıkları içerik sözlüğünden. */
export const DOC_GROUPS = ["start", "build", "performance", "reference"];

/**
 * Belge sırası. Tek kaynak: sidebar, önceki/sonraki gezinme, sitemap, prewarm
 * ve cache tablosu hepsi bunu okuyor.
 *
 * @type {DocEntry[]}
 */
export const DOCS = [
  {
    slug: "getting-started",
    group: "start",
    files: { en: "en/01-getting-started.md", tr: "01-baslangic.md" },
  },
  {
    slug: "architecture",
    group: "start",
    files: { en: "en/02-architecture.md", tr: "02-mimari.md" },
  },
  {
    slug: "routing",
    group: "build",
    files: { en: "en/03-routing.md", tr: "03-routing.md" },
  },
  {
    slug: "rendering",
    group: "build",
    files: { en: "en/04-rendering.md", tr: "04-render-ve-sablonlar.md" },
  },
  {
    slug: "islands",
    group: "build",
    files: { en: "en/05-islands.md", tr: "05-islands.md" },
  },
  {
    slug: "caching",
    group: "performance",
    files: { en: "en/06-caching.md", tr: "06-cache.md" },
  },
  {
    slug: "build",
    group: "performance",
    files: { en: "en/08-build.md", tr: "08-build.md" },
  },
  {
    slug: "configuration",
    group: "reference",
    files: { en: "en/07-configuration.md", tr: "07-yapilandirma.md" },
  },
  {
    slug: "dev-tools",
    group: "reference",
    files: { en: "en/09-dev-tools.md", tr: "09-dev-araclari.md" },
  },
  {
    slug: "deployment",
    group: "reference",
    files: { en: "en/10-deployment.md", tr: "10-dagitim.md" },
  },
  {
    slug: "migration",
    group: "reference",
    files: { en: "en/11-migration.md", tr: "11-tasima.md" },
  },
];

/**
 * Markdown içindeki dosya adı → slug. Belgeler birbirine `./06-cache.md` gibi
 * dosya adıyla bağlanıyor; sitede o bağlantının bir URL'e dönmesi gerekiyor ve
 * iki dilin dosya adları farklı olduğu için eşleme her iki adı da taşıyor.
 *
 * @type {Map<string, string>}
 */
const FILE_TO_SLUG = new Map();
for (const doc of DOCS) {
  for (const file of Object.values(doc.files)) {
    FILE_TO_SLUG.set(path.posix.basename(file), doc.slug);
  }
}

/** @type {Map<string, DocPage>} */
const cache = new Map();

/**
 * Bir belgenin URL'i.
 *
 * @param {Locale} locale
 * @param {string} slug
 * @returns {string}
 */
export function docPath(locale, slug) {
  return localePath(locale, `${PAGES.docs}/${slug}`);
}

/**
 * Sitemap, prewarm ve cache TTL tablosu için her dildeki her belge yolu.
 *
 * @returns {string[]}
 */
export function docPaths() {
  return LOCALES.flatMap((locale) =>
    DOCS.map((doc) => docPath(locale, doc.slug)),
  );
}

/**
 * Sidebar ağacı. Grup başlıkları ve kısa etiketler sözlükten geliyor: belgenin
 * kendi `#` başlığı bir cümle uzunluğunda olabiliyor ve sidebar'da satır
 * kaydırmadan durması gerekiyor.
 *
 * @param {Locale} locale
 * @param {Record<string, string>} labels Slug → kısa etiket
 * @param {Record<string, string>} groups Grup anahtarı → başlık
 * @returns {Array<{ key: string, title: string,
 *   items: Array<{ slug: string, label: string, href: string }> }>}
 */
export function docNavigation(locale, labels, groups) {
  return DOC_GROUPS.map((key) => ({
    key,
    title: groups[key] ?? key,
    items: DOCS.filter((doc) => doc.group === key).map((doc) => ({
      slug: doc.slug,
      label: labels[doc.slug] ?? doc.slug,
      href: docPath(locale, doc.slug),
    })),
  })).filter((group) => group.items.length > 0);
}

/**
 * Bir belgenin render edilmiş hâli. Süreç belleğinde saklanıyor: HTML cache
 * zaten sayfanın tamamını tutuyor, ama cache boşaltıldığında ya da bir fragment
 * ucu aynı belgeyi istediğinde dosyayı ikinci kez ayrıştırmanın anlamı yok.
 *
 * @param {Locale} locale
 * @param {string} slug
 * @param {{ copy?: { idle: string, done: string, failed: string } }} [options]
 * @returns {DocPage | null}
 */
export function getDoc(locale, slug, options = {}) {
  const entry = DOCS.find((doc) => doc.slug === slug);
  if (!entry) return null;

  const key = `${locale}:${slug}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const requested = entry.files[locale];
  const fallback = entry.files[DEFAULT_LOCALE];
  const source = readDoc(requested) ?? readDoc(fallback);

  // Çeviri dosyası eksikse sayfayı düşürmek yerine varsayılan dile düşüyoruz:
  // eksik bir dosya yüzünden belge bölümünün tamamının 500 dönmesi, okunabilir
  // ama yanlış dilde bir sayfadan daha kötü.
  if (source === null) return null;

  const translated = source.file === requested;

  const rendered = renderMarkdown(source.text, {
    copy: options.copy,
    resolveLink: (href) => resolveDocLink(href, locale),
  });

  /** @type {DocPage} */
  const page = {
    slug: entry.slug,
    group: entry.group,
    title: rendered.title || slug,
    intro: rendered.intro,
    html: rendered.html,
    toc: rendered.toc,
    editUrl: `${REPOSITORY}/blob/${BRANCH}/docs/${source.file}`,
    file: source.file,
    translated,
  };

  cache.set(key, page);
  return page;
}

/**
 * Sıralı gezinme. Belgeler baştan sona okunacak şekilde yazıldı; alt tarafta
 * "önceki / sonraki" olmadan okuyucu her seferinde sidebar'a dönmek zorunda
 * kalıyor.
 *
 * @param {Locale} locale
 * @param {string} slug
 * @param {Record<string, string>} labels
 * @returns {{ previous: { label: string, href: string } | null,
 *   next: { label: string, href: string } | null }}
 */
export function docSiblings(locale, slug, labels) {
  const index = DOCS.findIndex((doc) => doc.slug === slug);
  if (index === -1) return { previous: null, next: null };

  return {
    previous: sibling(DOCS[index - 1]),
    next: sibling(DOCS[index + 1]),
  };

  /**
   * @param {DocEntry | undefined} doc
   * @returns {{ label: string, href: string } | null}
   */
  function sibling(doc) {
    if (!doc) return null;
    return {
      label: labels[doc.slug] ?? doc.slug,
      href: docPath(locale, doc.slug),
    };
  }
}

/**
 * Markdown bağlantısını site URL'ine çevirir. Belge dosyası tanınmıyorsa
 * (`../README.md`, harici adres) olduğu gibi bırakılır.
 *
 * @param {string} href
 * @param {Locale} locale
 * @returns {string}
 */
function resolveDocLink(href, locale) {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return href;

  const [target, hash] = href.split("#");
  const file = path.posix.basename(target);

  if (file === "README.md") {
    return localePath(locale, PAGES.docs) + (hash ? `#${hash}` : "");
  }

  const slug = FILE_TO_SLUG.get(file);
  if (!slug) return href;

  return docPath(locale, slug) + (hash ? `#${hash}` : "");
}

/**
 * @param {string} file Paketin `docs/` dizinine göre yol
 * @returns {{ text: string, file: string } | null}
 */
function readDoc(file) {
  const absolute = path.join(
    getConfig().root,
    "node_modules",
    "jskelet",
    "docs",
    ...file.split("/"),
  );

  try {
    return { text: fs.readFileSync(absolute, "utf8"), file };
  } catch {
    // Paket başka bir yerden çözülüyor ya da belge dizini yayına girmemiş
    // olabilir. Çağıran taraf `null` görürse 404 üretiyor.
    return null;
  }
}
