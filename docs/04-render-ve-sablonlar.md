# 04 — Render ve şablonlar

Bu belge sunucu HTML'inin nasıl üretildiğini anlatır: EJS motorunun ayarları,
layout dosyasının çözümü ve kullanabildiği local'ler, `views/pages` altındaki
sayfa şablonları, `views/components/**` altındaki bileşenlerin otomatik kaydı,
şablonlara hazır gelen `html`/`tags` yardımcıları, `metadata` nesnesinin `<head>`
etiketlerine çevrilmesi ve üç render hook'u. Controller'ın bu katmana ne
gönderdiği [03-routing.md](./03-routing.md)'de, varlık URL'lerini üreten
`asset()`/`hasAsset()` [08-build.md](./08-build.md)'de anlatılıyor.

## Render hattı

```
route(controller)
 └─ produce()
     ├─ controller(ctx)  → sayfa tanımı
     └─ renderPage(page)
         ├─ hooks.metadata(page) + page.metadata      → metadata
         ├─ Promise.all([
         │     renderView(page.view, { …data, metadata }),   → body
         │     hooks.layoutContext({ pathname, metadata }),  → context
         │   ])
         └─ layout.ejs render  → tam HTML
```

Layout bağlamı ve gövde **paralel** üretilir. Sebebi ölçümden geliyor:
navigasyon çoğu projede upstream'den geliyor ve gövde render'ıyla sırayla
beklemek her sayfaya gereksiz gecikme ekliyor.

## EJS motoru

Motor ilk render'da bir kez kurulur; bileşen taraması dosya sistemine
dokunduğu için her istekte yapılamaz ve config yüklenmeden hesaplanamaz.

Ayarlar:

| Ayar | Değer | Sebebi |
| --- | --- | --- |
| `root`, `views` | `views` dizini | `include('partials/header')` çağrıları views kökünden çözülür |
| `cache` | dev'de `false`, prod'da `true` | dev'de şablon düzenlemesi anında görünsün |
| `rmWhitespace` | `true` | çıktı boyutu |
| `async` | `true` | şablon içinde `await` kullanılabilir |

Gömülü kullanımlar (test, script) için `resetRenderEngine()` dışa açık: bileşen
dosyaları değişince kaydı yeniler. Dev sunucusu süreci yeniden başlattığı için
normal akışta gerekmez.

## Layout

### Layout dosyası nasıl bulunur

1. `jskelet.config.mjs` → `layout` verilmişse o kullanılır. Yol, **views
   dizininin üst dizinine** göre çözülür: `views` varsayılansa
   `layout: "views/ozel.ejs"` → `<root>/views/ozel.ejs`.
2. Verilmemişse `views/layout.ejs` varsa o kullanılır.
3. O da yoksa framework'ün kendi minimal layout'u kullanılır
   (`node_modules/jskelet/src/templates/layout.ejs`, ayrıca
   `jskelet/layout` belirteciyle de erişilebilir).

Üçüncü seçenek yeni bir projenin tek route ile çalışabilmesi için var. Kendi
layout'unuza geçmenin en pratik yolu o dosyayı `views/layout.ejs` olarak
kopyalamaktır.

### Framework'ün varsayılan layout'u

```ejs
<!DOCTYPE html>
<html lang="<%= lang %>">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <%- extraHead %>
    <% if (hasAsset('app.css')) { %>
    <link rel="stylesheet" href="<%= asset('app.css') %>">
    <% } %>
    <%- headMeta %>
    <% structuredData.forEach(function (item) { %>
    <script type="application/ld+json"><%- jsonScript(item) %></script>
    <% }); %>
  </head>
  <body class="<%= bodyClass %>">
    <%- body %>
    <% if (hasAsset('main.js')) { %>
    <script type="module" src="<%= asset('main.js') %>"></script>
    <% } %>
    <% entries.forEach(function (entry) { %>
    <script type="module" src="<%= asset(entry) %>"></script>
    <% }); %>
    <% if (devtools) { %>
    <script type="module" src="<%= devBasePath %>/overlay.js"></script>
    <% } %>
  </body>
</html>
```

Dikkat edilecek noktalar:

- **`extraHead` en başta.** Kaynak ipuçlarını (`preconnect`, LCP `preload`)
  geciktirmek doğrudan LCP'ye yazılır.
