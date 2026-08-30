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
`[config] jskelet.config.mjs loaded — 3 headers, 2 redirects, 1 cache rule`

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

  security: {
    trustProxy: true,
    cookieSecret: process.env.JSKELET_SECRET,
    csrf: {
      enabled: true,
      token: false,
      allowedOrigins: [],
      exclude: ["/webhook/:path*"],
      cookieName: "csrf_token",
      fieldName: "_csrf",
      headerName: "x-csrf-token",
    },
  },

  navigation: {
    prefetch: "moderate",
    prerender: "conservative",
    viewTransition: true,
    exclude: ["/cikis"],
  },

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
      maxEntries: 500,
      data: { maxEntries: 10000, staleFactor: 10 },
      prewarm: {
        enabled: true,
        max: 400,
        concurrency: 4,
        rps: 0,
        intervalSeconds: 0,
        rotate: true,
        priority: ["/", "/haber/:slug"],
      },
    };
  },

  hooks: {
    metadata() { /* … */ },
    layoutContext() { /* … */ },
    notFound() { /* … */ },
    error() { /* … */ },
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

## `security`

**Tip:** `object` — **Varsayılan:**
`{ trustProxy: true, cookieSecret: null, csrf: { enabled: true, token: false, … } }`

Kişiye özel sayfaların tamamı ve gerekçeleri
[12-panel-ve-oturum.md](./12-panel-ve-oturum.md)'de; burada alanların referansı
var.

| Alan | Tip | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `trustProxy` | `boolean` | `true` | Express'in `trust proxy` ayarı. Ters proxy arkasında doğru protokol ve istemci IP'si için gerekli. |
| `cookieSecret` | `string \| null` | `null` | İmzalı cookie sırrı. Verilmezse `JSKELET_SECRET` okunur. |
| `csrf.enabled` | `boolean` | `true` | Origin/`Sec-Fetch-Site` kontrolü. |
| `csrf.token` | `boolean` | `false` | Çift gönderim token'ı katmanı. |
| `csrf.allowedOrigins` | `string[]` | `[]` | Kendi host'umuzun yanında kabul edilen origin'ler. |
| `csrf.exclude` | `string[]` | `[]` | Kontrolden muaf yollar; `source` desen sözdizimi. |
| `csrf.cookieName` | `string` | `"csrf_token"` | Token cookie'sinin adı. |
| `csrf.fieldName` | `string` | `"_csrf"` | `csrfField()`in bastığı alan adı. |
| `csrf.headerName` | `string` | `"x-csrf-token"` | Token'ın kabul edildiği başlık. |

`trustProxy` doğrudan internete açık bir sunucuda **kapatılmalı**: açıkken
istemci kendi `X-Forwarded-For` başlığını uydurabilir ve rate limit ile audit
log yanlış adresi görür.

CSRF kontrolü yalnızca çapraz site olduğu **belli** olan istekleri reddeder —
`Origin` uyuşmuyorsa ya da `Sec-Fetch-Site: cross-site` geldiyse. İkisi de yoksa
istek geçer, çünkü tarayıcılar çapraz origin bir POST'ta `Origin`'i her zaman
gönderirken webhook'lar hiç göndermez. Yine de tarayıcıdan gelmeyen uçları
`csrf.exclude` listesine yazmak niyeti okunur kılıyor.

## `navigation`

**Tip:** `object` — **Varsayılan:**
`{ prefetch: "moderate", prerender: false, viewTransition: false, exclude: [] }`

Site içi gezinmeyi hızlandıran `<head>` ipuçları. JSkelet klasik MPA olduğu için
her tıklama tam sayfa yüklemesidir; bu bölüm o yüklemeyi tarayıcının **önceden**
yapmasını sağlar. Client runtime'ı eklenmez — Speculation Rules ve view
transition tarayıcı yetenekleridir, desteklemeyen tarayıcıda sessizce yok
sayılırlar.

| Alan | Tip | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `prefetch` | `false \| "conservative" \| "moderate" \| "eager"` | `"moderate"` | Bağlantı hedefinin **belgesini** önceden indirir |
| `prerender` | aynı | `false` | Hedefi arka planda **tam render eder**; tıklama anında açılır |
| `viewTransition` | `boolean` | `false` | `@view-transition { navigation: auto }` basar |
| `exclude` | `string[]` | `[]` | Spekülasyon dışı bırakılacak href desenleri |

`true` verilirse `prefetch`/`prerender` varsayılan eagerness'a düşer; tanınmayan
bir değer uyarı basıp varsayılana döner.

**Eagerness ne demek:** `conservative` bağlantıya basıldığı an, `moderate`
bağlantı üzerinde bir süre duraksandığında, `eager` bağlantı görünür olur olmaz
tetikler. Yukarı çıktıkça isabet artar, boşa giden istek de artar.

**`prerender` neden kapalı geliyor.** Prerender edilen sayfanın script'leri
gerçekten çalışır. Ölçüm kodunu `prerenderingchange` olayına bağlamayan bir
uygulamada ziyaret sayıları şişer. Açmadan önce analytics'i gözden geçirin;
sunucu tarafındaki maliyeti düşüktür, çünkü spekülatif istek de HTML
önbelleğinden karşılanır ([06-cache.md](./06-cache.md)).

**Her koşulda muaf olanlar.** `/api/*`, `/_fragment/*` ve `brand.devBasePath`
altındaki yollar otomatik dışlanır; `exclude` bunların üstüne eklenir. Ayrıca
`rel="nofollow"`, `target="_blank"` ve `data-no-prefetch` taşıyan bağlantılar
hiçbir kurala girmez. Yan etkisi olan tek bir bağlantıyı dışarıda bırakmanın en
kolay yolu sonuncusu:

```html
<a href="/cikis" data-no-prefetch>Çıkış</a>
```

**`viewTransition` açarken arka planı `<html>`e verin.** Geçiş sırasında tarayıcı
eski ve yeni sayfanın anlık görüntülerini çapraz geçirir; `<body>`ye verilmiş bir
arka plan bu görüntünün içinde kalır ve altta kalan canvas görünür. Sonuç, her
geçişte bir kare beyaz flaştır ve koyu temada gözden kaçmaz. Renk `<html>` (ya da
`:root`) üzerindeyse böyle bir boşluk oluşmaz:

```html
<html lang="tr" class="bg-white dark:bg-slate-950">
  <body class="text-slate-900 dark:text-slate-100">
```

Hareket azaltma tercihi framework tarafından karşılanır: `prefers-reduced-motion:
reduce` altında geçiş kapatılır, ayrıca bir şey yazmanız gerekmez.

**Geçişi içerikle sınırlayın.** Varsayılan davranış tüm belgeyi tek parça olarak
çapraz geçirir, yani gezinme boyunca hiç değişmeyen header ve footer da titrer.
Bu bölgelere bir `view-transition-name` vermek onları kendi grubuna alır;
tarayıcı aynı adı iki belgede de gördüğü için "aynı öğe" sayar. Adlandırılan
öğenin animasyonunu kapatınca geçiş yalnızca içerikte kalır:

```css
body > header { view-transition-name: site-header; }
body > footer { view-transition-name: site-footer; }

::view-transition-old(site-header),
::view-transition-old(site-footer) { animation: none; opacity: 0; }
::view-transition-new(site-header),
::view-transition-new(site-footer) { animation: none; opacity: 1; }

/* Kalan içerik; varsayılan 250ms gezinmeyi yavaş hissettiriyor. */
::view-transition-old(root),
::view-transition-new(root) { animation-duration: 180ms; }
```

Çalışan hâli `examples/marketing/styles/globals.css` içinde.

**CSP kullanıyorsanız** kurallar satır içi bir `<script type="speculationrules">`
olarak basılır; `script-src` politikanızın buna izin vermesi gerekir.

```js
navigation: {
  prefetch: "moderate",
  prerender: "conservative",
  viewTransition: true,
  exclude: ["/cikis", "/sepet/*"],
}
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

**Tip:**
`() => { html?: Record<string, number>, maxEntries?: number, data?: object, trackUpstream?: boolean, trackDependencies?: boolean, transientRetry?: object | false, prewarm?: object }` —
**Varsayılan:**
`{ html: {}, maxEntries: 500, data: { maxEntries: 10000, staleFactor: 10 }, trackUpstream: true, trackDependencies: true, transientRetry: { attempts: 1, delayMs: 300 }, prewarm: { enabled: true, max: 400, intervalSeconds: 0 } }`

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

Tek istisna `route(fn, { private: true })`: bu route'ta desen eşleşse bile yok
sayılır. Kilidin tek yönlü olması bilinçli — ters yönde bir hata, bir
kullanıcının HTML'inin bir başkasına servis edilmesi anlamına geliyor.

### `cache().maxEntries`

**Tip:** `number` — **Varsayılan:** `500`

HTML önbelleğinin girdi sınırı. Girdi başına yüz kilobayt düştüğü için bu sayıyı
yükseltmek belleği hızla tüketir; on binlerce yollu bir siteyi buradan çözmeye
çalışmak yanlış katman, doğru yer `cache().data`.

### `cache().data`

Upstream veri önbelleği (`withDataCache`). Ayrıntı: [06-cache.md](./06-cache.md).

| Alan | Tip | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `maxEntries` | `number` | `10000` | LRU girdi sınırı. JSON, HTML'e göre onlarca kat küçük olduğu için sınır yüksek. |
| `staleFactor` | `number` | `10` | TTL dolduktan sonra girdinin kaç TTL boyunca daha kullanılabileceği. `0` → bayat servis yok. |

### `cache().trackUpstream`

**Tip:** `boolean` — **Varsayılan:** `true`

Açıkken `globalThis.fetch` sarılır ve render sırasındaki geçici upstream
hataları (`429`, `5xx`, ağ) kendiliğinden bildirilir; `reportUpstreamFailure()`
çağırmak gerekmez. `fetch`i kendisi saran bir uygulama bunu kapatabilir.

### `cache().trackDependencies`

**Tip:** `boolean` — **Varsayılan:** `true`

Açıkken bir render'ın okuduğu `withDataCache` anahtarları kaydedilir ve
`clearDataCache()` o veriyi okumuş HTML sayfalarını da bayatlatır — hedefli
invalidation için uygulamanın hiçbir şey bildirmesi gerekmez
([06-cache.md](./06-cache.md)). `withDataCache` kullanmayan bir uygulamada
kaydedilecek bir şey yok; kapatmak bağlam kurma maliyetini de kaldırır.

### `cache().transientRetry`

**Tip:** `{ attempts?: number, delayMs?: number } | false` —
**Varsayılan:** `{ attempts: 1, delayMs: 300 }`

Geçici bir upstream hatası yüzünden `notFound()` çağrılan sayfa kaç kez daha
denenir. Amaç var olan bir sayfanın 404'e dönüşmemesi; denemeler tükenirse yanıt
önbelleğe girmeyen bir 503 olur. `false` ya da `attempts: 0` tekrarı kapatır.
Ayrıntı: [06-cache.md](./06-cache.md).

### `cache().prewarm`

| Alan | Tip | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | `false` ise ısıtma yapılmaz (`PREWARM=1` ile ezilebilir) |
| `max` | `number` | `400` | Bir turda en fazla kaç yol ısıtılır |
| `concurrency` | `number` | prod 4, dev 1 | Paralel işçi sayısı |
| `rps` | `number` | prod `0`, dev 4 | Saniyedeki en fazla ısıtma isteği; `0` sınırsız. Upstream kotasını koruyan ayar bu. Dev'deki varsayılan fren, ısıtmanın sayfa isteklerini bekletmemesi için. |
| `delayMs` | `number` | prod 500, dev 3000 | Açılıştan sonra ilk turun gecikmesi |
| `retryDelayMs` | `number` | `2000` | Tekrar turundan önce beklenen süre |
| `intervalSeconds` | `number` | `0` | 0'dan büyükse tur periyodik tekrarlanır |
| `rotate` | `boolean` | `true` | Liste `max`'tan uzunsa periyodik turlar kaldığı yerden devam eder |
| `priority` | `(string \| RegExp)[]` | `[]` | Isıtma sırası; eşleşen yollar her turda başa alınır |

`priority` iki biçim kabul eder: config'in her yerinde geçerli olan desen
sözdizimi ve doğrudan `RegExp`. Önce yazılan önce ısınır.

```js
prewarm: {
  max: 500,
  rps: 4,
  intervalSeconds: 300,
  priority: [
    "/",                     // ana sayfa
    "/piyasalar/:path*",      // tüm piyasa bölümü
    /-yorumlar$/,             // desen sözdiziminin karşılamadığı kural
  ],
}
```

Sayısal alanların her biri aynı adı taşıyan ortam değişkeniyle ezilebilir; env
önceliklidir. Ayrıntı: [06-cache.md](./06-cache.md).

## `hooks`

**Tip:** `Record<string, Function>` — **Varsayılan:** `{}`

Hepsi opsiyonel, hepsi `async` olabilir. Bir hook hata verirse framework kendi
varsayılanına döner ve uyarır — sayfa düşmez.

| Hook | İmza | Döndürdüğü | Belge |
| --- | --- | --- | --- |
| `metadata` | `(page) => object` | Her sayfanın metadata varsayılanı; controller `metadata`sı üzerine biner | [04](./04-render-ve-sablonlar.md) |
| `layoutContext` | `({ pathname, metadata }) => object` | Layout local'leri; `lang`, `structuredData`, `extraHead`, `bodyClass` özel yorumlanır | [04](./04-render-ve-sablonlar.md) |
| `notFound` | `() => object \| null` | 404 sayfa tanımı; `null` ise framework'ün hata sayfası | [03](./03-routing.md) |
| `error` | `({ status, error }) => object \| string \| null` | 404 dışındaki hata sayfaları (ve `notFound` yoksa 404); sayfa tanımı ya da doğrudan HTML | [03](./03-routing.md) |
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

  error({ status }) {
    return {
      view: "pages/error",
      data: { status },
      metadata: { title: "Bir hata oluştu", robots: { index: false } },
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
| `HOST` | `startServer` | `::` | Bağlanılacak arayüz. Varsayılan çift yığın dinler (IPv6 + IPv4); IPv6 yoksa `0.0.0.0`'a düşer |
| `JSKELET_SECRET` | `jskelet/cookies` | — | İmzalı cookie sırrı. `security.cookieSecret` verilmediğinde buradan okunur; ikisi de yoksa imzalı cookie API'si hata verir. [12](./12-panel-ve-oturum.md) |
| `DEV_TOKEN` | `devGate`, `prewarm` | — | Ayarlıysa token taşımayan her isteğe 404 döner. Isıtma token'ı çerez olarak taşır. [09](./09-dev-araclari.md) |
| `PREWARM` | `startPrewarm` | — | `0` ısıtmayı kapatır; `1` config'teki `enabled: false`'u ezip açar |
| `PREWARM_MAX` | `prewarm` | `400` | En fazla kaç yol ısıtılır |
| `PREWARM_CONCURRENCY` | `prewarm` | prod 4, dev 1 | Paralel işçi sayısı |
| `PREWARM_RPS` | `prewarm` | `0` | Saniyedeki en fazla ısıtma isteği; `0` sınırsız |
| `PREWARM_DELAY_MS` | `startPrewarm` | prod 500, dev 3000 | İlk turun gecikmesi |
| `PREWARM_RETRY_DELAY_MS` | `prewarm` | `2000` | Tekrar turundan önceki bekleme |
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
