/**
 * Örnek bir Next.js App Router sayfasının **tahmini** ilk-yük gzip
 * ağırlıkları. Bu depoda Next build'i yok; sayılar tipik `create-next-app`
 * + App Router çıktılarından (First Load JS ~90–110 kB gzip bandı) ve bilinen
 * React/ReactDOM gzip boyutlarından türetilmiş yuvarlak tahminler.
 *
 * Amaç: JSkelet'in **ölçülen** çıktısını yan yana koymak. İddia "her Next
 * sitesi budur" değil — "boş bir App Router sayfasında framework zaten bu
 * kadar taşıyor" bandını göstermek.
 */

/** @typedef {{ key: string, gzip: number }} NextEstimateEntry */

/** @type {NextEstimateEntry[]} */
export const NEXT_SAMPLE_ENTRIES = [
  // React 19 + react-dom (~gzip); Bundlephobia / production minify bandı.
  { key: "react", gzip: 44_000 },
  // next/dist client + app-router hydration / flight runtime — First Load
  // JS'in framework payı için muhafazakâr orta değer.
  { key: "nextRuntime", gzip: 48_000 },
  // Sayfa + paylaşılan uygulama chunk'ı (minimal marketing/home).
  { key: "page", gzip: 10_000 },
  // Tailwind benzeri tek stylesheet; bu siteninkine yakın bir mertebe.
  { key: "css", gzip: 16_000 },
];

/** @type {number} */
export const NEXT_SAMPLE_TOTAL_GZIP = NEXT_SAMPLE_ENTRIES.reduce(
  (sum, entry) => sum + entry.gzip,
  0,
);

/**
 * @returns {{ entries: NextEstimateEntry[], totalGzip: number }}
 */
export function getNextSampleEstimate() {
  return {
    entries: NEXT_SAMPLE_ENTRIES,
    totalGzip: NEXT_SAMPLE_TOTAL_GZIP,
  };
}
