# 12 — Panel, oturum ve kişiye özel sayfalar

JSkelet'in ağırlık merkezi public, önbelleklenebilir sayfalar. Bir panel ise
tam ters eksende durur: her ziyaretçiye farklı HTML, önbellek yok, yoğun
etkileşim. Bu belge o ekseni anlatır — `private: true`, oturum cookie'leri,
CSRF, fragment uçları ve parça takası.

Kapsam dışında bırakılan bir şey var ve bilinçli: **canlı veri taşıması**.
SSE, WebSocket ya da aralıklı sorgu arasındaki seçim uygulamanın; framework
yalnızca "şu parçayı sunucudan tazele" adımını veriyor. Sıkıştırma katmanı
`text/event-stream` yanıtlarını ve başlıklarını kendisi yazan akışları
atladığı için SSE'yi elle kurmak da bir şeyi bozmuyor.

Çalışan karşılığı `examples/dashboard/`; bu belgedeki kod parçalarının kaynağı
orası.

## Neden ayrı bir yol gerekiyor

HTML önbelleğinin anahtarı yalnızca yol ve query:

```
`${req.path}?${new URLSearchParams(query).toString()}`
```

Kimlik anahtarın parçası değil. Yani oturuma bağlı bir sayfa normal `route()`
ile kaydedilirse, ilk isteyenin HTML'i o TTL boyunca **herkese** servis edilir.
Bu hata hiçbir yerde patlamaz: sayfa çalışır, testler geçer, sorun yalnızca
ikinci kullanıcı geldiğinde ve genelde üretimde görünür.

## `private: true`

```js
export default function register(app, { route, redirect }) {
  app.get(
    "/panel",
    route(
      async ({ req }) => {
        const user = currentUser(req);
        if (!user) redirect("/giris?next=%2Fpanel");

        return { view: "pages/overview", data: { user } };
      },
      { private: true },
    ),
  );
}
```

Bayrağın yaptığı işler:

| Davranış | Public `route()` | `private: true` |
| --- | --- | --- |
| HTML önbelleği | TTL varsa açık | Kapalı, açılamaz |
| `cache.html` deseni | TTL'i ezer | Yok sayılır |
| `Cache-Control` | `public, s-maxage=…` | `private, no-store` |
| `Vary` | `Accept-Encoding` | `Cookie, Accept-Encoding` |
| ETag | Var | Yok |
| `X-JSkelet-Cache` | `HIT`/`STALE`/`MISS` | Yazılmaz |

ETag'in düşmesi ayrıntı gibi görünüyor ama değil: kullanıcıya özel bir gövdenin
güçlü ETag'i, o kullanıcıya özgü bir parmak izidir ve `no-store`'a uymayan bir
katmanda kimlik ayrımı için kullanılabilir.

Kişiye özel bir sayfadan atılan yönlendirme de önbelleklenmez. "Giriş yapmalısın"
kararı oturuma bağlı; saklanması, giriş yapmış kullanıcının da login sayfasına
atılması demek.

## Bayrağı unutursanız

Framework kimliğe dokunan erişimleri izliyor. Controller'a giden `req`, şu
okumaları işaretleyen ince bir Proxy ile sarılı:

- `req.headers.cookie`, `req.headers.authorization`,
  `req.headers["proxy-authorization"]`
- `req.get("Cookie")` / `req.header("Authorization")`
- `req.cookies`, `req.signedCookies`, `req.session`, `req.user`
- `parseCookies(req)` ve `getSignedCookie(req, …)` (doğrudan bildiriyorlar)

İşaretlenen bir render önbelleğe **yazılmaz**. Üretimde yanıt `no-store` ile
gider ve şu satır loglanır:

```
[render] /panel kimliğe bağlı veri okudu (req.headers.cookie), önbelleğe
alınmadı. Route 'private: true' ile kaydedilmeli.
```

