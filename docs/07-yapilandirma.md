# 07 — Yapılandırma referansı

Bu belge `jskelet.config.mjs`'in tam referansıdır: her alan, tipi, varsayılanı
ve örneği. Ardından `source` desen sözdizimi ve framework'ün okuduğu tüm ortam
değişkenleri tablosu geliyor. Alanların davranışsal ayrıntıları için ilgili
belgelere bağlantı verildi; buradaki amaç tek bakışta tam liste sunmak.

## Dosyanın konumu ve yüklenmesi

Config dosyası proje kökünde `jskelet.config.mjs` adıyla aranır ve **zorunlu
değildir**. Yoksa ya da okunamıyorsa uyarı basılır ve sunucu varsayılanlarla
ayağa kalkar; bozuk bir düzenleme siteyi açılamaz hâle getirmemeli.

```js
// jskelet.config.mjs
export default {
  // …
};
```

Default export yoksa modülün kendisi config olarak kullanılır (named export'lar).

`headers()`, `redirects()`, `rewrites()` ve `cache()` bölümleri fonksiyon **ya da
düz değer** olabilir; fonksiyon olmaları hâlinde `async` olabilirler ve `this`
config nesnesine bağlıdır. Bir bölüm hata verirse yalnızca o bölüm yok sayılır.

Config başarıyla yüklendiğinde bir özet basılır:
`[config] jskelet.config.mjs yüklendi — 3 header, 2 redirect, 1 cache kuralı`

## Tam örnek

```js
// jskelet.config.mjs
export default {
  paths: {
    views: "views",
    public: "public",
    client: "client",
    routes: "routes",
    styles: "styles/globals.css",
    generated: ".jskelet",
  },

  brand: {
    name: "Örnek",
    poweredBy: "Örnek",
    cacheHeader: "X-Ornek-Cache",
    devBasePath: "/__ornek/dev",
    prewarmUserAgent: "ornek-prewarm",
    devTokenCookie: "dev_token",
    lang: "tr",
  },

  layout: "views/layout.ejs",
  routes: ["./routes/10-pages.mjs", "./routes/99-catch-all.mjs"],

  static: {
    extensions: [".svg", ".png", ".webp", ".avif", ".ico", ".woff2"],
    prefixes: ["/assets/", "/fonts/"],
  },

  devGateBypass: ["/api/healthcheck", "/robots.txt"],
  preconnect: ["https://cdn.ornek.com"],
  prewarmSkip: ["/api/", "/_fragment/", "/__ornek/"],
  watch: ["data"],

  fonts: [{ family: "Inter", weights: [400, 600, 700] }],
  icons: { scan: ["views", "client", "routes", "lib"] },
  images: { widths: [400, 800, 1200], quality: 78, skip: ["indirmeler"] },
  clientEnv: ["PUBLIC_WS_URL"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },

  async redirects() {
    return [{ source: "/eski/:slug", destination: "/yeni/:slug", permanent: true }];
  },

  async rewrites() {
    return {
      afterFiles: [
        { source: "/api/:path*", destination: "https://api.ornek.com/:path*" },
      ],
    };
  },

  async cache() {
    return {
      html: { "/": 60, "/haber/:slug": 300 },
      prewarm: { enabled: true, max: 400, concurrency: 4, intervalSeconds: 0 },
    };
  },

  hooks: {
    metadata() { /* … */ },
    layoutContext() { /* … */ },
    notFound() { /* … */ },
    prewarmPaths() { /* … */ },
  },
};
```

## `paths`

**Tip:** `Record<string, string>` — **Varsayılan:** aşağıdaki tablo

Proje kökündeki dizin (ve `styles` için dosya) adları. Değerler proje köküne
göre çözülür ve içeride mutlak yola çevrilir.

| Anahtar | Varsayılan | İçeriği |
| --- | --- | --- |
| `views` | `"views"` | EJS layout, sayfalar, bileşenler |
| `public` | `"public"` | Statik dosyalar; build çıktısı da buraya yazılır |
| `client` | `"client"` | Island runtime kaynakları ve entry'ler |
| `routes` | `"routes"` | Route modülleri |
| `styles` | `"styles/globals.css"` | Tailwind/PostCSS giriş **dosyası** |
| `generated` | `".jskelet"` | `manifest.json`, `metafile.json`, `images.json` |

`styles` bir dosya yolu olduğu hâlde aynı çözümlemeden geçer; ayrı bir alan
tutmaya değmiyor.

İki yol her zaman türetilir ve ezilemez: `public/assets` (hash'li build
çıktısı) ve `public/fonts` (self-host fontlar).

```js
paths: { views: "src/views", routes: "src/routes", styles: "src/styles/main.css" }
```

## `brand`

**Tip:** `object` — **Varsayılan:** aşağıdaki tablo

Markalama ve tek yerden değiştirilebilir isimler. Fork eden ya da beyaz etiket
kullanan projeler kendi adını verebilir. Verilen alanlar varsayılanlarla sığ
birleştirilir.

| Alan | Tip | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `name` | `string` | `"JSkelet"` | Görüntü adı |
| `poweredBy` | `string` | `"JSkelet"` | `X-Powered-By` başlığının değeri |
| `cacheHeader` | `string` | `"X-JSkelet-Cache"` | HTML cache durumu başlığı ([06-cache.md](./06-cache.md)) |
| `devBasePath` | `string` | `"/__jskelet/dev"` | Dev overlay ve rapor uçlarının kökü |
| `prewarmUserAgent` | `string` | `"jskelet-prewarm"` | Isıtma isteklerinin UA'sı; dev paneli bunu filtreler |
| `devTokenCookie` | `string` | `"dev_token"` | Dev gate'in çerez ve query parametresi adı |
| `lang` | `string` | — | `<html lang>` varsayılanı. Verilmezse layout `"en"` kullanır. |

`lang` için öncelik sırası: `hooks.layoutContext()` → `lang` **>** `brand.lang`
**>** `"en"`.

```js
brand: { lang: "tr", poweredBy: "Örnek", cacheHeader: "X-Ornek-Cache" }
```

## `layout`

**Tip:** `string` — **Varsayılan:** yok (otomatik çözüm)

Layout `.ejs` dosyasının yolu. Verilen değer **views dizininin üst dizinine**
göre çözülür, yani varsayılan `views` ile `"views/ozel.ejs"` →
`<root>/views/ozel.ejs`.

Verilmezse sırayla: `views/layout.ejs` varsa o, yoksa framework'ün minimal
layout'u. Ayrıntı: [04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md).

## `routes`

**Tip:** `string[]` — **Varsayılan:** `null` (dizin taraması)

Route modüllerinin açık listesi, proje köküne göre. Verilen sırada yüklenir.
Verilmezse `paths.routes` dizini alfabetik ve özyinelemeli olarak taranır.
Ayrıntı: [03-routing.md](./03-routing.md).

```js
routes: ["./routes/api.js", "./routes/pages.js", "./routes/catch-all.js"]
```

## `static`

**Tip:** `{ extensions?: string[], prefixes?: string[] }` — **Varsayılan:**
aşağıda

Uzantı ve önek bazlı statik dosya tespiti. Bu listeye uyan yollara
`Cache-Control: public, max-age=31536000, immutable` yazılır.

| Alan | Varsayılan |
| --- | --- |
| `extensions` | `[".svg", ".png", ".webp", ".avif", ".ico", ".woff2"]` |
| `prefixes` | `["/assets/", "/fonts/"]` |

Verilirse varsayılanın **yerine** geçer (birleştirilmez), yani varsayılana ek
yapmak isterseniz tam listeyi yazın.

```js
static: {
  extensions: [".svg", ".png", ".webp", ".avif", ".ico", ".woff2", ".mp4"],
  prefixes: ["/assets/", "/fonts/", "/video/"],
}
```

## `devGateBypass`

**Tip:** `string[]` — **Varsayılan:**
`["/api/healthcheck", "/robots.txt", "/sitemap.xml", "/site.webmanifest", "/favicon.ico"]`

Dev gate'in hiçbir koşulda kapatmadığı **tam** yollar (önek değil, birebir
eşleşme). `DEV_TOKEN` ayarlı bir ortamda sağlık kontrolünün ve robots
dosyalarının erişilebilir kalması için. Verilirse varsayılanın yerine geçer.

