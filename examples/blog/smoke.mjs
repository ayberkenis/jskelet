/**
 * Örneğin uçtan uca çalıştığını doğrulayan küçük duman testi.
 *
 *   node smoke.mjs            # sunucu 3210'da ayakta olmalı
 */
const BASE = process.env.BASE ?? "http://localhost:3210";

/** @type {Array<[string, number, RegExp?]>} */
const CASES = [
  ["/", 200, /Son yazılar/],
  ["/blog", 200, /data-island="search"/],
  ["/blog/html-cache-ve-swr", 200, /dk okuma/],
  ["/etiket/cache", 200, /etiketli yazılar/],
  ["/iletisim", 200, /data-island="contact-form"/],
  ["/iletisim?sent=1", 200, /Mesajınız alındı/],
  ["/rss.xml", 200, /<rss/],
  ["/sitemap.xml", 200, /<urlset/],
  ["/robots.txt", 200, /Sitemap:/],
  ["/api/healthcheck", 200, /ok/],
  ["/feed", 200, /<rss/],
  ["/posts", 308],
  ["/yazi/html-cache-ve-swr", 308],
  ["/_fragment/posts-by-tag?tag=cache", 200, /<li/],
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
    `${statusOk && bodyOk ? "✓" : "✗"} ${pathname.padEnd(38)} ${response.status} (expected ${expectedStatus}) cache=${cache}${bodyOk ? "" : " · body did not match"}`,
  );
}

// İkinci geçiş: aynı yollar artık önbellekten gelmeli.
const second = await fetch(`${BASE}/blog`);
console.log(`\ncache on second request: ${second.headers.get("x-jskelet-cache")}`);

console.log(failed ? `\n${failed} test(s) failed` : "\nall passed");

// `process.exit()` değil: açık fetch handle'ları varken zorla çıkmak
// Windows'ta libuv assertion'ına düşüyor.
process.exitCode = failed ? 1 : 0;
