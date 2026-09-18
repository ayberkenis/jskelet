/**
 * Dinamik Open Graph görselleri — blog örneğindeki `ogHandler` sözleşmesi.
 *
 * HTML değil PNG/SVG döndüğü için `route()` kullanılmaz. Sayfa metadata'sı
 * `openGraph.image` ile bu URL'yi işaret eder; CDN'deki sabit logo yalnızca
 * varsayılan fallback olarak config hook'unda kalır.
 */
import { getContent } from "../lib/content.js";
import { DOCS } from "../lib/docs.js";
import { LOCALES, PAGES } from "../lib/i18n.js";

const PAGE_KEYS = new Set(Object.keys(PAGES));
const DOC_SLUGS = new Set(DOCS.map((entry) => entry.slug));

export default function register(app, { ogHandler, notFound }) {
  app.get(
    // Express 5 / path-to-regexp: `:page.png` içindeki `.` "herhangi bir karakter"
    // sanılır; uzantıyı sabitlemek için kaçış şart.
    "/og/:locale/:page\\.png",
    ogHandler(async ({ params }) => {
      const locale = params.locale;
      if (!LOCALES.includes(locale)) notFound();

      const t = getContent(locale);
      const page = params.page;
      const card = resolveCard(t, page);
      if (!card) notFound();

      return {
        title: card.title,
        description: card.description,
        siteName: "JSkelet",
        background: "#050814",
        accent: "#22d3ee",
        color: "#f8fafc",
        mutedColor: "#94a3b8",
      };
    }),
  );
}

/**
 * @param {ReturnType<typeof getContent>} t
 * @param {string} page
 * @returns {{ title: string, description: string } | null}
 */
function resolveCard(t, page) {
  if (PAGE_KEYS.has(page) && t.pages[page]) {
    return {
      title: t.pages[page].title,
      description: t.pages[page].description,
    };
  }

  if (page.startsWith("docs-")) {
    const slug = page.slice("docs-".length);
    if (!DOC_SLUGS.has(slug)) return null;
    const item = t.docs.items.find((entry) => entry.slug === slug);
    if (!item) return null;
    return { title: item.title, description: item.body };
  }

  return null;
}