Ayrıntı: [09-dev-araclari.md](./09-dev-araclari.md).

## `preconnect`

**Tip:** `string[]` — **Varsayılan:** `[]`

Üçüncü taraf origin'ler; her sayfanın `<head>`inde `<link rel="preconnect">`
olarak basılır. Görsel CDN'i, API origin'i, font host'u buraya yazılır. Değerler
`new URL(...).origin` ile normalize edilir; geçersiz bir URL atlanır ve uyarı
basılır.

Liste her sayfada aynı olduğu için bir kez hesaplanıp saklanır. Boş liste geçerli
bir yapılandırmadır.

```js
preconnect: ["https://cdn.ornek.com", "https://api.ornek.com"]
```

## `prewarmSkip`

**Tip:** `string[]` — **Varsayılan:** `["/api/", "/_fragment/", "/__jskelet/"]`

Isıtmanın atlayacağı yol **önekleri**. Oturuma bağlı ya da fragment uçları
ısıtılmamalı. Verilirse varsayılanın yerine geçer — `brand.devBasePath`i
değiştirdiyseniz bu listeyi de güncellemeyi unutmayın.

Ayrıntı: [06-cache.md](./06-cache.md).

## `watch`

**Tip:** `string[]` — **Varsayılan:** `[]`

`jskelet dev`in sunucu yeniden başlatma için izleyeceği **ek** dizinler, proje
köküne göre. `routes`, `views` ve `lib` zaten izlenir; `client/` ve `styles/`
esbuild ve CSS watcher'ları tarafından ele alınır, buraya konmamalı.

