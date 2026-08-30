/**
 * Örneğin uçtan uca çalıştığını doğrulayan küçük duman testi.
 *
 *   node smoke.mjs                       # sunucu 3000'de ayakta olmalı
 *   BASE=http://localhost:3210 node smoke.mjs
 */
const BASE = process.env.BASE ?? "http://localhost:3000";

/** @type {Array<[string, number, RegExp?]>} */
const CASES = [
  // Varsayılan dil kökte.
  ["/", 200, /The skeleton of the web/],
  ["/", 200, /data-island="theme-toggle"/],
  ["/", 200, /hreflang="tr"/],
  ["/", 200, /lang="en"/],
  ["/how-it-works", 200, /five clear stops/],
  ["/compare", 200, /data-island="latency"/],
  ["/migrate", 200, /Next\.js/],
  ["/docs", 200, /href="\/docs\/getting-started"/],
  ["/changelog", 200, /Release history/],
  ["/download", 200, /data-island="copy-command"/],

  // Türkçe `/tr` altında, aynı İngilizce slug'larla.
  // Kesme işareti şablonda `&#39;` olarak basılıyor; desen çıktıyı arıyor.
  ["/tr", 200, /Web&#39;in iskeleti/],
  ["/tr", 200, /lang="tr"/],
  ["/tr/how-it-works", 200, /beş net durak/],
  ["/tr/compare", 200, /data-island="latency"/],
  ["/tr/migrate", 200, /Next\.js bilginizi/],
  ["/tr/docs", 200, /href="\/tr\/docs\/getting-started"/],
  ["/tr/changelog", 200, /Sürüm geçmişi/],
  ["/tr/download", 200, /Kurulumun tamamı/],

  // Belge bölümü: markdown paketin `docs/` dizininden okunup render ediliyor.
  // Kontrol edilen üç şey, çeviricinin üç ayrı yüzeyi: başlık anchor'ı (ve
  // dolayısıyla "bu sayfada" listesi), tablo sarmalayıcısı ve kod bloğu.
  ["/docs/getting-started", 200, /class="doc-prose/],
  ["/docs/getting-started", 200, /data-island="doc-toc"/],
  ["/docs/configuration", 200, /<div class="doc-table">/],
  ["/docs/caching", 200, /<div class="doc-code">/],
  // Belgeler arası bağlantılar dosya adı değil site URL'i olmalı.
  ["/docs/architecture", 200, /href="\/docs\/caching/],
  ["/docs/migration", 200, /Previous/],
  ["/tr/docs/getting-started", 200, /class="doc-prose/],
  ["/tr/docs/caching", 200, /href="\/tr\/docs\//],
  ["/docs/bilinmeyen-bolum", 404],

  ["/_fragment/render-demo", 200, /<li/],
  ["/robots.txt", 200, /Sitemap:/],
  ["/sitemap.xml", 200, /<urlset/],
  ["/sitemap.xml", 200, /hreflang="x-default"/],
  ["/api/healthcheck", 200, /ok/],

  // Rewrite: dil öneki altındaki sitemap aynı uca yazılıyor.
  ["/tr/sitemap.xml", 200, /<urlset/],

  // Eski Türkçe adresler ve kampanya URL'leri kalıcı yönlendirmede.
  ["/nasil-calisir", 308],
  ["/kiyaslama", 308],
  ["/tasima", 308],
  ["/belgeler", 308],
  ["/features", 308],
  ["/benchmarks", 308],
  ["/releases", 308],

  ["/bilinmeyen-sayfa", 404, /Page not found/],
];

let failed = 0;

for (const [pathname, expectedStatus, expectedBody] of CASES) {
  const response = await fetch(`${BASE}${pathname}`, { redirect: "manual" });
  const body = await response.text();

  const statusOk = response.status === expectedStatus;
  const bodyOk = !expectedBody || expectedBody.test(body);
  const cache = response.headers.get("x-jskelet-cache") ?? "-";

  if (!statusOk || !bodyOk) failed += 1;

  console.log(
    `${statusOk && bodyOk ? "✓" : "✗"} ${pathname.padEnd(26)} ${response.status} (expected ${expectedStatus}) cache=${cache}${bodyOk ? "" : " · body did not match"}`,
  );
}

// Fragment ucu ölçümün kontrol grubu; cache'e girerse karşılaştırma anlamsız.
const fragment = await fetch(`${BASE}/_fragment/render-demo`);
const fragmentCacheControl = fragment.headers.get("cache-control");
if (fragmentCacheControl !== "no-store") {
  failed += 1;
  console.log(`✗ /_fragment/render-demo cache-control=${fragmentCacheControl}`);
}

const second = await fetch(`${BASE}/compare`);
console.log(`\ncache on second request: ${second.headers.get("x-jskelet-cache")}`);

console.log(failed ? `\n${failed} test(s) failed` : "\nall passed");

// `process.exit()` değil: açık fetch handle'ları varken zorla çıkmak
// Windows'ta libuv assertion'ına düşüyor.
process.exitCode = failed ? 1 : 0;
