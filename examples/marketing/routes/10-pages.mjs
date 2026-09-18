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
import { getChangelog, renderChange } from "../lib/changelog.js";
import { format, getContent } from "../lib/content.js";
import {
  DOCS,
  docNavigation,
  docPath,
  docSiblings,
  docSummaries,
  getDoc,
} from "../lib/docs.js";
import { LOCALES, PAGES, alternatePaths, localePath } from "../lib/i18n.js";
import { ogImageUrl } from "../lib/og.js";
import { formatBytes, getPayload } from "../lib/payload.js";
import { getNextSampleEstimate } from "../lib/next-estimate.js";
import { COMMANDS, getPublishedRelease, getRelease } from "../lib/release.js";

const HOUR = 3600;
const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";

/** Ana sayfa cache örnek kodu — şablon literal `.jsk` içinde yasak. */
const HOME_CACHE_CODE = `export default function register(app, { route, notFound }) {
  app.get("/", route(
    async () => ({
      view: "pages/home",
      data: { pillars },
    }),
    { revalidate: 3600 },
  ));

  app.get("/product/:slug", route(async ({ params }) => {
    const product = await getProduct(params.slug);
    if (!product) notFound();
    return { view: "pages/product", data: { product } };
  }));
}`;

const HOW_IT_WORKS_VIEW_CODE = `<section>
  <h1>{{ title }}</h1>
  <div
    data-island="pricing-calculator"
    data-island-props='{"currency":"USD"}'
  >
    <!-- pricing table HTML came from the server -->
    <table data-seats-table>...</table>
  </div>
</section>`;

const HOW_IT_WORKS_ISLAND_CODE = `import { on, qs } from "jskelet/client";

export function mount(element, props) {
  const input = qs(element, "[data-seats]");

  return on(input, "input", () => {
    // The table markup came from the server;
    // the island only updates the number.
    paint(element, Number(input.value), props.currency);
  });
}`;

const MIGRATE_CONFIG_CODE = `export default {
  async redirects() {
    return [
      { source: "/post/:slug", destination: "/blog/:slug", permanent: true },
    ];
  },

  async cache() {
    return {
      html: { "/": 3600, "/blog/:slug": 300 },
      prewarm: { enabled: true, max: 200, concurrency: 4 },
    };
  },

  hooks: {
    metadata() {
      return { titleTemplate: "%s | Site", siteUrl: SITE_URL };
    },
  },
};`;

const DOCS_EXAMPLE_CODE =
  "npm --prefix examples/marketing install\nnpm --prefix examples/marketing run dev";

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

export default function register(app, { route, notFound }) {
  for (const locale of LOCALES) {
    const t = getContent(locale);
    const paths = localizedPaths(locale);

    registerDocs(app, { route, notFound }, { locale, t, paths });

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
              openGraph: {
                image: ogImageUrl(locale, key),
                imageWidth: 1200,
                imageHeight: 630,
              },
              // Şema hreflang bilmiyor; ham etiket için ayrılmış alan bu.
              extraTags: hreflangTags(basePath),
            },
            data: {
              t,
              locale,
              // Layout local'leri sayfa şablonuna geçmiyor; sidebar'ın etkin
              // bağlantıyı işaretlemesi için yolu veriyle taşımak gerekiyor.
              pathname,
              paths,
              copyLabels: {
                idle: t.ui.copy,
                done: t.ui.copied,
                failed: t.ui.copyFailed,
              },
              ...(await pageData(key, t, locale)),
            },
          }),
          { revalidate: HOUR },
        ),
      );
    }
  }
}

/**
 * Belge sayfaları. Slug'lar derleme zamanında bilindiği için her biri **açık
 * bir route** olarak kaydediliyor; `/docs/:slug` bir yakalayıcı olurdu ve
 * olmayan bir belge için 404 üretmek controller'ın işine kalırdı. Açık kayıt
 * ayrıca prewarm ve cache tablosuyla birebir aynı listeden besleniyor.
 *
 * @param {import("express").Application} app
 * @param {{ route: Function, notFound: Function }} api
 * @param {{ locale: import("../lib/i18n.js").Locale,
 *   t: ReturnType<typeof getContent>, paths: Record<string, string> }} context
 * @returns {void}
 */