Yalnızca `.js`, `.mjs`, `.json` ve `.ejs` uzantılı dosyalar tetikleyicidir.

```js
watch: ["data", "content"]
```

Ayrıntı: [09-dev-araclari.md](./09-dev-araclari.md).

## `fonts`

**Tip:** `{ family: string, slug?: string, weights?: number[] }[]` —
**Varsayılan:** `[]`

Self-host edilecek Google Fonts aileleri. Boş bırakılırsa font adımı hiç
çalışmaz.

| Alan | Tip | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `family` | `string` | — | Google Fonts aile adı: `"Inter"`, `"Noto Sans"` |
| `slug` | `string` | `family`den türetilir (küçük harf, boşluk → `-`) | Dosya adı öneki |
| `weights` | `number[]` | `[400]` | İndirilecek ağırlıklar |

Çıktı: `public/fonts/<slug>-<weight>.woff2`, manifest anahtarı aynı dosya adı.
Dosyalar **sabit isimlidir** (hash yok) ve **commit edilmesi beklenir**.
Ayrıntı: [08-build.md](./08-build.md).

```js
fonts: [
  { family: "Inter", weights: [400, 600, 700] },
  { family: "Noto Serif", slug: "serif", weights: [400] },
]
```

## `icons`

**Tip:** `{ scan?: string[] } | false` — **Varsayılan:** `{}`

Phosphor SVG sprite üretimi.

| Değer | Sonuç |
| --- | --- |
| `{}` (varsayılan) | Sprite üretilir; taranan dizinler `["views", "client", "routes", "lib"]` |
| `{ scan: [...] }` | Taranan dizinler değiştirilir |
| `false` | Sprite adımı tamamen atlanır |

`@phosphor-icons/core` uygulamanın `node_modules`'ünde yoksa adım sessizce
atlanır. Ayrıntı: [08-build.md](./08-build.md).

```js
icons: { scan: ["views", "client", "routes", "lib", "content"] }
```

## `images`

**Tip:** `{ widths?: number[], quality?: number, skip?: string[] } | false` —
**Varsayılan:** `{}`

`public/` altındaki png/jpg görsellerin webp varyantlarını üretir.

| Alan | Tip | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `widths` | `number[]` | `[400, 640, 960, 1280, 1920]` | Üretilecek genişlikler. Kaynaktan büyük olanlar elenir; kaynağın kendi genişliği (en fazla 1920) her zaman eklenir. |
| `quality` | `number` | `78` | webp kalitesi. Değişince kodlayıcı imzası değişir ve tüm görseller yeniden kodlanır. |
| `skip` | `string[]` | `[]` | Taranmayacak **dizin adları**. `assets` ve `fonts` her zaman atlanır. |

