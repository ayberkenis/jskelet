/**
 * Örneğin uçtan uca çalıştığını doğrulayan küçük duman testi.
 *
 *   node smoke.mjs                       # sunucu 3000'de ayakta olmalı
 *   BASE=http://localhost:3210 node smoke.mjs
 */
const BASE = process.env.BASE ?? "http://localhost:3000";

/** @type {Array<[string, number, RegExp?]>} */
const CASES = [
  ["/", 200, /Sunucuda tam HTML/],
  ["/", 200, /data-island="theme-toggle"/],
  ["/nasil-calisir", 200, /beş adım/],
  ["/kiyaslama", 200, /data-island="latency"/],
  ["/tasima", 200, /karşılık tablosu/],
  ["/belgeler", 200, /11-tasima/],
  ["/_fragment/render-demo", 200, /<li/],
  ["/robots.txt", 200, /Sitemap:/],
  ["/sitemap.xml", 200, /<urlset/],
  ["/api/healthcheck", 200, /ok/],
  ["/docs", 200, /Belgeler/],
  ["/features", 308],
  ["/benchmarks", 308],
  ["/bilinmeyen-sayfa", 404, /Sayfa bulunamadı/],
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
    `${statusOk && bodyOk ? "✓" : "✗"} ${pathname.padEnd(26)} ${response.status} (beklenen ${expectedStatus}) cache=${cache}${bodyOk ? "" : " · gövde eşleşmedi"}`,
  );
}

// Fragment ucu ölçümün kontrol grubu; cache'e girerse karşılaştırma anlamsız.
const fragment = await fetch(`${BASE}/_fragment/render-demo`);
const fragmentCacheControl = fragment.headers.get("cache-control");
if (fragmentCacheControl !== "no-store") {
  failed += 1;
  console.log(`✗ /_fragment/render-demo cache-control=${fragmentCacheControl}`);
}

const second = await fetch(`${BASE}/kiyaslama`);
console.log(`\ncache ikinci istek: ${second.headers.get("x-jskelet-cache")}`);

console.log(failed ? `\n${failed} test başarısız` : "\nhepsi geçti");

// `process.exit()` değil: açık fetch handle'ları varken zorla çıkmak
// Windows'ta libuv assertion'ına düşüyor.
process.exitCode = failed ? 1 : 0;
