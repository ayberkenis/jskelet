/**
 * Panelin uçtan uca duman testi.
 *
 *   node smoke.mjs                       # sunucu 3000'de ayakta olmalı
 *   BASE=http://localhost:3210 node smoke.mjs
 *
 * Buradaki testlerin çoğu görünüşe değil **politikaya** bakıyor: kişiye özel
 * bir sayfanın önbelleğe girmemesi, CSRF'siz bir POST'un reddedilmesi,
 * oturumsuz bir isteğin panele girememesi. Bunlar bozulduğunda ekranda hiçbir
 * şey değişmez; yakalayacak tek yer bu dosya.
 */
const BASE = process.env.BASE ?? "http://localhost:3000";

let failed = 0;

/**
 * @param {boolean} ok
 * @param {string} label
 * @param {string} [detail]
 */
function check(ok, label, detail) {
  if (!ok) failed += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` · ${detail}`}`);
}

/** @type {Array<[string, number, RegExp?]>} */
const CASES = [
  ["/", 200, /Kişiye özel sayfa/],
  ["/giris", 200, /name="kullanici"/],
  ["/api/healthcheck", 200, /ok/],
  ["/bilinmeyen-sayfa", 404, /Sayfa bulunamadı/],
];

for (const [pathname, expectedStatus, expectedBody] of CASES) {
  const response = await fetch(`${BASE}${pathname}`, { redirect: "manual" });
  const body = await response.text();

  const ok =
    response.status === expectedStatus && (!expectedBody || expectedBody.test(body));

  check(ok, `${pathname} → ${expectedStatus}`, `alınan ${response.status}`);
}

// ---------------------------------------------------------------------------
// Oturumsuz erişim
// ---------------------------------------------------------------------------

const anonim = await fetch(`${BASE}/panel`, { redirect: "manual" });
check(
  anonim.status === 307 && (anonim.headers.get("location") ?? "").startsWith("/giris"),
  "/panel oturumsuzken girişe yönlendirir",
  `${anonim.status} → ${anonim.headers.get("location")}`,
);

check(
  anonim.headers.get("cache-control") === "private, no-store",
  "yönlendirme bile önbelleklenmez",
  String(anonim.headers.get("cache-control")),
);

const anonimFragment = await fetch(`${BASE}/_fragment/siparisler`);
check(
  anonimFragment.status === 401,
  "fragment ucu oturumsuz isteği reddeder",
  String(anonimFragment.status),
);
check(
  anonimFragment.headers.get("cache-control") === "private, no-store",
  "fragment yanıtı no-store",
  String(anonimFragment.headers.get("cache-control")),
);

// ---------------------------------------------------------------------------
// Giriş
// ---------------------------------------------------------------------------

const loginPage = await fetch(`${BASE}/giris`);
const loginHtml = await loginPage.text();

// CSRF token'ı basıldığı için giriş sayfası cache'lenemez: `csrfField()`
// render'ı işaretliyor. Cache'ten dönseydi herkes aynı token'ı alırdı.
check(
  loginPage.headers.get("cache-control") === "private, no-store",
  "csrfField() basan sayfa önbelleğe girmez",
  String(loginPage.headers.get("cache-control")),
);

const csrfCookie = readCookie(loginPage, "csrf_token");
const csrfToken = loginHtml.match(/name="_csrf" value="([^"]+)"/)?.[1];

check(Boolean(csrfCookie), "csrf cookie yazıldı");
check(Boolean(csrfToken), "csrf token forma basıldı");

const kotuGiris = await fetch(`${BASE}/giris`, {
  method: "POST",
  redirect: "manual",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ kullanici: "ayse", parola: "panel123" }),
});
check(kotuGiris.status === 403, "token'sız giriş reddedilir", String(kotuGiris.status));

const capraz = await fetch(`${BASE}/giris`, {
  method: "POST",
  redirect: "manual",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: csrfCookie ?? "",
    Origin: "https://kotu.example",
  },
  body: new URLSearchParams({ kullanici: "ayse", parola: "panel123", _csrf: csrfToken ?? "" }),
});
check(capraz.status === 403, "çapraz origin POST reddedilir", String(capraz.status));

const giris = await fetch(`${BASE}/giris`, {
  method: "POST",
  redirect: "manual",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: csrfCookie ?? "",
  },
  body: new URLSearchParams({ kullanici: "ayse", parola: "panel123", _csrf: csrfToken ?? "" }),
});

check(
  giris.status === 303 && giris.headers.get("location") === "/panel",
  "geçerli giriş panele yönlendirir",
  `${giris.status} → ${giris.headers.get("location")}`,
);

const sessionCookie = readCookie(giris, "dash_session");
check(Boolean(sessionCookie), "oturum cookie'si yazıldı");

const cookieHeader = [csrfCookie, sessionCookie].filter(Boolean).join("; ");

// ---------------------------------------------------------------------------
// Oturumlu panel
// ---------------------------------------------------------------------------

const panel = await fetch(`${BASE}/panel`, { headers: { Cookie: cookieHeader } });
const panelHtml = await panel.text();

check(panel.status === 200, "/panel oturumla açılır", String(panel.status));
check(/Ayşe Yılmaz/.test(panelHtml), "kullanıcının adı sayfada");
check(
  panel.headers.get("cache-control") === "private, no-store",
  "panel private, no-store",
  String(panel.headers.get("cache-control")),
);
check(panel.headers.get("vary")?.includes("Cookie") === true, "Vary: Cookie yazılı");
check(panel.headers.get("etag") === null, "kişiye özel yanıtta ETag yok");
check(
  panel.headers.get("x-jskelet-cache") === null,
  "panel HTML önbelleğine hiç uğramaz",
  String(panel.headers.get("x-jskelet-cache")),
);

// İkinci istek de MISS/HIT işareti taşımamalı: `private` bir route için
// önbellek yolu tamamen kapalı.
const panelTekrar = await fetch(`${BASE}/panel`, { headers: { Cookie: cookieHeader } });
check(
  panelTekrar.headers.get("x-jskelet-cache") === null,
  "ikinci istekte de önbellek işareti yok",
);

// Kurcalanmış oturum: imza uymayınca kullanıcı yok sayılır.
const kurcalanmis = await fetch(`${BASE}/panel`, {
  redirect: "manual",
  headers: { Cookie: "dash_session=bWVydA.gecersizimza" },
});
check(kurcalanmis.status === 307, "kurcalanmış oturum reddedilir", String(kurcalanmis.status));

// ---------------------------------------------------------------------------
// Fragment ve mutasyon
// ---------------------------------------------------------------------------

const fragment = await fetch(`${BASE}/_fragment/siparisler?sayfa=2`, {
  headers: { Cookie: cookieHeader },
});
const fragmentHtml = await fragment.text();

check(fragment.status === 200, "fragment oturumla gelir");
check(/<table/.test(fragmentHtml), "fragment tabloyu içerir");
check(!/<html/.test(fragmentHtml), "fragment layout basmaz");
check(/sayfa 2\//.test(fragmentHtml), "istenen sayfa döner");

const panelToken = panelHtml.match(/name="_csrf" value="([^"]+)"/)?.[1];

const notsuz = await fetch(`${BASE}/panel/notlar`, {
  method: "POST",
  redirect: "manual",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader },
  body: new URLSearchParams({ metin: "Token olmadan gönderildi" }),
});
check(notsuz.status === 403, "token'sız mutasyon reddedilir", String(notsuz.status));

const kisaNot = await fetch(`${BASE}/panel/notlar`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: cookieHeader,
    "X-Requested-With": "fragment",
  },
  body: new URLSearchParams({ metin: "ab", _csrf: panelToken ?? "" }),
});
const kisaNotHtml = await kisaNot.text();
check(kisaNot.status === 422, "kısa not doğrulamada takılır", String(kisaNot.status));
check(/data-field-error/.test(kisaNotHtml), "hata formla birlikte döner");

const not = await fetch(`${BASE}/panel/notlar`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: cookieHeader,
    "X-Requested-With": "fragment",
  },
  body: new URLSearchParams({ metin: "Duman testinden gelen not", _csrf: panelToken ?? "" }),
});
const notHtml = await not.text();
check(not.status === 200, "geçerli not kaydedilir", String(not.status));
check(/Duman testinden gelen not/.test(notHtml), "yanıt güncellenmiş listeyi taşır");

// JS'siz yol: `X-Requested-With` yok, yanıt 303 olmalı.
const notYonlendirme = await fetch(`${BASE}/panel/notlar`, {
  method: "POST",
  redirect: "manual",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader },
  body: new URLSearchParams({ metin: "JS kapalıyken eklendi", _csrf: panelToken ?? "" }),
});
check(
  notYonlendirme.status === 303 && notYonlendirme.headers.get("location") === "/panel",
  "JS'siz gönderim 303 ile panele döner",
  `${notYonlendirme.status} → ${notYonlendirme.headers.get("location")}`,
);

// ---------------------------------------------------------------------------
// Public sayfa hâlâ önbellekte
// ---------------------------------------------------------------------------

await fetch(`${BASE}/`);
const anaSayfa = await fetch(`${BASE}/`);
check(
  anaSayfa.headers.get("x-jskelet-cache") === "HIT",
  "public sayfa önbellekten döner",
  String(anaSayfa.headers.get("x-jskelet-cache")),
);
check(
  (anaSayfa.headers.get("cache-control") ?? "").startsWith("public"),
  "public sayfa public direktif taşır",
  String(anaSayfa.headers.get("cache-control")),
);

// ---------------------------------------------------------------------------
// Çıkış
// ---------------------------------------------------------------------------

const cikis = await fetch(`${BASE}/cikis`, {
  method: "POST",
  redirect: "manual",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader },
  body: new URLSearchParams({ _csrf: panelToken ?? "" }),
});
check(cikis.status === 303, "çıkış 303 döner", String(cikis.status));
check(
  (cikis.headers.get("set-cookie") ?? "").includes("dash_session="),
  "oturum cookie'si temizlenir",
);

console.log(failed ? `\n${failed} test başarısız` : "\nhepsi geçti");

/**
 * @param {Response} response
 * @param {string} name
 * @returns {string | null}
 */
function readCookie(response, name) {
  const all = response.headers.getSetCookie?.() ?? [];
  const match = all.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? match.split(";")[0] : null;
}

// `process.exit()` değil: açık fetch handle'ları varken zorla çıkmak
// Windows'ta libuv assertion'ına düşüyor.
process.exitCode = failed ? 1 : 0;