`false` verilirse görsel adımı hiç çalışmaz. Adım `sharp` gerektirir ve watch
turunda hiç çalışmaz. Ayrıntı: [08-build.md](./08-build.md).

```js
images: { widths: [400, 800, 1200], quality: 82, skip: ["indirmeler"] }
```

## `clientEnv`

**Tip:** `string[]` — **Varsayılan:** `[]`

Client bundle'a build zamanında gömülecek ortam değişkeni anahtarları. Next'teki
`NEXT_PUBLIC_*` ile aynı sözleşme, ama hangi anahtarın herkese açık olduğu
isimden değil config'ten belli. `NODE_ENV` her zaman gömülür.

`process.env`in tamamı tek nesne olarak define edildiği için listede olmayan bir
anahtar okunduğunda çökme yerine `undefined` döner.

```js
clientEnv: ["PUBLIC_WS_URL", "PUBLIC_CDN_ORIGIN"]
```

**Buraya gizli anahtar koymayın** — değerler bundle'da düz metin olarak durur.

## `headers()`

**Tip:** `() => { source: string, headers: { key: string, value: string }[] }[]`
— **Varsayılan:** `[]`

Yol desenine göre yanıt başlıkları. Framework yalnızca statik dosyalara uzun
ömürlü cache yazar; bunun dışındaki her başlık (CSP, COOP, HSTS,
X-Frame-Options…) buradan gelir ve varsayılanların üstüne biner.

Eşleşen **tüm** kurallar uygulanır (redirect'lerin aksine ilk eşleşmede
durulmaz), sırayla; aynı başlığı iki kural yazarsa sonraki kazanır.

`key`i olmayan ya da `value`u `undefined` olan girdiler atlanır; hiç geçerli
başlığı kalmayan bir kural hiç eklenmez.

```js
async headers() {
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Content-Security-Policy",
          value: "default-src 'self'; img-src 'self' https://cdn.ornek.com data:",
        },
      ],
    },
    {
      source: "/indirme/:path*",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    },
  ];
}
```

## `redirects()`

**Tip:**
`() => { source: string, destination: string, permanent?: boolean, statusCode?: number }[]`
— **Varsayılan:** `[]`

| Alan | Tip | Anlamı |
| --- | --- | --- |
| `source` | `string` | Desen (aşağıdaki sözdizimi) |
| `destination` | `string` | Hedef; `:param` yer tutucuları doldurulur |
| `permanent` | `boolean` | `true` → 308, aksi hâlde 307 |
| `statusCode` | `number` | Açık durum kodu; `permanent`i ezer |

İlk eşleşen kural kazanır ve query string korunur. Ayrıntı:
[03-routing.md](./03-routing.md).

## `rewrites()`

**Tip:** `() => Rule[] | { beforeFiles?: Rule[], afterFiles?: Rule[] }`
burada `Rule = { source: string, destination: string }` — **Varsayılan:** `[]`

Dizi döndürülürse tamamı `afterFiles` sayılır.

- `beforeFiles` statik dosyalardan da önce çalışır.
- `afterFiles` statik denendikten sonra, route'lardan önce çalışır.
- Mutlak hedef (`http://`/`https://`) → gömülü ters proxy.
- Göreli hedef → yalnızca `req.url` değişir.

Ayrıntı: [03-routing.md](./03-routing.md).

## `cache()`

**Tip:** `() => { html?: Record<string, number>, prewarm?: object }` —
**Varsayılan:** `{ html: {}, prewarm: { enabled: true, max: 400, intervalSeconds: 0 } }`

### `cache().html`

Desen → saniye eşlemesi. Eşleşen kural, route'un kendi `revalidate` değerini
**ezer**. Negatif ya da sonlu olmayan değerler yok sayılır; `0` "önbellekleme"
anlamına gelir.

```js
html: {
  "/": 60,
  "/haber/:slug": 300,
  "/arama": 0,
}
```

### `cache().prewarm`

