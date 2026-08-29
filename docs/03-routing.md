# 03 — Routing

Bu belge bir isteğin hangi controller'a düştüğünü belirleyen her mekanizmayı
anlatır: route modüllerinin sözleşmesi ve yükleme sırası, `route()` sarmalayıcısı,
controller'ın döndürdüğü sayfa tanımı, `ctx` nesnesi, `params`, `notFound()` ve
`redirect()` kontrol akışı, ve `jskelet.config.mjs` üzerinden gelen
redirect/rewrite kuralları. Sayfa tanımının şablon tarafı
[04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md)'de, `revalidate`
davranışı [06-cache.md](./06-cache.md)'de anlatılıyor.

## Route modülü sözleşmesi

Bir route modülü, **default export** ya da `register` adlı **named export**
olarak `(app, api) => void | Promise<void>` imzalı bir fonksiyon açar.

```js
// routes/10-pages.mjs
export default function register(app, { route }) {
  app.get("/", route(async () => ({ view: "pages/home" })));
}
```

`app` doğrudan Express uygulamasıdır: `app.get`, `app.post`, `app.use`,
`app.all` — Express 5'in tüm yüzeyi kullanılabilir. `api` ise framework'ün route
dosyalarına geçirdiği hazır yüzeydir, böylece her dosyada tek tek import yapmak
gerekmez:

| Alan | Karşılığı |
| --- | --- |
| `route` | `jskelet` → `route` |
| `renderView` | `jskelet` → `renderView` |
| `renderPage` | `jskelet` → `renderPage` |
| `notFound` | `jskelet` → `notFound` |
| `redirect` | `jskelet` → `redirect` |
| `permanentRedirect` | `jskelet` → `permanentRedirect` |

İstersen doğrudan import da edebilirsin; `api` yalnızca kolaylık:

```js
import { route, notFound } from "jskelet";

export function register(app) {
  app.get("/haber/:slug", route(async ({ params }) => { /* … */ }));
}
```

Modül geçerli bir fonksiyon açmazsa uyarı basılır ve atlanır:
`[router] <dosya> default ya da 'register' fonksiyonu dışa açmıyor, atlandı`.

## Yükleme sırası

Dosya sistemine dayalı otomatik URL türetme **yok**. Sıra iki şekilde
belirlenir:

**1. Açık liste (`jskelet.config.mjs` → `routes`).** Proje köküne göre göreli
yollar, verdiğin sırada yüklenir:

```js
export default {
  routes: ["./routes/api.js", "./routes/pages.js", "./routes/catch-all.js"],
};
```

**2. Liste yoksa `routes/` dizini alfabetik taranır.** Tarama özyinelemelidir
(alt dizinler de dâhil), yalnızca `.js` ve `.mjs` dosyaları alınır ve adı `_`
ile başlayan dosyalar atlanır (`_helpers.js` gibi paylaşılan modüller için).

Bu durumda dosya adlarına sayısal önek verin:

```
routes/
├── 10-pages.mjs
├── 50-blog.mjs
└── 99-catch-all.mjs
```

Sıranın açık olması bir tasarım kararı: `/:slug` gibi tek segmentli bir
yakalayıcı `/hakkinda` rotasından önce kaydedilirse "hakkinda" bir slug sanılır.
Sırayı dosya adına gizlemek yerine görünür kılmak teşhisi kolaylaştırıyor
([02-mimari.md](./02-mimari.md)).

Hiç route modülü bulunamazsa uyarı basılır ve sunucu yalnızca statik dosyalar +
404 ile ayağa kalkar.

### Bozuk modül davranışı

- **Development:** modül import edilemezse uyarı basılır ve atlanır; sunucu
  ayakta kalır.
- **Production:** hata fırlatılır ve süreç açılmaz. Yarım route tablosuyla
  yayına çıkmak, sessizce 404 dönen sayfalar demek.

## `route()` — controller sarmalayıcısı