function registerDocs(app, { route, notFound }, { locale, t, paths }) {
  const labels = Object.fromEntries(
    t.docs.items.map((item) => [item.slug, item.title]),
  );
  const navigation = docNavigation(locale, labels, t.docs.groups);
  const copy = { idle: t.ui.copy, done: t.ui.copied, failed: t.ui.copyFailed };

  for (const entry of DOCS) {
    const pathname = docPath(locale, entry.slug);
    const basePath = `${PAGES.docs}/${entry.slug}`;

    app.get(
      pathname,
      route(
        async () => {
          const doc = await getDoc(locale, entry.slug, { copy, labels });

          // Belge dosyası okunamıyorsa (paket belgeleri olmadan kurulmuş) sayfa
          // 500 yerine 404 dönüyor: eksik bir dosya sitenin hatası değil.
          if (!doc) notFound();

          return {
            view: "pages/doc",
            metadata: {
              title: doc.title,
              description: summarize(doc.intro),
              canonical: pathname,
              locale: t.ogLocale,
              openGraph: {
                image: ogImageUrl(locale, `docs-${entry.slug}`),
                imageWidth: 1200,
                imageHeight: 630,
              },
              extraTags: hreflangTags(basePath),
            },
            data: {
              t,
              locale,
              pathname,
              paths,
              doc,
              docsNav: navigation,
              siblings: docSiblings(locale, entry.slug, labels),
              release: getRelease(),
              docsBrowseLabels: { ...t.docs.shell, nav: t.docs.shell.browse },
              docsVersionLabel: format(t.docs.shell.version, getRelease().version),
              docsPagerLabels: {
                previous: t.docs.shell.previous,
                next: t.docs.shell.next,
              },
            },
          };
        },
        { revalidate: HOUR },
      ),
    );
  }
}

/**
 * Meta açıklaması için ilk paragrafı kısaltır. Arama sonucunda zaten kesiliyor;
 * cümlenin ortasında kesmek yerine son boşluktan kesmek daha okunur.
 *
 * @param {string} text
 * @returns {string}
 */