- **Tek, render-blocking stylesheet** ve gerekçesi
  [02-mimari.md](./02-mimari.md)'de. Build çalışmadıysa `hasAsset('app.css')`
  false olur ve etiket hiç basılmaz.
- **`hasAsset` kontrolleri** build eksikken sayfanın 404 veren dosyaları
  istememesini sağlar.
- **Devtools script'i** yalnızca `NODE_ENV=development` iken basılır; prod
  çıktısında hiç yoktur.

### Layout local'leri

| Local | Tip | Kaynağı |
| --- | --- | --- |
| `metadata` | `object` | `hooks.metadata()` + controller `metadata` (controller kazanır) |
| `headMeta` | `string` | `metadata`dan üretilmiş hazır `<head>` etiketleri |
| `extraHead` | `string` | `preconnect` ipuçları + `navigation` ipuçları + controller `head` + `context.extraHead` |
| `structuredData` | `unknown[]` | `hooks.layoutContext()` → `structuredData`; varsayılan `[]` |
| `body` | `string` | Sayfa şablonunun render çıktısı |
| `bodyClass` | `string` | controller `bodyClass` → `context.bodyClass` → `""` |
| `entries` | `string[]` | controller `entries`; varsayılan `[]` |
| `pathname` | `string` | `req.path`; **varsayılan boş string** |
| `lang` | `string` | `context.lang` → `brand.lang` → `"en"` |
| `devtools` | `boolean` | `NODE_ENV === "development"` |
| `devBasePath` | `string` | `brand.devBasePath`, varsayılan `/__jskelet/dev` |
| `asset`, `hasAsset` | fonksiyon | Manifest erişimi |
| html/tags yardımcıları | fonksiyon | `esc`, `attrs`, `cx`, `cn`, `jsonScript`, `link`, `image`, `icon`, `preloadImage`, `toKebab` |
| `views/components/**` export'ları | fonksiyon | Otomatik kayıt |
| `hooks.layoutContext()` çıktısındaki her alan | — | Doğrudan local olur |

`pathname`'in boş varsayılanı bilinçli: `"/"` yazmak her sayfayı ana sayfa
sanıp logoyu `<h1>` olarak bastıran türde hatalara yol açıyor.

## Sayfa şablonları

`view` alanı `views/` altındaki yolu uzantısız verir: `"pages/home"` →
`views/pages/home.ejs`. Şablona geçen local'ler `data` alanının içeriği artı
`metadata`dır — layout local'leri **değil**. Sayfa şablonu yine tüm yardımcılara
ve bileşenlere erişir.

```ejs
<%# views/pages/home.ejs %>
<section class="wrapper">
  <h1 class="text-3xl font-bold"><%= heading %></h1>

  <%# `list` views/components/list.js içinde tanımlı; import gerekmiyor. %>
  <%- list({ items }) %>

  <div class="mt-8" data-island="counter" data-island-props='{"start":5}'></div>
</section>
```

EJS'te iki çıktı biçimini karıştırmayın:

- `<%= value %>` — HTML kaçışlı. Kullanıcı/upstream verisi için **daima** bu.
- `<%- html %>` — ham. Yalnızca kendi ürettiğin, güvenli HTML string'leri için
  (bileşen çağrıları, `headMeta`, `body`).

`async: true` açık olduğu için şablon içinde `await` da kullanılabilir, ancak
veri çekmeyi controller'da tutmak teşhisi kolaylaştırır.

## Bileşenler: `views/components/**`

Bileşenler EJS partial'ı değil, **HTML string döndüren fonksiyonlardır**.
`views/components/**` altındaki her `.js` dosyası taranır ve **her named export**
şablon local'i olur. Elle bakılan bir barrel dosyası yok: yeni bir bileşen
eklemek için dosyayı oluşturmak yeterli.

```js
// views/components/list.js
import { esc } from "jskelet/html";

/**
 * @param {{ items: string[] }} props
 * @returns {string}
 */
export function list({ items }) {
  if (!items?.length) return "";

  const rows = items.map((item) => `<li class="py-1">${esc(item)}</li>`).join("");
  return `<ul class="mt-6 list-disc pl-6">${rows}</ul>`;
}
```

Şablonda:

```ejs
<%- list({ items }) %>
```

Kurallar:

- Tarama özyinelemelidir; alt dizinler de kapsanır.
- `default` export'lar yok sayılır — yalnızca named export'lar kaydedilir.
- `loader.js` ve `index.js` bileşen dosyası sayılmaz.
- `views/components/index.js` varsa **barrel** olarak, en düşük öncelikle en
  önce yüklenir. Tek amacı `lib/` yeniden ihraçlarını şablon local'i yapmak;
  bileşenlerin kendi dosyaları sonradan gelip sessizce üzerine yazar.
- Aynı ad iki farklı bileşen dosyasında tanımlıysa uyarı basılır ve **ikincisi
  kazanır**: `[components] 'card' is defined twice: a.js and b.js — the second
  one wins.`
- `views/components` dizini yoksa bileşen kaydı boş kalır; bileşen kullanmayan
  bir proje de çalışır.

## Yardımcılar: `jskelet/html`

Şablonlara otomatik geçer; bileşen dosyalarında `import { … } from "jskelet/html"`
ile alınır.

### `esc(value)`

Metin içeriği ve attribute değerleri için kaçış (`&`, `<`, `>`, `"`, `'`).
`null`, `undefined` ve `false` boş string'e çevrilir — koşullu render'da
`false && "…"` gibi ifadeler `"false"` basmaz.

```js
esc('<b>"x"</b>');  // "&lt;b&gt;&quot;x&quot;&lt;/b&gt;"
```

### `attrs(object)`

Attribute nesnesini string'e çevirir. `null`/`undefined`/`false` atlanır, `true`
boolean attribute olarak yazılır, geri kalan değerler kaçışlanır. Çıktı boş
değilse **başında bir boşluk** ile döner, böylece `<div${attrs(...)}>` her zaman
doğru biçimlenir.

```js
`<input${attrs({ type: "text", required: true, value: null })}>`;
// '<input type="text" required>'
```

### `cx(...inputs)`

`clsx` karşılığı: string, sayı, dizi ve `{ sınıf: koşul }` nesnesi kabul eder,
falsy değerleri atar. Tailwind çakışması **çözmez**.

```js
cx("btn", isActive && "btn-active", { "btn-lg": size === "lg" });
```

### `cn(...inputs)`

`cx()` ile birleştirir, sonra `tailwind-merge` ile Tailwind çakışmalarını çözer.
Bir bileşenin varsayılan sınıflarının çağıran tarafından ezilmesi gerektiğinde
bunu kullanın.

```js
cn("px-4 py-2 bg-slate-100", className);  // className "bg-white" ise bg-slate-100 düşer
```

`tailwind-merge` çalışma zamanı bağımlılığı olarak korunur çünkü sınıf hesabı
yalnızca sunucuda yapılır; client bundle'a hiç girmez.

### `jsonScript(value)`

`<script type="application/ld+json">` gövdesi için güvenli JSON: `<`, `>`, `&`
ve U+2028/U+2029 kaçırılır, böylece `</script` ya da `<!--` dizileri gövdeyi
kapatamaz.

```ejs
<script type="application/ld+json"><%- jsonScript(article) %></script>
```

## Yardımcılar: `jskelet/tags`

`next/link`, `next/image` ve `@phosphor-icons/react` karşılıkları. Hepsi HTML
string döndürür ve EJS içinden `<%- %>` ile basılır.

### `link(props)`

```js
link({
  href: "/hakkinda",
  text: "Hakkında",
  class: "font-semibold",
  // opsiyonel: html, title, ariaLabel, target, rel, attrs
});
```

- `title` verilmezse `ariaLabel` → `text` → `href` sırasıyla otomatik
  doldurulur.
- `href` `http://` ya da `https://` ile başlıyorsa `target="_blank"` ve
  `rel="noopener noreferrer"` otomatik eklenir; açıkça verirsen senin değerin
  kullanılır.
- `html` verilirse içerik ham basılır; `text` verilirse kaçışlanır.
- `attrs` nesnesi ek attribute'ları geçirir ve öncekilerin üzerine biner.

### `image(props)`

```js
image({
  src: "/hero.png",
  alt: "Kapak",
  priority: true,
  // opsiyonel: width, height, class, sizes, srcset, fill, loading,
  //            unoptimized, attrs
});
```

Davranış:

- `public/` altındaki yerel raster görseller için build'de üretilen webp
  varyantları (`.jskelet/images.json`) otomatik olarak `srcset` + intrinsic
  `width`/`height` olarak eklenir. Manifest'te olmayan ya da uzak görseller
  olduğu gibi basılır.
- `srcset` elle verilmişse ya da `unoptimized: true` ise manifest'e hiç
  bakılmaz.
- Yalnızca **tek** varyant üretilmişse (kaynak zaten küçükse) `srcset`/`sizes`
  yazılmaz; gürültüden ibaret olurdu.
- `sizes` verilmezse makul bir varsayılan üretilir: görsel kendi intrinsic
  genişliğinden büyütülmez, dar ekranlarda viewport'u kaplar
  (`(max-width: Npx) 100vw, Npx`).
- `priority: true` → `loading="eager"`, `decoding="sync"`,
  `fetchpriority="high"`. LCP görseli için.
- `priority` yoksa → `loading="lazy"`, `decoding="async"`.
- `fill: true` → `width`/`height` yazılmaz ve
  `absolute inset-0 h-full w-full object-cover` sınıfları `cn()` ile birleştirilir.

### `icon(props)`

Build zamanı üretilen SVG sprite'tan `<use>` çıkarır.

```js
icon({ name: "ArrowRight", weight: "bold", size: 20, class: "text-slate-500" });
// <svg width="20" height="20" class="…" aria-hidden="true" focusable="false"
//   fill="currentColor" viewBox="0 0 256 256"><use href="/assets/sprite.<hash>.svg#arrow-right-bold"></use></svg>
```

- `name` Phosphor adıdır; `ArrowRightIcon` ve `ArrowRight` biçimleri de kabul
  edilir ve `arrow-right`'a çevrilir (`toKebab()`).
- `weight` sprite id'sine dâhildir: `thin`, `light`, `regular` (varsayılan),
  `bold`, `fill`, `duotone`.
- `size` varsayılan 24; `width` ve `height` olarak yazılır.
- Development'ta sprite'ta olmayan bir sembol istendiğinde tek seferlik uyarı
  basılır. Sprite yalnızca kaynakta **statik olarak** görülen adları içerir; adı
  çalışma anında hesaplanan bir çağrı eksik sembole işaret ederse ekranda
  sessizce boşluk kalır ([08-build.md](./08-build.md)).

### `preloadImage(props)`

```js
preloadImage({ href: "/assets/img/hero-1280.abc.webp", imagesrcset, imagesizes });
// <link rel="preload" as="image" href="…" fetchpriority="high">
```

Pratikte doğrudan çağırmak yerine `headHints()` kullanılır:

```js
import { headHints } from "jskelet";

return {
  view: "pages/article",
  head: headHints({ href: cover, imageSrcSet, imageSizes }),
};
```

`headHints()` `href` yoksa boş string döner, yani koşul yazmak gerekmez.
Preconnect'leri layout zaten her sayfaya bastığı için burada tekrarlanmaz.

## Metadata → `<head>`