Development'ta aynı durum isteği bir hatayla düşürür. Sessiz kalmamasının
sebebi basit: bu hata çalışan bir sayfa üretiyor, yani kendi başına asla fark
edilmiyor.

`csrfField()` de aynı işaretlemeyi yapıyor. Token basan bir sayfa önbellekten
dönemez — dönerse tüm ziyaretçiler aynı token'ı paylaşır ve çift gönderim
kontrolü hiçbir şey doğrulamaz.

## Oturum: imzalı cookie

Framework kimlik sağlamıyor. Verdiği tek şey "bu değeri ben yazdım,
kurcalanmamış" garantisi:

```js
import { clearCookie, getSignedCookie, setSignedCookie } from "jskelet/cookies";

export function startSession(res, username) {
  setSignedCookie(res, "dash_session", username, { maxAge: 60 * 60 * 8 });
}

export function currentUser(req) {
  const username = getSignedCookie(req, "dash_session");
  return username ? findUser(username) : null;
}

export function endSession(res) {
  clearCookie(res, "dash_session");
}
```

İmza HMAC-SHA256, karşılaştırma sabit zamanlı. İmza uymuyorsa `getSignedCookie`
`null` döner — kurcalanmış bir değer "belki geçerlidir" diye kullanılmaz.

Sır `security.cookieSecret` ya da `JSKELET_SECRET` ortam değişkeninden gelir.
Sır yoksa imzalı API **hata verir**; "yapılandırma hatası siteyi düşürmez"
kuralı burada geçerli değil, çünkü sessiz alternatif imzasız bir cookie'ye
güvenmek olurdu.

Varsayılanlar kısıtlayıcı tarafta: `HttpOnly`, `SameSite=Lax`, development
dışında `Secure`, `Path=/`. `SameSite=Lax` tek başına CSRF'in büyük kısmını
kapatıyor — cookie çapraz site POST'larında hiç gönderilmiyor.

Cookie **şifrelenmiyor**, imzalanıyor. Değer okunabilir; gizli kalması gereken
veriyi değil, onun kimliğini koyun.

## CSRF

Gövdeyi framework ayrıştırıyor (`express.urlencoded` + `express.json`), yani
state değiştiren istekleri kabul eden katman o. Koruma iki katmanlı.

### Katman 1 — origin kontrolü (varsayılan açık)

`Origin` kendi host'umuzla uyuşmuyorsa ya da `Sec-Fetch-Site: cross-site`
geldiyse güvenli olmayan metotlar 403 alır. **Başlıkların hiçbiri yoksa istek
geçer**: tarayıcılar çapraz origin bir POST'ta `Origin`'i her zaman gönderir,
webhook'lar ve sunucudan sunucuya çağrılar hiç göndermez. Bu ayrım korumayı
açık bırakırken entegrasyonları bozmuyor.

```js
security: {
  csrf: {
    // Ayrı bir alan adından gelen panel gibi meşru istisnalar.
    allowedOrigins: ["https://admin.example.com"],
    // Tarayıcıdan gelmeyen uçlar.
    exclude: ["/webhook/:path*"],
  },
}
```

### Katman 2 — çift gönderim token'ı (opsiyonel)

`security.csrf.token: true` ile açılır. Formlar token'ı `csrfField()` ile basar:

```ejs
<form method="post" action="/panel/notlar">
  <%- csrfField() %>
  …
</form>
```

Token'ı **middleware üretmiyor**, `csrfField()` üretiyor — yani gerçekten bir
forma basıldığı anda. Sebebi somut: token her yanıtta yazılsaydı public ve
önbelleklenebilir bir sayfa da `Set-Cookie` taşırdı, bir CDN o yanıtı saklardı
ve tüm ziyaretçiler aynı token'ı paylaşırdı.

Sunucu tarafında token, imzalı cookie ile gönderilen alanın eşleşmesini
istiyor; alan yerine `X-CSRF-Token` başlığı da kabul ediliyor.

