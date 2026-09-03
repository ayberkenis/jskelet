# 11 — Next.js'ten taşıma

Bu belge Next.js App Router kullanan bir projeyi JSkelet'e taşımayı anlatır:
kavram ve API karşılıklarının tablosu, taşınamayan şeylerin açıkça listesi ve
adım adım bir plan. JSkelet'in yüzeyi bilinçli olarak Next'in fiilen kullanılan
alt kümesine benzetildi — `next.config` sözdizimi, Metadata API, `notFound()`,
`revalidate`, `cache()` gibi kavramlar tanıdık gelecek. Farkların *nedenleri*
[02-mimari.md](./02-mimari.md)'de.

## Karşılık tablosu

### Yapılandırma

| Next.js | JSkelet | Not |
| --- | --- | --- |
| `next.config.mjs` | `jskelet.config.mjs` | Aynı ruh, daha küçük yüzey ([07](./07-yapilandirma.md)) |
| `headers()` | `headers()` | Aynı şekil: `{ source, headers: [{ key, value }] }` |
| `redirects()` | `redirects()` | `permanent` → 308, aksi hâlde 307; `statusCode` ile ezilebilir |
| `trailingSlash` | `trailingSlash` | `true` → kanonik URL `/` ile biter (308); varsayılan `false` slash kırpmaz ([07](./07-yapilandirma.md)) |
| `rewrites()` | `rewrites()` | `beforeFiles` / `afterFiles` fazları var; `fallback` yok |
| `compress: true` | Otomatik | `node:zlib` ile brotli + gzip |
| `images.deviceSizes` | `images.widths` | Build zamanı webp üretimi ([08](./08-build.md)) |
| `NEXT_PUBLIC_*` | `clientEnv: [...]` | Hangi anahtarın açık olduğu isimden değil config'ten belli |
| `experimental.*` | — | Yok |

### Routing ve render

| Next.js | JSkelet | Not |
| --- | --- | --- |
| `app/page.js` (dosya bazlı routing) | `routes/*.mjs` içinde `app.get(...)` | Sıra açık yazılır ([03](./03-routing.md)) |
| `app/[slug]/page.js` | `app.get("/:slug", route(...))` | Express desen sözdizimi |
| `params`, `searchParams` | `ctx.params`, `ctx.query` | Controller'ın tek argümanı |
| `layout.js` | `views/layout.ejs` + `hooks.layoutContext()` | Tek layout; iç içe layout yok |
| Sunucu bileşeni (RSC) | Controller + EJS şablonu + `views/components/**` | Fonksiyon HTML string döndürür |
| İstemci bileşeni (`"use client"`) | Island (`data-island` + `mount`) | Sayfanın tamamı hidre edilmez ([05](./05-islands.md)) |
| `notFound()` | `notFound()` | Aynı ad, aynı kontrol akışı |
| `redirect()` | `redirect()` (307) | Kalıcı için `permanentRedirect()` (308) |
| `not-found.js` | `hooks.notFound()` | Bir sayfa tanımı döndürür |
| `error.js` | Express hata yöneticisi | Framework 500 için minimal HTML döner |
| `loading.js` / Suspense | — | Sunucu HTML'i tam; iskelet gerekmiyor |
| Streaming SSR | — | Yanıt tek parça |
| `generateMetadata()` | Controller `metadata` + `hooks.metadata()` | Aynı alan adları ([04](./04-render-ve-sablonlar.md)) |
| `generateStaticParams()` | `hooks.prewarmPaths()` | Build zamanı değil, açılış zamanı ısıtma |
| Route Handlers (`route.js`) | Düz Express handler'ı | `app.get/post(...)` |
| Middleware (`middleware.ts`) | Express middleware + config `rewrites`/`headers`/`redirects` | `app.use(...)` |

### Veri ve önbellek

| Next.js | JSkelet | Not |
| --- | --- | --- |
| `export const revalidate = 60` | `route(controller, { revalidate: 60 })` | Ya da `cache().html` ([06](./06-cache.md)) |
| ISR (dosyaya yazılan prerender) | Bellek içi TTL cache + stale-while-revalidate | Diske yazılmaz |
| `fetch(..., { next: { revalidate } })` | — | Önbellek sayfa düzeyinde |
| `unstable_cache` | — | İstek üstü veri önbelleği yok; sayfa önbelleği var |
| React `cache()` | `cache()` | Aynı davranış: istek içi memoizasyon |
| `revalidatePath()` | `invalidateHtmlCache("/haber/:slug")` | Yol, desen ya da RegExp; varsayılan olarak siler değil bayatlatır |
| `revalidateTag()` | `clearDataCache("haber:")` | Tag bildirmeye gerek yok: bağımlılık render sırasında gözlenir ([06](./06-cache.md)) |
| `cookies()`, `headers()` | `ctx.req.headers`, `ctx.req.cookies`* | Express nesnesine doğrudan erişim |
| `dynamic = "force-dynamic"` | `revalidate` vermemek | Önbellek kapalı demek |