| Alan | Tip | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | `false` ise ısıtma yapılmaz (`PREWARM=1` ile ezilebilir) |
| `max` | `number` | `400` | En fazla kaç yol ısıtılır |
| `concurrency` | `number` | prod 4, dev 2 | Paralel işçi sayısı |
| `delayMs` | `number` | prod 500, dev 3000 | Açılıştan sonra ilk turun gecikmesi |
| `intervalSeconds` | `number` | `0` | 0'dan büyükse tur periyodik tekrarlanır |

Her biri aynı adı taşıyan ortam değişkeniyle ezilebilir; env önceliklidir.
Ayrıntı: [06-cache.md](./06-cache.md).

## `hooks`

**Tip:** `Record<string, Function>` — **Varsayılan:** `{}`

Hepsi opsiyonel, hepsi `async` olabilir. Bir hook hata verirse framework kendi
varsayılanına döner ve uyarır — sayfa düşmez.

| Hook | İmza | Döndürdüğü | Belge |
| --- | --- | --- | --- |
| `metadata` | `(page) => object` | Her sayfanın metadata varsayılanı; controller `metadata`sı üzerine biner | [04](./04-render-ve-sablonlar.md) |
| `layoutContext` | `({ pathname, metadata }) => object` | Layout local'leri; `lang`, `structuredData`, `extraHead`, `bodyClass` özel yorumlanır | [04](./04-render-ve-sablonlar.md) |
| `notFound` | `() => object \| null` | 404 sayfa tanımı; `null` ise minimal HTML | [03](./03-routing.md) |
| `prewarmPaths` | `() => string[]` | Isıtılacak yollar; tanımlı değilse ısıtma hiç kurulmaz | [06](./06-cache.md) |

```js
hooks: {
  metadata() {
    return { titleTemplate: "%s | Örnek", siteUrl: "https://ornek.com" };
  },

  async layoutContext({ pathname }) {
    return { navigation: await getNavigation(), isHome: pathname === "/" };
  },

  notFound() {
    return {
      view: "pages/not-found",
      metadata: { title: "Sayfa bulunamadı", robots: { index: false } },
    };
  },

  async prewarmPaths() {
    return ["/", ...(await getArticlePaths())];
  },
}
```

## `source` desen sözdizimi

`headers()`, `redirects()`, `rewrites()` ve `cache().html` aynı küçük derleyiciyi
kullanır. Bu, Next'in tam `path-to-regexp` yüzeyi değil; config'te fiilen
kullanılan alt küme bilinçli olarak seçildi ve tanınmayan bir sözdizimi sessizce
literal kabul edilmez, uyarı üretir.

| Desen | Regex karşılığı | Örnek eşleşme |
| --- | --- | --- |
| `/hakkinda` | tam eşleşme | `/hakkinda` |
| `/haber/:slug` | `([^/]+)` — tek segment | `/haber/abc` (✗ `/haber/a/b`) |
| `/:path*` | `(.*)` — sıfır veya daha fazla segment | `/`, `/a`, `/a/b/c` |
| `/blog/:path*` | joker alt yol; öndeki `/` opsiyonel | `/blog`, `/blog/`, `/blog/a/b` |
| `/:path*.svg` | joker + sabit son ek | `/ikon.svg`, `/a/b/c.svg` |
| `/etiket-:slug` | segment ortasında parametre | `/etiket-finans` |

Kurallar:

- `source` **`/` ile başlamak zorundadır**; başlamazsa kural yok sayılır ve
  uyarı basılır.
- Parametre adı `[A-Za-z_][A-Za-z0-9_]*` kalıbına uymalıdır.
- Desen daima **baştan sona** eşleşir (`^…$`); önek eşleşmesi için `:path*`
  kullanın.
- `:path*` sıfır segment de yakalar ve hemen öncesindeki `/` opsiyoneldir:
  `/hesabim/:path*` bölümün kök yolunu (`/hesabim`) da kapsar. Aksi hâlde bir
  bölümü tamamen kapatmak isteyen kural tam da giriş sayfasını atlıyordu.
- Parametreler dışındaki tüm karakterler literal kabul edilir ve regex için
  kaçışlanır — `.` gerçekten nokta demektir.
- Yakalanan değerler `destination` içindeki aynı adlı `:param`'lara yazılır.
  Karşılığı olmayan bir yer tutucu olduğu gibi bırakılır.

## Ortam değişkenleri