`route(controller, options?)` bir Express request handler döndürür ve şu işleri
üstlenir:

- `ctx` nesnesini kurar ve controller'ı çağırır.
- HTML TTL cache'ini uygular (`revalidate` varsa ve metot `GET` ise).
- `notFound()` / `redirect()` kontrol akışını yakalar.
- Yanıt başlıklarını yazar: `Content-Type`, cache'lenebilir yanıtlarda
  `Cache-Control`, ve her zaman `X-JSkelet-Cache`.
- Önbellekte saklanan sıkıştırılmış gövdeyi kullanarak yanıtı gönderir.

```js
app.get(
  "/hakkinda",
  route(
    async () => ({
      view: "pages/about",
      metadata: { title: "Hakkında", canonical: "/hakkinda" },
    }),
    { revalidate: 300 },
  ),
);
```

`options` tek bir alan kabul eder:

| Alan | Tip | Anlamı |
| --- | --- | --- |
| `revalidate` | `number` (saniye) | HTML önbellek TTL'i. Verilmezse ya da 0 ise bu route önbelleklenmez. `jskelet.config.mjs` → `cache().html` içindeki eşleşen bir kural bu değeri **ezer**. |

## `ctx` — controller bağlamı

Controller tek argüman alır:

```js
{
  params,    // Express route parametreleri (req.params)
  query,     // Ayrıştırılmış query string (req.query)
  pathname,  // req.path — query'siz yol
  req,       // Express Request; ihtiyaç olursa tam erişim
}
```

`params` Express'in kendi desen sözdizimini kullanır (Express 5 /
`path-to-regexp`), config'teki `source` sözdizimini değil:

```js
app.get("/haber/:slug", route(async ({ params }) => {
  const article = await getArticle(params.slug);
  if (!article) notFound();
  return { view: "pages/article", data: { article } };
}));
```

`pathname` hem cache anahtarında hem de `renderPage`'e geçen `pathname`
local'inde kullanılır; layout'un "bu ana sayfa mı" gibi kararları buna bakar.

## Controller'ın döndürdüğü sayfa tanımı

Controller `async (ctx) => sayfa` biçimindedir ve şu alanları döndürebilir:

| Alan | Tip | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `view` | `string` | — | `views/` altındaki şablon yolu, uzantısız: `"pages/home"` → `views/pages/home.ejs`. |
| `data` | `object` | `{}` | Şablona local olarak geçen veriler. |
| `metadata` | `object` | `{}` | `<head>` etiketlerine çevrilir; `hooks.metadata()` çıktısının üzerine biner. Şema: [04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md). |
| `status` | `number` | `200` | HTTP durum kodu. Yalnızca 200 önbelleğe yazılır. |
| `head` | `string` | `""` | `<head>`e olduğu gibi basılacak ham HTML (ör. LCP preload'ı). |
| `bodyClass` | `string` | `hooks.layoutContext().bodyClass ?? ""` | `<body class="…">`. |
| `entries` | `string[]` | `[]` | Bu sayfada ek olarak yüklenecek client entry adları: `["chart.js"]`. |

`revalidate` **`route()`'un ikinci argümanıdır**, controller'ın döndürdüğü
nesnenin alanı değil.

Örnek, hepsi bir arada:

```js
import { headHints } from "jskelet";

app.get(
  "/piyasalar",
  route(
    async ({ query }) => {
      const data = await getMarkets(query.tab ?? "hisse");

      return {
        view: "pages/markets",
        data: { markets: data.items, tab: query.tab ?? "hisse" },
        metadata: {
          title: "Piyasalar",
          canonical: "/piyasalar",
          openGraph: { image: data.cover },
        },
        head: headHints({ href: data.cover }),
        bodyClass: "bg-slate-50",
        entries: ["chart.js"],
      };
    },
    { revalidate: 30 },
  ),
);
```

## `notFound()` ve `redirect()`

`next/navigation` içindeki kontrol akışının karşılığı: derinlerdeki bir
fonksiyon `throw` eder, framework yakalar. Böylece veri katmanındaki bir
fonksiyon, controller'a dönüş değeri taşımak zorunda kalmadan 404 üretebilir.

```js
import { notFound, redirect, permanentRedirect } from "jskelet";

notFound();                    // 404 → hooks.notFound() sayfası
redirect("/yeni-adres");       // 307 (geçici)
permanentRedirect("/yeni");    // 308 (kalıcı)
```

Üçü de `never` döner (her zaman fırlatır). Ayrıntı:

- `notFound()` → `NotFoundError` (`statusCode: 404`)
- `redirect(location)` → `RedirectError` (`statusCode: 307`)
- `permanentRedirect(location)` → `RedirectError` (`statusCode: 308`)

Özel bir durum kodu gerekiyorsa sınıfı doğrudan kullanabilirsin:

```js
import { RedirectError } from "jskelet";

throw new RedirectError("/eski-kurulum-uyumu", 301);
```

Ayırt etmek için `isNotFoundError(error)` ve `isRedirectError(error)` dışa açık.

Yakalanma noktaları:

1. **`route()` içinde:** redirect doğrudan yanıta yazılır; notFound `produce()`
   içinde yakalanır ve 404 sayfası üretilir (bu çıktı önbelleğe **yazılmaz**,
   çünkü yalnızca 200 saklanır).
2. **Express hata yöneticisinde:** bir middleware ya da route dışı kodda
   fırlatılmışsa burada karşılanır.

## 404 sayfası

Bir istek hiçbir route'a düşmezse framework `hooks.notFound()` hook'unu çağırır
ve dönen sayfa tanımını `pathname: "/404"` ile render eder.

```js
// jskelet.config.mjs
export default {
  hooks: {
    notFound() {
      return {
        view: "pages/not-found",
        metadata: { title: "Sayfa bulunamadı", robots: { index: false } },
      };
    },
  },
};
```

Hook tanımlı değilse ya da 404 render'ı da hata verirse framework şablonsuz,
minimal bir HTML döner. Bu geri dönüş bilinçli olarak şablonsuz: 404 render'ı da
patlarsa ziyaretçi boş yanıt görmesin.

## Layout'suz render: `renderView`

`renderView(view, data)` tek bir şablonu layout olmadan render eder ve string
döner. Fragment uçları, e-posta şablonları ve island'ların sonradan çektiği
HTML parçaları için:

```js
export default function register(app, { renderView }) {
  app.get("/_fragment/yorumlar/:id", async (req, res) => {
    const comments = await getComments(req.params.id);
    res.type("html").send(await renderView("fragments/comments", { comments }));
  });
}
```

`/_fragment/` öneki varsayılan `prewarmSkip` listesinde yer alır, yani ısıtma
turu bu uçları taramaz ([06-cache.md](./06-cache.md)).

## Config: `redirects()`

`jskelet.config.mjs` → `redirects()` bir dizi döndürür ve middleware zincirinde
route'lardan **önce** çalışır (bkz. [02-mimari.md](./02-mimari.md)).

```js
export default {
  async redirects() {
    return [
      { source: "/eski-blog/:slug", destination: "/blog/:slug", permanent: true },
      { source: "/kampanya", destination: "/kampanyalar" },
      { source: "/legacy", destination: "/", statusCode: 301 },
    ];
  },
};
```

Davranış:

- **İlk eşleşen kural kazanır**, sonrası denenmez. Sıralama config'teki yazım
  sırasıdır.
- **Query string korunur:** `/eski-blog/x?utm=a` → `/blog/x?utm=a`. Yönlendirme
  kampanya parametrelerini düşürürse trafik kaynağı kaybolur.
- **Durum kodu:** `permanent: true` → 308, aksi hâlde 307 (Next semantiği).
  Farklı bir kod isteyen `statusCode` verebilir; örneğin eski kurulumlarla uyum
  için 301.
- `source` ya da `destination` geçersizse kural sessizce düşmez, uyarı basılır.

## Config: `rewrites()`

Rewrite, tarayıcının adres çubuğunu değiştirmeden isteği başka bir yere taşır.
İki faz vardır:

```js
export default {
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/sitemap-:page.xml", destination: "/sitemap?page=:page" },
      ],
      afterFiles: [
        { source: "/api/:path*", destination: "https://api.example.com/:path*" },
      ],
    };
  },
};
```

Bir dizi döndürürsen tamamı `afterFiles` sayılır:

```js
async rewrites() {
  return [{ source: "/api/:path*", destination: "https://api.example.com/:path*" }];
}
```

- **`beforeFiles`** statik dosyalardan da önce çalışır. `/assets/…` gibi yolları
  yeniden yazmak gerekiyorsa buraya konmalı.
- **`afterFiles`** statik denendikten sonra, route'lardan önce çalışır.

Hedefin biçimi davranışı belirler:

- **Mutlak (`http://` / `https://`):** istek gömülü ters proxy ile dışa taşınır.
  Harici paket yok; `fetch` ile stream eden ince bir katman. Hop-by-hop
  başlıklar (`host`, `connection`, `content-length`, `accept-encoding`)
  temizlenir; yanıtta `content-encoding`, `content-length`,
  `transfer-encoding`, `connection` düşürülür. `redirect: "manual"` sayesinde
  upstream'in 302'si burada tüketilmez, tarayıcıya iletilir.
- **Göreli:** yalnızca `req.url` değiştirilir ve istek kendi route tablosunda
  devam eder. Bu fazda ilk eşleşen kural döngüyü kırar.

Tipik kullanım `/api/*` yolunu backend'e taşımaktır. Tarayıcı bunu same-origin
çağırdığı için CORS ve third-party cookie sorunları oluşmaz.

### Elle proxy: `createProxy`

Aynı proxy'yi kendi route'unda da kullanabilirsin:

```js
import { createProxy } from "jskelet";

export default function register(app) {
  app.use("/ws-api", createProxy((req) => `${process.env.API_ORIGIN}${req.url}`));
}
```

`resolveTarget` fırlatırsa ya da boş döndürürse istek proxy'lenmez ve zincire
devam eder: hedef origin yapılandırılmamış bir kurulumda 500 yerine normal bir
404 almak daha doğru.

## `source` desen sözdizimi

`redirects()`, `rewrites()`, `headers()` ve `cache().html` aynı küçük desen
derleyicisini kullanır. Bu, Next'in tam `path-to-regexp` yüzeyi değil; config'te
fiilen kullanılan alt küme bilinçli olarak seçildi.

| Desen | Anlamı |
| --- | --- |
| `/haber/:slug` | Tek segment yakalar (`[^/]+`) |
| `/:path*` | Sıfır veya daha fazla segment yakalar; öndeki `/` opsiyoneldir, yani `/blog/:path*` `/blog`u da kapsar |
| `/:path*.svg` | Joker + sabit son ek; uzantı kuralları böyle yazılır |
| `/etiket-:slug` | Segment ortasında parametre |

Yakalanan değerler `destination` içindeki aynı adlı `:param`'lara yazılır.
Parametre adı `[A-Za-z_][A-Za-z0-9_]*` kalıbına uymalıdır.

`source` mutlaka `/` ile başlamalı; başlamazsa kural yok sayılır ve uyarı
basılır (`[config] geçersiz source (\`/\` ile başlamalı): …`). Tanınmayan bir
sözdizimi sessizce literal kabul edilmez.

Tam desen listesi ve config referansı: [07-yapilandirma.md](./07-yapilandirma.md).

## Sırada ne var

- Şablon katmanı, bileşenler ve metadata:
  [04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md)
- `revalidate`, cache anahtarı ve `X-JSkelet-Cache`: [06-cache.md](./06-cache.md)
- Config alanlarının tam referansı: [07-yapilandirma.md](./07-yapilandirma.md)