Controller `metadata` döndürür, framework onu etiketlere çevirir (Next.js'in
Metadata API'sinin karşılığı). Şema bilinçli olarak küçük; daha fazlası
gerekirse `extraTags` ile ham HTML eklenir, böylece framework her yeni meta türü
için sürüm çıkarmak zorunda kalmaz.

| Alan | Tip | Anlamı |
| --- | --- | --- |
| `title` | `string` | `<title>` |
| `titleTemplate` | `string` | `"%s \| Site"` — `title` buna gömülür. Yalnızca `title` da varsa uygulanır. |
| `description` | `string` | `<meta name="description">` |
| `canonical` | `string` | Mutlak ya da göreli URL |
| `siteUrl` | `string` | Göreli `canonical`ı mutlaklaştırmak için taban |
| `robots` | `{ index?: boolean, follow?: boolean }` | Varsayılan `index, follow` |
| `locale` | `string` | `og:locale` |
| `openGraph` | `{ title, description, url, type, siteName, image, imageWidth, imageHeight }` | `og:*` etiketleri |
| `twitter` | `{ card, site, creator, title, description, image }` | `twitter:*` etiketleri |
| `extraTags` | `string[]` | Olduğu gibi basılacak ham etiketler |

Üretim kuralları:

- **Robots varsayılanı indekslenebilir.** Bir sayfayı gizlemek açık bir karar
  olmalı: `robots: { index: false }` → `noindex, follow`.
- **OpenGraph `property` kullanır, `name` değil.** Bazı kazıyıcılar `name` ile
  yazılmış og etiketlerini görmezden geliyor.
- **Devralma zinciri:** `og:title` yoksa `title`, `og:description` yoksa
  `description`, `og:url` yoksa mutlaklaştırılmış `canonical`, `twitter:title`
  yoksa `og:title` → `title`, `twitter:image` yoksa `og:image`.
- **`twitter:card`** verilmezse `og:image` varsa `summary_large_image`, yoksa
  `summary`.
- **Boş değerler hiç basılmaz:** `null`, `undefined` ve `""` olan alanlar
  etiket üretmez.
- `og:type` verilmezse `website`.

Örnek:

```js
return {
  view: "pages/article",
  metadata: {
    title: article.title,
    description: article.summary,
    canonical: `/haber/${article.slug}`,
    openGraph: {
      type: "article",
      image: article.cover,
      imageWidth: 1200,
      imageHeight: 630,
    },
    extraTags: [`<meta property="article:published_time" content="${article.date}">`],
  },
};
```

`titleTemplate` ve `siteUrl` gibi her sayfada aynı olan alanları
`hooks.metadata()` içine koyun; controller yalnızca sayfaya özel olanı verir.

`renderHeadMeta(metadata)` fonksiyonu dışa açıktır; layout dışında (ör. bir
fragment ya da e-posta) aynı etiketleri üretmek gerekirse kullanılabilir.

## Hook'lar

Hook'lar `jskelet.config.mjs` → `hooks` altında tanımlanır. Hepsi opsiyonel,
hepsi `async` olabilir. **Bir hook hata verirse sayfa düşmez:** framework kendi
varsayılanına döner ve uyarır.

### `hooks.metadata(page)`

Her sayfanın metadata varsayılanı. Argüman olarak render edilen sayfa tanımını
alır, bir metadata nesnesi döndürür. Controller'ın `metadata` alanı bunun
**üzerine biner** (alan bazında, sığ birleştirme).

```js
hooks: {
  metadata() {
    return {
      titleTemplate: "%s | JSkelet",
      description: "JSkelet ile kurulmuş bir site.",
      siteUrl: "https://ornek.com",
    };
  },
}
```

### `hooks.layoutContext({ pathname, metadata })`

Layout'a her render'da eklenen local'ler. Döndürülen nesnenin **her alanı**
layout local'i olur; ayrıca üç alan özel olarak yorumlanır:

- `lang` → `<html lang>`
- `structuredData` → JSON-LD script'leri (dizi)
- `extraHead` → `<head>`e eklenir (controller `head`inden sonra)
- `bodyClass` → controller `bodyClass` vermemişse kullanılır

```js
hooks: {
  async layoutContext({ pathname }) {
    return {
      bodyClass: "min-h-full",
      navigation: await getNavigation(),
      isHome: pathname === "/",
    };
  },
}
```

Bu hook gövde render'ıyla **paralel** çalışır; içinde upstream çağırmak sayfaya
sıralı gecikme eklemez.

### `hooks.notFound()`

404 sayfası tanımı. Döndürdüğü nesne `renderPage`'e `pathname: "/404"` ile
verilir. Ayrıntı: [03-routing.md](./03-routing.md).

### Diğer hook'lar

`hooks.prewarmPaths()` render katmanına değil ısıtmaya aittir; bkz.
[06-cache.md](./06-cache.md).

## Overlay portal noktası

`jskelet/client` → `getOverlayRoot()` modal ve drawer içeriğini taşıyacağı
hedefi verir: layout'ta `<div id="jskelet-overlays"></div>` varsa oraya, yoksa
`body`ye. Portal, `overflow` ya da `transform` taşıyan bir ata elementin
`position: fixed` overlay'i kırpmasını engeller. Modal kullanacaksanız bu div'i
layout'un `<body>` sonuna eklemek yeterli
([05-islands.md](./05-islands.md)).

## Sırada ne var

- Island'lar ve `entries`: [05-islands.md](./05-islands.md)
- `asset()`, manifest ve Tailwind taraması: [08-build.md](./08-build.md)
- Hook'ların config içindeki yeri: [07-yapilandirma.md](./07-yapilandirma.md)