Framework'ün okuduğu tüm değişkenler. `.env` dosyası varsa CLI tarafından
otomatik yüklenir (`--env-file=.env`); yoksa bayrak hiç geçilmez ve uyarı
basılmaz.

| Değişken | Kim okur | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `NODE_ENV` | her yer | `production` (start/build), `development` (dev) | Dev overlay, EJS cache, manifest yeniden okuma, route hata davranışı ve prewarm varsayılanlarını belirler. `jskelet dev` bunu kendisi ayarlar — `cross-env` gerekmez. |
| `PORT` | `startServer` | `3000` | Dinlenecek port |
| `HOST` | `startServer` | `0.0.0.0` | Bağlanılacak arayüz |
| `DEV_TOKEN` | `devGate`, `prewarm` | — | Ayarlıysa token taşımayan her isteğe 404 döner. Isıtma token'ı çerez olarak taşır. [09](./09-dev-araclari.md) |
| `PREWARM` | `startPrewarm` | — | `0` ısıtmayı kapatır; `1` config'teki `enabled: false`'u ezip açar |
| `PREWARM_MAX` | `prewarm` | `400` | En fazla kaç yol ısıtılır |
| `PREWARM_CONCURRENCY` | `prewarm` | prod 4, dev 2 | Paralel işçi sayısı |
| `PREWARM_DELAY_MS` | `startPrewarm` | prod 500, dev 3000 | İlk turun gecikmesi |
| `PREWARM_INTERVAL_SECONDS` | `startPrewarm` | `0` | 0'dan büyükse periyodik tur |
| `JSKELET_VERBOSE` | `jskelet dev` | — | `1` ise restart'ta değişen dosyaların tamamı listelenir |
| `JSKELET_COLOR` | `jskelet/log` | — | `1` ise renk zorlanır. Alt süreçler boruya yazdığı için renk algılaması kapanır; `jskelet dev` bunu kendisi ayarlar. |
| `JSKELET_CHILD` | `jskelet build` | — | Dev script'i tarafından ayarlanır; build banner'ı ve "Ready" özetini bastırır |
| `NO_COLOR` | `jskelet/log` | — | Ayarlıysa renk hiç kullanılmaz (`JSKELET_COLOR`u da ezer) |

Uygulamanızın kendi değişkenleri (API origin'i, token'lar) framework tarafından
okunmaz; doğrudan `process.env` üzerinden kullanın. Tarayıcıya ulaşması
gerekenleri `clientEnv` ile bildirin.

Sayısal prewarm ayarları yalnızca **pozitif ve sonlu** değer kabul eder;
geçersiz bir değer sessizce bir sonraki katmana (config → kod varsayılanı)
düşer.

## Programatik erişim

```js
import { getConfig, loadConfig } from "jskelet";

await loadConfig();                          // proje kökünden okur
await loadConfig({ root: "/baska/proje" });  // farklı kök
await loadConfig({ configFile: "jskelet.test.mjs" });
await loadConfig({ force: true });           // önbelleği atlayıp yeniden oku

const config = getConfig();                  // çözümlenmiş config
```

`loadConfig()` aynı süreçte ikinci çağrıda önbelleğe düşer: `jskelet start` hem
`ensure-build` hem `createApp` üzerinden çağırıyor ve config'i iki kez okuyup iki
kez loglamanın faydası yok.

`getConfig()` `loadConfig()` çağrılmadan kullanılırsa **hata verir**: sessiz
yanlış yol, "stylesheet neden yok" gibi teşhisi zor sorunlara dönüşüyor.

Çözümlenmiş config'te dizinler mutlak yol olarak `config.dirs` altındadır
(`views`, `public`, `client`, `routes`, `styles`, `generated`, `assets`,
`fonts`), desenler derlenmiş hâldedir ve `config.loaded` dosyanın gerçekten
okunup okunmadığını söyler.

## Sırada ne var

- Build tarafındaki alanların etkisi: [08-build.md](./08-build.md)
- Dev akışı ve `DEV_TOKEN`: [09-dev-araclari.md](./09-dev-araclari.md)
- Ortam değişkenlerinin dağıtımda kullanımı: [10-dagitim.md](./10-dagitim.md)