`csrfField()` `security.csrf.token` kapalıyken boş string döner, yani şablon
her koşulda render edilebilir.

## Fragment uçları

`fragment()` politikası sabit bir parça yanıtı üretir: layout basılmaz, yanıt
`private, no-store` ve ETag'siz gider, HTML önbelleğine hiç uğramaz.

```js
export default function register(app, { fragment }) {
  app.get(
    "/_fragment/siparisler",
    fragment(async ({ req, query }) => {
      const user = currentUser(req);
      if (!user) return { view: "partials/session-expired", status: 401 };

      return {
        view: "partials/order-table",
        data: { siparisler: getOrders(user.username, Number(query.sayfa ?? 1)) },
      };
    }),
  );
}
```

Controller ya `{ view, data?, status? }` ya doğrudan bir HTML string döner.
Hata durumunda tüm sayfa yerine küçük bir parça döner
(`<div role="alert" data-fragment-error>`): takas edilen bölge bir hata
sayfasının tamamını içine almamalı.

Aynı şablonun sayfanın içinde de fragment ucunda da kullanılması esas fikir —
işaretlemenin tek kaynağı sunucuda kalır, istemci ikinci bir şablon taşımaz.

## İstemci: parça takası

```js
import { registerAll, start, startForms, startSwapLinks } from "jskelet/client";

registerAll({ "live-clock": () => import("../islands/live-clock.js") });

start();
startSwapLinks();
startForms();
```

`startSwapLinks()` `data-swap` taşıyan bağlantıları bağlar:

```html
<a href="/_fragment/siparisler?sayfa=2" data-swap="#siparisler">Sonraki</a>
```

`href` gerçek bir URL olduğu için JS yoksa bağlantı normal gezinmeye düşer.
Programatik kullanım için `swap()`:

```js
import { swap } from "jskelet/client";

await swap("#siparisler", "/_fragment/siparisler?sayfa=2", { history: true });
```

`swap()` sırayla: eski alt ağacın island'larını söker, içeriği değiştirir, yeni
alt ağacı hidre eder ve odağı kaybolmuşsa geri getirir. İstek süresince bölgeye
`aria-busy="true"` yazılır — bekleme göstergesini ayrı bir sınıfa bağlamak
yerine erişilebilirlik durumuna bağlamak ikisinin birbirinden ayrı düşmesini de
engelliyor.