\* Express 5 çerezleri kendiliğinden ayrıştırmaz; `cookie-parser` ekleyin ya da
başlığı elle okuyun.

### Bileşenler ve yardımcılar

| Next.js | JSkelet | Not |
| --- | --- | --- |
| `next/link` | `link({ href, text })` — `jskelet/tags` | `title` otomatik, dış bağlantıya `rel`/`target` otomatik |
| `next/link` prefetch'i | `navigation: { prefetch, prerender }` | Speculation Rules; client runtime'ı yok ([07](./07-yapilandirma.md)) |
| `next/image` | `image({ src, alt, priority })` — `jskelet/tags` | `srcset` build manifest'inden |
| `next/font/google` | `fonts: [{ family, weights }]` | Self-host woff2, commit edilir |
| `@phosphor-icons/react` | `icon({ name, weight })` — `jskelet/tags` | Build zamanı SVG sprite |
| `react-dom` preconnect/preload | `preconnect: [...]` + `headHints()` | ([04](./04-render-ve-sablonlar.md)) |
| `clsx` | `cx()` — `jskelet/html` | — |
| `cn()` (clsx + tailwind-merge) | `cn()` — `jskelet/html` | Aynı davranış |
| JSX otomatik kaçışı | `esc()` — `jskelet/html` | **Elle çağırmanız gerekir** |
| React Context | `createStore()` — `jskelet/client` | Minimal pub/sub |
| `useState` / `useEffect` | Island `mount()` içinde düz JS | — |
| `useSyncExternalStore` | `store.subscribe()` | — |
| `<Script>` | Layout'ta `<script>` ya da island | — |

### Neyin karşılığı yok

Bunları taşıma planında baştan hesaba katın:

- **React'in kendisi.** Bileşenler HTML string döndüren fonksiyonlara dönüşür.
  JSX yok, hook yok, sanal DOM yok.
- **TypeScript.** Proje düz JS + JSDoc. `jsconfig.json` içinde `checkJs: true`
  ile editörden tip kontrolü alırsınız.
- **İç içe layout'lar.** Tek bir layout var; ortak bölümleri EJS `include` ya da
  bileşen fonksiyonlarıyla paylaşırsınız.
- **Streaming / Suspense / kısmi prerender.** Yanıt tek parça üretilir.
- **İstemci tarafı yönlendirme.** Gezinme gerçek sayfa yüklemesidir. Sunucu HTML'i
  önbellekten geldiği için pratikte çok hızlıdır, ama SPA geçişleri yoktur.
  Aradaki farkı kapatan şey `navigation` bölümü: prefetch/prerender tıklamadan
  önce belgeyi hazırlar, `viewTransition` geçişi yumuşatır
  ([07](./07-yapilandirma.md)).
- **Server Actions.** Form gönderimleri normal `app.post(...)` handler'larıdır.
- **Otomatik görsel optimizasyonu (istek anında).** Yerel `public/` görselleri
  hâlâ build zamanında optimize edilir. Uzak `http(s)` görseller
  `images.remote.allowHosts` verilirse çalışma anında proxy edilir
  (`/_jskelet/image` → webp); config yoksa olduğu gibi basılır.

## Yan yana örnek

**Next.js (App Router):**

```jsx
// app/haber/[slug]/page.jsx
import { notFound } from "next/navigation";
import Image from "next/image";
import { getArticle } from "@/lib/api";

export const revalidate = 300;

export async function generateMetadata({ params }) {
  const article = await getArticle(params.slug);
  return {
    title: article?.title,
    description: article?.summary,
    alternates: { canonical: `/haber/${params.slug}` },
  };
}

export default async function Page({ params }) {
  const article = await getArticle(params.slug);
  if (!article) notFound();

  return (
    <article className="wrapper">
      <h1 className="text-3xl font-bold">{article.title}</h1>
      <Image src={article.cover} alt={article.title} priority width={1200} height={630} />
      <div dangerouslySetInnerHTML={{ __html: article.body }} />
    </article>
  );
}
```

**JSkelet:**

```js
// routes/50-haber.mjs
import { getArticle } from "@/lib/api.js";

export default function register(app, { route, notFound }) {
  app.get(
    "/haber/:slug",
    route(
      async ({ params }) => {
        const article = await getArticle(params.slug);
        if (!article) notFound();

        return {
          view: "pages/article",
          data: { article },
          metadata: {
            title: article.title,
            description: article.summary,
            canonical: `/haber/${params.slug}`,
            openGraph: { type: "article", image: article.cover },
          },
        };
      },
      { revalidate: 300 },
    ),
  );
}
```