function summarize(text) {
  if (text.length <= 160) return text;
  const clipped = text.slice(0, 157);
  return `${clipped.slice(0, clipped.lastIndexOf(" "))}…`;
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
async function pageData(key, t, locale) {
  switch (key) {
    case "home": {
      const payload = getPayload();
      const release = getRelease();
      const totalGzip = payload.total ? formatBytes(payload.total.gzip) : "—";

      return {
        pillars: t.pillars,
        payload,
        fit: t.fit,
        // Ana sayfada kısa bir seçki; tamamı taşıma sayfasında.
        faq: t.faq.slice(0, 4),
        release,
        commands: COMMANDS,
        homeBadge: format(
          t.home.badge,
          release.nodeLabel,
          format(t.ui.license, release.license),
        ),
        trustItems: [
          {
            icon: "Package",
            value: totalGzip,
            label: t.home.trust.runtimeLabel,
          },
          {
            icon: "TextT",
            value: t.home.trust.fontsValue,
            label: t.home.trust.fontsLabel,
          },
          {
            icon: "HardDrives",
            value: release.nodeLabel,
            label: t.home.trust.nodeLabel,
          },
          {
            icon: "ShieldCheck",
            value: release.license,
            label: t.home.trust.licenseLabel,
          },
          {
            icon: "Lightning",
            value: t.home.trust.stackValue,
            label: t.home.trust.stackLabel,
          },
        ],
        totalGzipLabel: totalGzip,
        cacheCode: HOME_CACHE_CODE,
      };
    }

    case "howItWorks":
      return {
        pipeline: t.pipeline,
        pillars: t.pillars,
        islandViewCode: HOW_IT_WORKS_VIEW_CODE,
        islandClientCode: HOW_IT_WORKS_ISLAND_CODE,
      };

    case "compare": {
      const payload = getPayload();
      const nextEstimate = getNextSampleEstimate();
      const labels = t.payloadLabels;

      return {
        comparison: t.comparison,
        fit: t.fit,
        payload,
        nextEstimate,
        latencyProps: JSON.stringify({
          runs: 6,
          cachedUrl: "/_fragment/render-demo-cached",
          freshUrl: "/_fragment/render-demo",
          upstreamMs: 80,
          done: t.compare.live.statusDone,
          failed: t.compare.live.statusFailed,
          bytesLabel: t.compare.live.bytesLabel,
          produceLabel: t.compare.live.produceLabel,
        }),
        barItems: payload.entries.map((entry) => ({
          label: labels[entry.name] ?? entry.name,
          value: entry.gzip,
          display: formatBytes(entry.gzip),
        })),
        weightOurs: payload.total
          ? {
              label: t.compare.weight.oursLabel,
              badge: t.compare.weight.oursBadge,
              totalGzip: payload.total.gzip,
              entries: payload.entries.map((entry) => ({
                label: labels[entry.name] ?? entry.name,
                gzip: entry.gzip,
              })),
            }
          : null,
        weightNext: nextEstimate
          ? {
              label: t.compare.weight.nextLabel,
              badge: t.compare.weight.nextBadge,
              totalGzip: nextEstimate.totalGzip,
              entries: nextEstimate.entries.map((entry) => ({
                label: t.compare.weight.nextEntries[entry.key] ?? entry.key,
                gzip: entry.gzip,
              })),
              note: t.compare.weight.nextNote,
            }
          : null,
      };
    }

    case "migrate":
      return {
        migration: t.migrate.items,
        faq: t.faq,
        migrateSteps: t.migrate.order.steps.map((step, index) => ({
          ...step,
          number: String(index + 1).padStart(2, "0"),
          bad: step.tone === "bad",
        })),
        migrateConfigCode: MIGRATE_CONFIG_CODE,
      };

    case "docs": {
      const labels = Object.fromEntries(
        t.docs.items.map((item) => [item.slug, item.title]),
      );
      const docsNav = docNavigation(locale, labels, t.docs.groups);

      return {
        docsNav,
        // Kartlar sidebar sırasını izliyor; şablonun slug'dan açıklamaya
        // ulaşması gerekiyor, bu yüzden dizi değil harita.
        summaries: Object.fromEntries(
          docSummaries(locale, t.docs.items).map((item) => [item.slug, item]),
        ),
        release: getRelease(),
        docsBrowseLabels: { ...t.docs.shell, nav: t.docs.shell.browse },
        docsStartHref: docsNav[0]?.items[0]?.href ?? "",
        docsExampleCode: DOCS_EXAMPLE_CODE,
      };
    }

    case "changelog": {
      const entries = await getChangelog();
      const release = getRelease();
      const releasedEntries = entries.filter((entry) => !entry.unreleased);
      const latestVersion = releasedEntries[0]?.version;
      const latestEntry = releasedEntries[0] || {
        version: release.version,
        date: "",
      };

      return {
        entries,
        release,
        published: await getPublishedRelease(),
        renderChange,
        changelogStatsData: {
          total: entries.length,
          released: releasedEntries.length,
          breaking: entries.filter((entry) =>
            entry.groups.some((group) => group.type === "breaking"),
          ).length,
          latest: {
            version: latestEntry.version,
            date: latestEntry.date || "",
          },
          labels: t.changelog,
        },
        changelogLabels: {
          ...t.changelog,
          copyDone: t.ui.copied,
          copyFailed: t.ui.copyFailed,
        },
        changelogCards: entries.map((entry) => ({
          entry,
          current: entry.version === release.version,
          latest: entry.version === latestVersion,
        })),
        changelogBrowseProps: JSON.stringify({
          showing: t.changelog.showing,
          page: t.changelog.pageLabel,
          empty: t.changelog.searchEmpty,
        }),
      };
    }

    case "download": {
      const release = getRelease();
      const copy = {
        idle: t.ui.copy,
        done: t.ui.copied,
        failed: t.ui.copyFailed,
      };

      return {
        release,
        commands: COMMANDS,
        downloadVersionLabel: format(t.ui.downloadVersion, release.version),
        downloadMeta: [
          {
            label: t.download.hero.versionLabel,
            value: `v${release.version}`,
            icon: "Tag",
          },
          {
            label: t.download.hero.licenseLabel,
            value: release.license,
            icon: "ShieldCheck",
          },
          {
            label: t.download.hero.nodeLabel,
            value: format(t.ui.nodeRequirement, release.nodeLabel),
            icon: "HardDrives",
          },
        ],
        downloadSteps: t.download.steps.items.map((step) => ({
          label: step.label,
          command: COMMANDS[step.command],
          note: step.note,
          copy,
        })),
        downloadServeStep: {
          label: t.download.steps.serveLabel,
          command: COMMANDS.start,
          note: t.download.steps.serveNote,
          copy,
        },
        downloadRequirements: t.download.requirements.items.map((item) => ({
          icon: item.icon,
          title: format(item.title, release.nodeLabel),
          body: item.body,
        })),
      };
    }

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