Yönlendirmeyle karşılaşırsa (oturum düştü, login'e gidiliyor) parçayı takmak
yerine sayfayı o adrese götürür.

### Island sökme

Bu, takasın en kolay atlanan yarısı. `mount()` bir temizlik fonksiyonu
döndürebiliyor:

```js
export function mount(element) {
  const timer = setInterval(() => tick(element), 1000);
  return () => clearInterval(timer);
}
```

`innerHTML` ile değiştirilen bir bölgenin island'ları DOM'dan çıkar ama
`document`/`window` üzerine kurdukları dinleyiciler ve `setInterval`'ları
yaşamaya devam eder; birkaç takastan sonra aynı iş onlarca kez çalışır.
`swap()` ve form yardımcıları `unmount()` çağırıyor, elle DOM değiştiriyorsanız
sizin çağırmanız gerekiyor:

```js
import { hydrate, unmount } from "jskelet/client";

unmount(bolge);
bolge.innerHTML = html;
hydrate(bolge);
```

## Formlar

`startForms()` `data-enhance` taşıyan formları bağlar. Sözleşme progressive
enhancement: form normal bir `<form method="post" action="…">`, JS yalnızca
aradaki tam sayfa turunu kaldırıyor.

```html
<form method="post" action="/panel/notlar" data-enhance data-target="#notlar">
  <%- csrfField() %>
  <textarea name="metin" required minlength="3"></textarea>
  <button type="submit">Kaydet</button>
</form>
```

Sunucu üç cevaptan birini verir:

- **yönlendirme** → `location.assign` ile izlenir (başarılı mutasyon, JS'siz yol)
- **4xx + parça** → formun yerine takılır (doğrulama hataları)
- **2xx + parça** → `data-target` bölgesine takılır ve form sıfırlanır

Sunucu tarafı ikisini de karşılıyor:

```js
app.post(
  "/panel/notlar",
  fragment(async ({ req }) => {
    const user = currentUser(req);
    if (!user) seeOther("/giris?next=%2Fpanel");

    const result = addNote(user.username, req.body?.metin);

    // JS kapalıysa istemci `X-Requested-With` göndermez: tam sayfa turu.
    if (req.get("X-Requested-With") !== "fragment") {
      seeOther(result.ok ? "/panel" : "/panel?not=hata");
    }

    return result.ok
      ? { view: "partials/note-list", data: { notlar: getNotes(user.username) } }
      : { view: "partials/note-form", data: { hata: result.error }, status: 422 };
  }),
);
```

`seeOther()` yerine `redirect()` kullanmak burada bir hata olurdu: `redirect()`
307 yazıyor ve 307 metodu koruyor, yani tarayıcı hedefe yeniden POST ediyor.
Form sonrası akış 303 gerektiriyor.

POST handler'ının `fragment()` içinden geçmesinin sebebi de var: layout'suz
render ve `no-store`'un yanında **istek bağlamı** kazandırıyor. Bağlam olmadan
hata durumunda yeniden basılan formun `csrfField()`i boş çıkar ve kullanıcının
ikinci denemesi 403 alır.

Doğrulama hatasında odak ilk hatalı alana taşınıyor; işaret olarak
`aria-invalid="true"` ya da `data-field-error` aranıyor.

## Yapılandırma

```js
export default {
  security: {
    /**
     * Ters proxy arkasında değilsen kapat: açıkken istemci kendi
     * `X-Forwarded-For` başlığını uydurabilir.
     */
    trustProxy: true,

    cookieSecret: process.env.JSKELET_SECRET,

    csrf: {
      enabled: true,
      token: false,
      allowedOrigins: [],
      exclude: [],
      cookieName: "csrf_token",
      fieldName: "_csrf",
      headerName: "x-csrf-token",
    },
  },
};
```

Panel yolları için iki ek ayar işe yarıyor:

```js
// Yan etkili bir bağlantının önden getirilmesi kullanıcıyı oturumdan atabilir.
navigation: { exclude: ["/panel/:path*", "/cikis"] },

// Isıtıcının oturumu yok; korumalı sayfalar ısıtılamaz.
prewarmSkip: ["/api/", "/_fragment/", "/panel", "/cikis"],
```

Ve `headers()` ile indeksleme kapatılır — `no-store` önbelleği engelliyor, ama
indekslemeyi ayrıca söylemek gerekiyor:

```js
{
  source: "/panel/:path*",
  headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
}
```

## Kontrol listesi

Kişiye özel bir bölüm eklerken:

- [ ] Sayfalar `route(fn, { private: true })` ile kayıtlı.
- [ ] Fragment uçları `fragment()` ile kayıtlı.
- [ ] `security.cookieSecret` ortam değişkeninden geliyor, kodda sabit değil.
- [ ] Mutasyon formlarında `csrfField()` var; `security.csrf.token` açık.
- [ ] Çıkış bir POST; GET değil.
- [ ] Girişten sonraki `next` parametresi yalnızca site içi yolları kabul ediyor.
- [ ] `prewarmSkip` ve `navigation.exclude` korumalı öneki dışlıyor.
- [ ] `headers()` altında `X-Robots-Tag: noindex`.
- [ ] Duman testi `no-store` başlığını ve token'sız POST'un reddini kontrol
      ediyor — bunlar bozulduğunda ekranda hiçbir şey değişmiyor.