```ejs
<%# views/pages/article.ejs %>
<article class="wrapper">
  <h1 class="text-3xl font-bold"><%= article.title %></h1>
  <%- image({ src: article.cover, alt: article.title, priority: true, width: 1200, height: 630 }) %>
  <div><%- article.body %></div>
</article>
```

`getArticle`'ın `cache()` ile sarılması, aynı render'da `hooks.layoutContext()`
de aynı yazıyı isterse tek upstream isteği yapılmasını sağlar
([06-cache.md](./06-cache.md)).

## Adım adım plan

### 1. İskeleti kur (yarım gün)

Yeni bir dizinde `npx jskelet init` çalıştırın ve `jskelet dev`in açıldığını
görün. Mevcut Next projesini olduğu gibi bırakın; taşıma paralel yürüsün.

`jsconfig.json` içindeki `paths` alias'larınızı taşıyın — `@/` gibi önekler hem
sunucuda hem bundle'da aynı şekilde çalışır ([02-mimari.md](./02-mimari.md)).

### 2. `next.config.mjs`'i çevir (1-2 saat)

`headers()`, `redirects()` ve `rewrites()` bölümleri neredeyse birebir kopyalanır.
Desen sözdizimini kontrol edin: JSkelet `:slug`, `:path*`, `/a-:b` ve
`/:path*.svg` biçimlerini destekler; daha karmaşık `path-to-regexp` ifadeleri
desteklenmez ve uyarı üretir ([07-yapilandirma.md](./07-yapilandirma.md)).

`NEXT_PUBLIC_*` değişkenlerini `clientEnv` listesine taşıyın ve adlarını
sadeleştirin (ön ek artık anlam taşımıyor).

### 3. Veri katmanını taşı (en kolay adım)

`lib/` altındaki API istemcisi ve veri fonksiyonları genelde React'e bağımlı
değildir; olduğu gibi kopyalanır. İki değişiklik yapın:

- React `cache()` yerine `import { cache } from "jskelet"`.
- Başarısız upstream yanıtlarında `reportUpstreamFailure({ status, path })`
  çağırın. Bu, eksik veriyle üretilmiş sayfaların önbelleğe yazılmasını önler
  ([06-cache.md](./06-cache.md)).

### 4. Layout'u kur (yarım gün)

`app/layout.jsx`'i `views/layout.ejs`'e çevirin. Framework'ün varsayılan
layout'unu (`node_modules/jskelet/src/templates/layout.ejs`) kopyalayıp
üzerine yazmak en hızlı yol.

`layout.jsx` içinde veri çekiyorsanız (navigasyon, site ayarları) bunu
`hooks.layoutContext()` içine taşıyın: gövde render'ıyla paralel çalışır ve
döndürdüğü her alan layout local'i olur.

Global metadata varsayılanlarını (`titleTemplate`, `siteUrl`, `description`)
`hooks.metadata()` içine koyun.

### 5. Bileşenleri çevir (en uzun adım)

Her React bileşeni bir fonksiyona dönüşür:

```jsx
// Önce
export function Badge({ label, tone = "neutral", className }) {
  return <span className={cn("rounded px-2 py-1", TONES[tone], className)}>{label}</span>;
}
```

```js
// Sonra — views/components/badge.js
import { attrs, cn, esc } from "jskelet/html";

export function badge({ label, tone = "neutral", class: className }) {
  return `<span${attrs({ class: cn("rounded px-2 py-1", TONES[tone], className) })}>${esc(label)}</span>`;
}
```

Dikkat edilecekler:

- **Kaçış artık elinizde.** JSX otomatik kaçıyordu; burada dış veriyi basarken
  `esc()` çağırmak zorundasınız.
- **`className` → `class`.** JS'te `class` ayrılmış sözcük olduğu için props'ta
  `class: className` biçiminde yeniden adlandırın.
- **Children yerine `html` alanı.** İç içe içerik string olarak geçirilir.
- Named export olarak `views/components/**` altına koyduğunuz her fonksiyon
  şablonlarda import gerektirmeden kullanılabilir
  ([04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md)).

Bileşenleri küçük ve saf tutun; veri çekmeyi controller'da bırakın.

### 6. Sayfaları taşı (sayfa başına saatler)

Her `page.jsx` bir controller + bir EJS şablonuna bölünür. Sırayı düşünerek
dosyalayın:

```
routes/
├── 00-health.mjs        sağlık kontrolü
├── 10-pages.mjs         sabit yollar: /, /hakkinda
├── 50-haber.mjs         /haber/:slug
└── 99-catch-all.mjs     /:slug  (varsa, en sonda)
```

`generateStaticParams()` kullandığınız yerler `hooks.prewarmPaths()`e dönüşür.
Sitemap üreten fonksiyonunuz varsa aynısını kullanın.

`export const revalidate` değerlerini ya `route()`un ikinci argümanına ya da tek
bir yerden yönetmek için `cache().html` desenlerine taşıyın.

### 7. İstemci bileşenlerini island'a çevir (sayfa başına saatler)

Her `"use client"` bileşeni bir island olur. Süreç:

1. Bileşenin **statik** çıktısını sunucu şablonuna taşıyın. İlk render'da
   görünen her şey HTML'de olmalı.
2. Kalan davranışı `mount(element, props)` içine yazın: `useState` yerel
   değişken, `useEffect` doğrudan çağrı, event handler'lar `on()`/`onClick()`.
3. Props'u `data-island-props` ile JSON olarak geçirin.
4. Entry'de `registerAll()` haritasına ekleyin.
5. Bağlanma stratejisini seçin: varsayılan (görünürlük), `data-island-eager`
   (global davranış) ya da `data-island-idle` (ağır ve kritik olmayan).

Context kullanan bileşenler için `createStore()` en yakın karşılık
([05-islands.md](./05-islands.md)).

**Bu adımın en büyük kazancı burada:** hidre edilen alan sayfanın tamamı değil,
yalnızca gerçekten etkileşimli parçalar.

### 8. CSS'i taşı (1-2 saat)

Tailwind yapılandırmanız v4 formatındaysa `styles/globals.css` neredeyse aynı
kalır. Tek kritik ekleme `@source` direktifleri:

```css
@import "tailwindcss" source(none);

@source "../views";
@source "../client";
@source "../routes";
@source "../lib";
```

Bunlar olmadan şablonlarda geçen sınıflar (özellikle
`data-[state=open]:…` gibi varyantlar) sessizce düşer
([08-build.md](./08-build.md)).

`next/font` kullanıyorsanız `fonts: [{ family, weights }]` ekleyin ve
`@font-face` bloklarını elle yazın; üretilen dosyalar `public/fonts/` altında
sabit isimlerle durur.

### 9. Doğrula ve ölç

- `jskelet dev` ile gezip dev overlay'inde hata olmadığını doğrulayın.
- Rapor sayfasında (`/__jskelet/dev/report`) her sayfanın Web Vitals ölçümlerine,
  SSR boyutuna ve island durumuna bakın ([09-dev-araclari.md](./09-dev-araclari.md)).
- Eksik ikon uyarılarını temizleyin.
- `jskelet build` çıktısındaki boyutları eski Next bundle'ıyla karşılaştırın.
- `X-JSkelet-Cache` başlığının beklediğiniz sayfalarda `HIT` döndüğünü kontrol
  edin.

### 10. Yayına al

[10-dagitim.md](./10-dagitim.md) içindeki kontrol listesini geçin. Eski Next
kurulumunu bir süre yanında tutup trafiği kademeli çevirmek, özellikle
redirect kurallarının doğruluğunu ölçmek için işe yarar.

## Taşıma sırasında sık yapılan hatalar

- **`esc()` unutmak.** JSX'ten gelen alışkanlıkla `${value}` yazmak XSS demektir.
  Şablonlarda `<%= %>` (kaçışlı) ile `<%- %>` (ham) ayrımına dikkat edin.
- **`@source` eklemeden yeni bir dizin açmak.** Sınıflar sessizce düşer.
- **Yakalayıcı route'u yanlış sıraya koymak.** `/:slug` her zaman en sonda.
- **Sayfanın tamamını island yapmak.** Kazanç sunucu HTML'inin tam olmasından
  geliyor; island'ı yalnızca gerçekten etkileşimli parçaya bağlayın.
- **`revalidate` vermeyi unutmak.** Önbellek kapalı kalır, her istek render
  edilir ve `X-JSkelet-Cache: MISS` döner.
- **`reportUpstreamFailure()` çağırmamak.** Upstream düştüğünde eksik veriyle
  üretilen sayfa tüm TTL boyunca servis edilir.
- **`clientEnv`e gizli anahtar koymak.** Değerler bundle'da düz metin durur.

## Sırada ne var

- Mimari kararların gerekçeleri: [02-mimari.md](./02-mimari.md)
- Island modelinin ayrıntıları: [05-islands.md](./05-islands.md)
- Yapılandırma referansı: [07-yapilandirma.md](./07-yapilandirma.md)
