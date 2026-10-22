# 08 — Build

Bu belge `jskelet build`in yaptığı her işi ve sırasını anlatır: font kopyalama,
ikon sprite üretimi, Tailwind CSS derlemesi, esbuild ile island bundle'ı, görsel
optimizasyonu, manifest yazımı ve önceden sıkıştırma. Ayrıca hash'li varlıkların
`asset()`/`hasAsset()` ile şablonlara nasıl ulaştığı, Tailwind'in `@source`
direktiflerinin neden zorunlu olduğu ve opsiyonel peer bağımlılıklarının
davranışı burada. Çıktının çalışma anında nasıl servis edildiği
[02-mimari.md](./02-mimari.md)'de, build'i tetikleyen watch akışı
[09-dev-araclari.md](./09-dev-araclari.md)'de.

## Hat ve sırası

```
0. Templates      .jsk → .jskelet/templates/*.mjs (her zaman; dosya yoksa no-op)
1. Fonts          config.fonts varsa
2. Icon sprite    config.icons !== false ise
3. CSS            styles giriş dosyası varsa
4. Client JS      client/entries/ varsa
5. Images         config.images !== false, watch değil ve sharp kurulu ise
6. Manifest       .jskelet/manifest.json
7. Precompress    watch değilse
8. Assets upload  watch değilse (kapalıysa `skipped (sebep)`)
```

Şablon derlemesi asset taramasından **önce** biter; istek yolunda parse yoktur.
Tailwind `@source` ve ikon taraması kaynak `.jsk` dosyalarını okur (üretilmiş
`.mjs` değil).

Sıra rastgele değil:

- **CSS ikon sprite'ından sonra gelir.** Sprite bir varlıktır ve sınıf üretmez,
  ama manifest anahtarı verir.
- **Precompress, upload'tan hemen önce:** origin hâlâ `.br`/`.gz` üretir; S3
  adımı yalnızca ham dosyaları kopyalar.
- **Görseller watch turunda hiç çalışmaz:** `sharp` ile yeniden kodlama pahalı.
- **Assets upload watch'ta yok:** yalnızca production `jskelet build`; kapalıysa
  yine satır basılır (`skipped (no build.assets.upload.bucket)` vb.).

Görevler yalnızca ilgili yapılandırma varsa çalışır. Font tanımlamayan bir proje
font adımını hiç görmez; bu, "framework her projeye kendi varsayımlarını
dayatmaz" ilkesinin build tarafındaki karşılığı.

Terminal çıktısı hizalı adım satırları ve sonunda bir `output` bloğu verir: her
varlığın ham ve brotli boyutu, büyükten küçüğe.

## Manifest ve hash'li varlıklar

Build çıktısı `public/assets/` altına **içerik hash'li** adlarla yazılır ve
mantıksal ad → public URL eşlemesi `.jskelet/manifest.json` dosyasına konur:

```json
{
  "app.css": "/assets/app.4f2a1b9c07.css",
  "sprite.svg": "/assets/sprite.dc973997bd.svg",
  "main.js": "/assets/js/main.9E1AB2C3.js",
  "inter-400.woff2": "/fonts/inter-400.woff2"
}
```

Hash sha256'nın ilk 10 hex karakteridir: çakışma için fazlasıyla yeterli ve
dosya adlarını okunur tutuyor. Hash'li olmaları sayesinde bu dosyalara
`Cache-Control: public, max-age=31536000, immutable` yazılabilir.

### `asset(name)` ve `hasAsset(name)`

Şablonlara otomatik geçer; sunucu kodunda `import { asset, hasAsset } from "jskelet"`.

```ejs
<% if (hasAsset('app.css')) { %>
<link rel="stylesheet" href="<%= asset('app.css') %>" data-jskelet-css="app.css">
<% } %>
<% styles.forEach(function (sheet) { %>
  <% if (hasAsset(sheet)) { %>
<link rel="stylesheet" href="<%= asset(sheet) %>" data-jskelet-css="<%= sheet %>">
  <% } %>
<% }); %>
```

- `asset(name)` manifest'te varsa hash'li URL'i, yoksa `/assets/<name>` döner.
  `build.assets.prefix` doluysa bu göreli yolun önüne CDN origin eklenir
  (manifest diskte göreli kalır).
- `asset(name, { origin: "document" })` prefix'i atlar; site origin'indeki
  `/assets/…` yolunu döner. SVG `<use href>` çapraz origin sprite
  yüklemediği için `icon()` sprite'ı her zaman böyle çözer — origin hâlâ
  `public/assets/` servis eder.
- `hasAsset(name)` manifest'te olup olmadığını söyler.

### CDN prefix ve S3 upload

Varsayılan kapalıdır. Prefix / bucket / keyPrefix config'te; credential
env → ECS task role → EC2 IMDS zincirinden. Açılınca:

1. Production build `public/assets/` ve `public/fonts/` (varsayılan `include`)
   altındaki dosyaları S3'e PutObject ile kopyalar. `assets.prefix` doluysa
   `include`'da `fonts` yoksa otomatik eklenir.
2. CSS derlemesi `static.prefixes` kök-mutlak `url()` yollarını
   (`/fonts/…`, `/assets/…`) `prefix` ile yeniden yazar — aksi hâlde CDN'deki
   stylesheet `url("/fonts/x")` yolunu host köküne çözer ve `keyPrefix`
   kaybolur. `@font-face` CDN CSS içinde kalabilir; font ile CSS aynı host'ta
   olduğu için ek CORS gerekmez.
3. Font yüklendiğinde ve `upload.corsOrigin` doluysa (varsayılan `"*"`)
   PutBucketCors bir GET/HEAD kuralı yazar — bucket'taki önceki CORS'un
   **üzerine** yazar; kapatmak için `corsOrigin: null`. HTML'den çapraz
   origin font için bu (veya CloudFront response header) gerekir.
4. Çalışma anında `asset()` / optimize görseller `build.assets.prefix` ile
   absolute CDN URL basar. `icon()` sprite'ı ve
   `asset(name, { origin: "document" })` site origin'inde kalır.

Bucket adı noktalı olabilir (`static.ornek.com`); `https://…` şeması
`prefix`'e yazılır. Config sözlüğü: [07-yapilandirma.md](./07-yapilandirma.md#build).
Dağıtım notları: [10-dagitim.md](./10-dagitim.md).

Build çalışmadıysa uygulama yine ayağa kalkar: `hasAsset()` false olur, layout
stylesheet ve script etiketlerini hiç basmaz. `jskelet build` unutulduğunda hata
yerine stilsiz ama çalışan bir sayfa görürsünüz. Manifest hiç yoksa bir kez uyarı
basılır: ``[assets] no manifest — run `jskelet build`.``

Manifest **dev'de her istekte** yeniden okunur (watch build hash'leri
değiştirir), prod'da bir kez.

### Watch modunda manifest tutarlılığı

Watch turunda yeniden derlenen varlık yeni bir hash'e yazılıp eskisi silinir. Bu
yüzden manifest de güncellenmek zorunda (`patchManifest`): aksi hâlde HTML
silinmiş dosyayı isteyip 404 alır ve sayfa dev oturumunun kalanında stilsiz ya
da JS'siz kalır. CSS ve client görevlerinin ikisi de her turda kendi anahtarını
yamalar; diğer anahtarlar korunur. CSS tarafı watch'ta `syncCssManifest` ile
tüm `.css` anahtarlarını günceller (silinen sayfa sheet'leri de düşer).

## CSS — Tailwind v4

Giriş dosyası `paths.styles` (varsayılan `styles/globals.css`). Dosya yoksa adım
uyarıyla atlanır.

Boru hattı: PostCSS + `@tailwindcss/postcss` → (varsa) lightningcss ile
minifikasyon → `writeAsset("app.css", …)`.

- **PostCSS boru hattı bir kez kurulur:** Tailwind'in kendi önbelleği plugin
  örneğinde yaşıyor; her derlemede yeniden oluşturmak watch turlarını belirgin
  şekilde yavaşlatıyor.
- **lightningcss opsiyoneldir:** yoksa Tailwind'in kendi çıktısı kullanılır,
  yalnızca birkaç kB daha büyük olur.
- Global çıktı `app.css`'tir ve layout onu her sayfada varsayılan olarak
  render-blocking yükler. `<Stylesheets :blocking="false" />` bu beklemeyi
  kapatır, `blocking="(min-width: 1024px)"` onu bir media sorgusuna bağlar
  ([04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md)). Ayrı bir
  "critical CSS" üretilmemesinin ölçüm gerekçesi
  [02-mimari.md](./02-mimari.md)'de.

### Sayfa stylesheet'leri (`styles/pages/`)

Island `entries` ile aynı sözleşme. `styles/pages/*.css` altındaki her dosya
ayrı bir hash'li varlıktır (`home.css` → `/assets/home.<hash>.css`). Controller
yalnızca istediği sayfada yükler:

```js
return {
  view: "pages/home",
  styles: ["home.css"],
};
```

Dizin, `paths.styles` dosyasının yanındaki `pages/` klasörüdür (`styles` taşınırsa
pages de yanında kalır). Dizin yoksa veya boşsa adım yalnızca global sheet üretir.

Her sayfa çıktısı **global derlenmiş CSS + sayfa derlenmiş CSS** içeren tek bir
dosyadır. Controller bir sayfa sheet'i bildirdiğinde layout `app.css`i ayrıca
basmaz; yalnızca birleşik sheet'i yükler. Böylece inline kritik CSS, `app.css`
ve page sheet içindeki aynı Tailwind utility katmanı üç ayrı anda uygulanmaz.
Örneğin global `.px-0` ile sayfadaki `.lg:px-4` çatışsa bile tarayıcı yalnızca
dosyanın son cascade sonucunu boyar ve ara düzen CLS üretmez.

Sayfa CSS'i sayfaya özel kurallar içindir. Bir route için tek sayfa dosyası
tercih edin; `styles` dizisinde birden fazla ad hâlâ desteklenir ama her biri
global CSS'i taşıdığı için gereksiz tekrar indirir. Sayfa adı manifest'te yoksa
layout güvenli biçimde `app.css`e döner. `blocking: false` birleşik linke
`media="print"` ve `onload` ekler; media sorgusu verilirse `media` o sorgu olur.

### `@source` direktifleri zorunludur

Tailwind v4'ün sınıf taraması `globals.css` içindeki `@source` direktiflerine
bağlıdır. Otomatik tespit yalnızca stylesheet'in bulunduğu dizini tarar, bu
yüzden şablonlarda geçen varyantlar (`data-[active=false]:…` gibi) **sessizce
düşer**.

```css
@import "tailwindcss" source(none);

@source "../views";
@source "../client";
@source "../routes";

.wrapper {
  max-width: 48rem;
  margin-inline: auto;
  padding-inline: 1rem;
  padding-block: 2rem;
}
```

`source(none)` otomatik tespiti kapatır ve taramayı tamamen açık hâle getirir.
**Yeni bir üst dizin eklediğinizde `@source` satırını da ekleyin** — sınıfların
"bazen çalışmaması"nın en yaygın sebebi budur.

### CSS watch kapsamı

Watch modunda üç hedef izlenir: stylesheet'in bulunduğu dizin, `views` ve
`client`. Şablon ve island dosyaları da izlenir çünkü Tailwind sınıfları oradan
geliyor; yalnızca `styles/` izlemek yeni bir utility yazıldığında rebuild
etmezdi. Değişiklikler 120 ms birleştirilir.

## Client JS — esbuild

`client/entries/*.{js,ts,mts}` içindeki her kaynak dosya bir entry'dir (`.tsx`
yok). Manifest anahtarı her zaman `*.js` olur (`main.ts` → `main.js`). Aynı stem
için birden fazla uzantı build hatasıdır. Dizin yoksa ya da boşsa adım atlanır.

esbuild ayarları:

| Ayar | Değer | Sebebi |
| --- | --- | --- |
| `bundle` | `true` | — |
| `splitting` | `config.build.client.splitting` (varsayılan `true`) | Ortak modüller paylaşılan chunk'a çıkar; kapatılınca gruplama da düşer |
| `format` | `esm` | `type="module"` script'ler |
| `target` | `chrome111`, `edge111`, `firefox111`, `safari16.4` | ESM + dinamik import + `IntersectionObserver` island modelinin alt sınırı; daha eskisine transpile etmek çıktıyı büyütüp hiçbir ziyaretçi kazandırmıyor |
| `minify` | `true` | — |
| `sourcemap` | yalnızca `NODE_ENV=development` | Prod'da `.map` dosyaları `public/assets` altında yayınlanmaz |
| `entryNames` | `[name].[hash]` | `immutable` cache |
| `chunkNames` | `chunks/[name].[hash]` | — |
| `legalComments` | `none` | — |

Çıktı `public/assets/js/` altına düşer ve her turda önce temizlenir.
`browserslist` okunmaz; hedef listesi kod içinde sabittir. Adım satırı entry
sayısına ek olarak toplam JS dosya sayısını yazar (`1 entry, 48 files`) — çok
chunk teşhisini kolaylaştırır.

### Chunk gruplama (`build.client.groups` / `chunkGroup`)

esbuild native `manualChunks` sunmaz. `build.client.groups` ve
`build.client.chunkGroup` bir plugin ile uygulanır:

1. Eşleşen import bir re-export sarmalayıcısına yönlenir.
2. Sarmalayıcı `jskelet-group:<name>` barrel'ını side-effect olarak çeker.
3. Barrel gruptaki tüm bilinen üyeleri (bare paketler + yol önekindeki
   `.{js,ts,mts}` dosyaları + resolve sırasında keşfedilenler) statik import
   eder — gruba dokunan entry'ler aynı üye kümesine ulaşır ve tek paylaşılan
   chunk oluşur.

**Trade-off:** grup içi tree-shaking zayıflar; bir üyeyi kullanan sayfa grubun
geri kalanını da indirebilir. Grup adı config anahtarıdır; çıktı dosyası
çoğunlukla `chunks/chunk.<hash>.js` kalır. Config sözlüğü:
[07-yapilandirma.md](./07-yapilandirma.md#build).

### Ortak modülleri çatıya toplama (`build.client.hoistShared`)

esbuild bir modülü, ona erişen entry kümesine göre yerleştirir. Dinamik import
edilen her island ayrı bir entry sayılır ve esbuild island'ın her zaman
`main.js`'ten sonra yüklendiğini bilemez. `main.js`'in ve üç island'ın
kullandığı bir yardımcı bu yüzden her `main` + island kombinasyonu için ayrı
bir küçük chunk'a düşer. Onlarca island'lı bir sitede bir sayfa 0–2 KB'lık
yirmiden fazla dosya isteyebilir. `groups` bunu ancak elle tutulan listelerle
çözer.

```js
build: {
  client: {
    hoistShared: {
      into: "client/entries/main.js", // veya "main.js"
      minImporters: 2,
      // Ağır vendor'lar kendi dosyasında kalır, island'ıyla birlikte iner.
      exclude: ["lightweight-charts", "fancy-canvas", "yup"],
    },
    groups: { charts: ["lightweight-charts", "fancy-canvas"] },
  },
},
```

Açıkken şu modüller doğrudan çatı entry'sine girer:

- `main.js`'in static olarak çektiği her şey,
- en az `minImporters` kökün static olarak eriştiği her modül. Kök, bir entry
  ya da island gibi bir dinamik import hedefidir.

Island dosyası böylece yalnızca kendi kodunu taşır. Beklenen çıktı: her
sayfada yüklenen (ve preload edilebilen) tek bir çatı dosyası, island başına
bir dosya ve istediğiniz vendor / grup chunk'ları. Ortak kırıntı kalmaz.

Nasıl çalışır:

1. Bir analiz turu (diske yazmadan) import grafiğini çıkarıp kümeyi hesaplar.
2. İkinci tur, hoisted modülleri external işaretleyip island'ların onlardan
   **hangi adları** kullandığını esbuild çıktısından okur.
3. Çatının sonuna eklenen sanal bir register modülü yalnızca o adları
   `globalThis.__jskeletHoist` altına koyar. Çatının kendi import sırası
   değişmez.
4. Çatı dışından gelen import'lar, değerleri oradan okuyan küçük bir proxy'ye
   (birkaç düzine bayt) çözülür. Proxy her import eden dosya için ayrıdır; bu
   yüzden proxy'ler de ortak chunk oluşturmaz.
5. Hoisted bir modülü hedefleyen `import("…")` dosya üretmez; kaynakta
   `Promise.resolve()` ile çatıdaki değere çözülür. Uygulamada tembel
   `import()` yazarken modülün çatıda olup olmadığını düşünmek gerekmez.
   Yalnızca düz string specifier'lar çözülür; değişkenli ya da şablonlu
   `` import(`./${ad}.js`) `` proxy yoluna düşer ve küçük bir dosya üretir.

`exclude` yalnızca eşleşen modülün kendisini çatı dışında tutar. Onun
kullandığı uygulama dosyaları (`client/lib/dates.js` gibi ortak yardımcılar)
kendi sayaçlarıyla değerlendirilir: yeterince kök kullanıyorsa çatıya girer ve
hariç tutulan modül onlara proxy üzerinden erişir. Böylece sayfaya özel bir
island `exclude` ile çatıdan çıkarılabilir ve ortak yardımcıları küçük parçalara
düşmez. İki kural değişmez:

- Hariç tutulan modülü import eden bir modül de hoist edilmez; edilseydi
  hariç tutulan modülü çatıya geri çekerdi.
- `node_modules` içinde olup **yalnızca** hariç tutulan modül üzerinden erişilen
  dosyalar onunla kalır (`lightweight-charts` → `fancy-canvas`). Uygulama kodu
  aynı paketi doğrudan da import ediyorsa o paket normal sayaçla
  değerlendirilir.

`groups` üyeleri de aynı şekilde yerinde kalır. `exclude`, `groups` ile aynı
eşleyicileri kullanır: bare paket, `./` yol öneki ya da `@/` öneki.

**Takaslar:**

- Island'ların kullandığı adlar, o island'ı hiç yüklemeyen sayfalarda da çatıda
  durur. `import * as` ya da `export *` ile çekilen modül bütünüyle tutulur.
  Büyük kütüphaneler `exclude`'a yazılmalı.
- Proxy export'u değerin anlık kopyasıdır. Sonradan yeniden atanan bir
  `export let` island'lara yansımaz; değişen durum için fonksiyon ya da nesne
  alanı kullanın.
- CommonJS modüller esbuild'in interop yardımcılarına muhtaçtır. Çatı ve
  island'lar ikisi de bunları kullanıyorsa küçük bir runtime chunk'ı
  kalabilir; vendor'ın ESM sürümünü tercih edin.
- Proxy'ler ancak çatı çalıştıktan sonra çalışır. Layout `main.js`'i diğer
  entry'lerden önce basar ve island'lar `main`'den yüklenir, yani sıra
  garantidir. `into` için başka bir entry seçerseniz o entry her sayfada diğer
  entry'lerden önce yüklenmelidir.
- Analiz her build'e (watch turları dahil) iki-üç hızlı esbuild turu ekler.

Adım satırı paylaşılan modül sayısını yazar
(`1 entry, 5 files, 12 shared modules → main.js`). `preload.json` içinde hoist
edilen uygulama modülleri çatının listesine bağlanır; bu yüzden
`<ModulePreload src="client/lib/http.js" />` uyarı vermez.

### `@/` alias'ı

esbuild tarafında `@/` proje köküne çözülür ve uzantı tamamlama yapılır
(`.js`, `.mjs`, `.ts`, `.mts`, `.json`, `/index.js`, `/index.ts`). Node
`alias-hooks.mjs` sunucuda yalnızca `.js` / `.mjs` / `.json` çözer; paylaşılan
`@/lib` dosyaları bu yüzden `.js` kalmalıdır. Client-only `.ts` import'ları
esbuild hattında çalışır.

### `clientEnv` gömülmesi

Tarayıcıda `process` yoktur; sunucuyla paylaşılan modüller yine de `process.env`
okur. `config.clientEnv` ile bildirilen anahtarlar ve `NODE_ENV` build zamanında
tek nesne olarak define edilir, yani listede olmayan bir anahtar okunduğunda
çökme yerine `undefined` döner. İsimleri secret benzeri olan anahtarlar
(`SECRET`, `API_KEY`, …) build'i düşürür; `PUBLIC` / `PUBLISHABLE` içerenler
muaf. Ayrıntı: [07-yapilandirma.md](./07-yapilandirma.md).

### Manifest anahtarları

Yalnızca **gerçek entry'ler** manifest'e girer: dinamik import'lar da
`entryPoint` taşır ve filtrelenmezse her island ayrı bir manifest anahtarı
olurdu. Anahtar dosya adının kendisidir (`main.js`, `chart.js`), değer hash'li
URL.

Bu yüzden controller `entries: ["chart.js"]` yazarken hash'i bilmek zorunda
değildir ([05-islands.md](./05-islands.md)).

### `metafile.json`

esbuild metafile'ı `.jskelet/metafile.json` dosyasına yazılır; dev panelindeki
chunk analizi giriş/çıkış kırılımını buradan okur. Yazma başarısız olursa build
düşmez — analiz verisi en iyi çabadır. **Çalışma zamanı bu dosyaya bağımlı
değildir.**

### `preload.json`

Aynı metafile'dan küçük bir harita da çıkarılır: kaynak modül yolu
(`client/bundles/chrome.js`) → hash'li chunk'ı ve static import kapanışı.
`modulePreload()` / `<ModulePreload />` yalnızca bunu okur, böylece runtime
büyük metafile'ı yüklemez ve grafiği gezmez. Dosya yoksa helper hiçbir şey
basmaz. Chunk URL'leri değişince entry hash'leri de değiştiği için HTML
önbelleğinin isim alanı (`buildId`) kendiliğinden yenilenir.

## Fontlar

`next/font/google` yerine self-host font dosyaları.

Dosyalar `public/fonts/` altında **sabit isimlerle** durur (hash yok), çünkü
`@font-face` içindeki `url()` yolları elle yazılıyor; hash'lemek her build'de
stylesheet'i de değiştirmek zorunda bırakırdı.

Dosya yoksa **bir kez** Google Fonts'tan indirilir ve **commit edilmesi
beklenir**: build'in ağa bağımlı olması CI'da kırılgan. İndirme başarısız olursa
uyarı basılır ve sayfa sistem font yığınına düşer — build durmaz.

Yalnızca latin subset'i (`U+0000-00FF`) indirilir: diğerleri çoğu site için ölü
ağırlık ve `unicode-range` olmadan hepsini indirmek font boyutunu katlar.

Kullanımı stylesheet'te elle yazılır:

```css
@font-face {
  font-family: "Inter";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/inter-400.woff2") format("woff2");
}
```

`.woff2` uzantısı ve `/fonts/` öneki varsayılan `static` kurallarında olduğu için
bu dosyalara otomatik olarak `immutable` cache yazılır.

`build.assets.prefix` açıksa build, CSS'teki `url("/fonts/…")` yollarını CDN
prefix'iyle yeniden yazar ve fontları S3'e de basar — layout'ta ayrı
`@font-face` tutmaya gerek kalmaz.

## İkon sprite

**Yalnızca kaynakta kullanılan** ikonlar için bir `<symbol>` seti üretir. Tüm
seti göndermek 1500+ ikon, yani birkaç megabayt; kullanım taraması sprite'ı
tipik olarak 10-30 sembolde tutuyor. Çıktı hash'li `sprite.svg` olarak
`public/assets/` altına yazılır ve precompress kapsamına girer.

Kaynak **XOR** seçilir — ikisi birleştirilmez:

1. `icons.dir` (varsayılan `icons/`) **dizin olarak varsa** yalnızca oradaki
   düz SVG'ler. Boş dizin Phosphor'a düşmez; fallback için dizini silin.
2. Aksi hâlde `@phosphor-icons/core` (uygulamanın `node_modules`'ünden). Kurulu
   değilse adım sessizce atlanır.

Yerel dosya adları:

| Dosya | Sprite anahtarı |
| --- | --- |
| `icons/house.svg` | `house:regular` |
| `icons/house-regular.svg` | `house:regular` |
| `icons/arrow-right-bold.svg` | `arrow-right:bold` |

- Sembol id'si: `<kebab-ad>-<weight>`, örn. `arrow-right-bold`.
- `viewBox` kaynak SVG'den `<symbol>`'e taşınır; yoksa `0 0 256 256`
  (Phosphor ve `icon()` ile uyum için önerilen kutu).
- Taranan dizinler varsayılan olarak `views`, `client`, `routes`, `lib`,
  `features`, `shared`; `icons.scan` ile değiştirilebilir. Taranan uzantılar:
  `.ejs`, `.jsk`, `.js`, `.mjs`, `.ts`, `.mts`.
- Ağırlıklar: `thin`, `light`, `regular`, `bold`, `fill`, `duotone`. Tanınmayan
  bir ağırlık `regular` sayılır.

### Tarama neyi bulur

| Kaynaktaki biçim | Bulunur mu |
| --- | --- |
| `icon({ name: "ArrowRight", weight: "bold" })` | ✓ ad + ağırlık |
| `icon({ name: cond ? "A" : "B" })` | ✓ her iki sabit ad |
| `data-icon="flag:fill"` ya da `"data-icon": "flag:fill"` | ✓ |
| `icon: "XLogo"` / `iconName: "XLogo"` (yapılandırma listelerinde) | ✓ ad; ağırlıklar dolaylı çağrılardan toplananlar |
| `icon({ name: item.icon })` | ✗ ad statik görünmez |

Son satır için iki güvenlik ağı var: ad taşıyan yapılandırma alanları
(`icon: "XLogo"`) ayrıca aranır, ve development'ta `icon()` sprite'taki
sembolleri okuyup eksik olan için tek seferlik uyarı basar:

```
[icon] missing from sprite: x-logo-regular — write the name as a literal or add
it to the build/tasks/icons.mjs scan.
```

Bu uyarıyı görürseniz ya adı sabit yazın, ya `icons.scan` listesine ilgili
dizini ekleyin, ya da adı bir yapılandırma alanında `icon: "XLogo"` biçiminde
tutun.

Kaynakta bulunamayan adlar build sonunda özet olarak uyarılır:
`N icons missing → …`

## Görsel optimizasyonu

`next/image` optimizer'ının build zamanı karşılığı. `public/` altındaki elle
konmuş png/jpg dosyaları için birkaç genişlikte webp üretir ve
`.jskelet/images.json` manifest'ine yazar. `image()` bu manifest'e bakıp
`srcset` + intrinsic `width`/`height` ekler; çağıran taraf hiçbir şey
değiştirmez ([04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md)).

- Çıktılar hash'li olarak `public/assets/img/` altına düşer, yani `immutable`
  cache ve precompress kapsamına girerler.
- **Kaynak dosyalar olduğu yerde kalır:** manifest'te olmayan bir görsel her
  zaman orijinaliyle servis edilir.
- `assets` ve `fonts` dizinleri her zaman atlanır; ek dizinler `images.skip` ile.
- Genişlikler kaynaktan büyük olanlar elenerek kullanılır ve kaynağın kendi
  genişliği (en fazla 1920) her zaman listeye girer. Retina ekranlarda bile
  1920'nin üstü israf.
- Varyant hash'i **kaynak + genişlikten** türetilir: aynı içerik her build'de
  aynı dosya adını verir, `immutable` cache bayatlamaz.
- Manifest'e kodlayıcı imzası yazılır (`webp-q78-e4`). Kalite ayarı değişince
  imza da değişir ve tüm görseller yeniden kodlanır; aksi hâlde eski ayarla
  üretilmiş çıktılar sessizce kalırdı.
- Kaynak değişmediyse ve çıktılar hâlâ yerindeyse yeniden kodlanmaz. Büyük bir
  `public/` dizininde bu, build süresini dakikalardan saniyelere indirir.
- Bozuk/okunamayan tek bir görsel build'i düşürmez: uyarı basılır ve manifest'te
  yer almadığı için orijinal dosya servis edilmeye devam eder.
- Manifest'te artık geçmeyen eski çıktılar silinir.

Bu adım `sharp` gerektirir. Kurulu değilse adım sessizce atlanır ve `image()`
orijinal dosyaya döner. Watch turunda hiç çalışmaz.

## Runtime uzak görsel proxy

`images.remote.allowHosts` verilirse `createApp` `/_jskelet/image` ucunu
mount eder. CMS / CDN kapakları build'e girmediği için `image()` bu host'lardaki
URL'leri `?url=&w=` biçiminde yeniden yazar; uç sharp ile webp üretir ve
`.jskelet/image-cache/` altına yazar. Dizin 256 MB'yi geçince en eski dosya
düşer. Upstream fetch redirect'leri elle takip
edilir: her hop allowlist + private IP / DNS kontrolünden geçer (açık redirect
SSRF kapalı). Ayrıntı: [07-yapilandirma.md](./07-yapilandirma.md).

## Precompress

Build çıktısı varlıkların brotli (kalite 11) ve gzip (seviye 9) kopyalarını
üretir: `app.<hash>.css.br`, `app.<hash>.css.gz`, …

- Yalnızca `public/assets/` kapsanır: oradaki dosyalar hash'li ve `immutable`,
  yani içerikleri hiç değişmiyor ve her istekte yeniden sıkıştırmak boşa CPU.
  Build'de bir kez kalite 11 ile sıkıştırmak hem sunucu yükünü sıfırlar hem de
  çalışma anında göze alınamayacak bir oran verir (istek anındaki kalite 4'e
  karşı).
- `public/` altındaki elle konmuş dosyalar küçük ve seyrek istendiği için
  çalışma anındaki sıkıştırmaya bırakılır.
- Sıkıştırılan uzantılar: `.css`, `.js`, `.mjs`, `.svg`, `.json`, `.xml`,
  `.txt`, `.map`. Zaten sıkışık formatlar (woff2, png, jpg, webp) atlanır.
- 1 KB altındaki dosyalar atlanır: kazanç başlık maliyetini karşılamıyor.
- Önceki turdan kalan `.br`/`.gz` kopyalar önce silinir, bayatlamasın.
- Watch modunda çalışmaz: her değişiklikte kalite-11 brotli yavaş.

Bu dosyaları `staticPrecompressed` middleware'i servis eder; kopya yoksa istek
`express.static`e devredilir ([02-mimari.md](./02-mimari.md)).

## Opsiyonel peer bağımlılıkları

| Paket | Gerekli olduğu adım | Yoksa ne olur |
| --- | --- | --- |
| `postcss` | CSS | CSS adımı **hata verir** (zorunlu import) |
| `@tailwindcss/postcss` | CSS | CSS adımı **hata verir** |
| `tailwindcss` | CSS (peer) | Tailwind direktifleri çözülemez |
| `lightningcss` | CSS minifikasyonu | Tailwind çıktısı kullanılır, birkaç kB daha büyük |
| `sharp` | Görsel optimizasyonu | Adım atlanır; `image()` orijinali kullanır |
| `@phosphor-icons/core` | İkon sprite (yerel `icons/` yoksa) | Adım atlanır; `icon()` boş `<use>` üretir |

CSS kullanmayacaksanız `paths.styles` dosyasını hiç oluşturmayın: adım uyarıyla
atlanır ve postcss'e ihtiyaç kalmaz.

Paketler **uygulamanın** `node_modules`'ünden çözülür, framework'ün kendisinden
değil. Framework `file:` ya da workspace bağlantısıyla kuruluysa kaynak
dosyaları kendi dizininde çalışır ve düz bir `import "postcss"` framework'ün
ağacına bakar — uygulamanınkine değil. Bu yüzden çözümleme uygulama kökünden
başlatılır.

## `.gitignore` önerisi

```
node_modules/
.jskelet/
public/assets/
.env
```

`public/fonts/` **commit edilmelidir** (build'in ağa bağımlı olmaması için),
`public/assets/` edilmemelidir (her build'de yeniden üretilir).

## `jskelet start` ve eksik build

`jskelet start` önce `.jskelet/manifest.json` dosyasına bakar; yoksa build'i
kendisi çalıştırır. Docker imajında build zaten yapıldığı için bu bir no-op;
amaç `npm start`ı doğrudan çalıştıran birinin stilsiz bir sayfayla
karşılaşmaması.

## Teşhis: sık görülen durumlar

- **Stil hiç yok.** Build çalışmamış (`hasAsset('app.css')` false) ya da
  `paths.styles` dosyası mevcut değil. Build çıktısındaki `CSS` satırını
  kontrol edin.
- **Bazı Tailwind sınıfları çalışmıyor.** `@source` direktifi eksik olan bir
  dizinde yazılmışlar.
- **İkon boş görünüyor.** Sprite'ta o sembol yok; dev'de `[icon] missing from sprite`
  uyarısına bakın. CDN prefix açıkken sprite bilerek site origin'inde kalır
  (`asset("sprite.svg", { origin: "document" })`); origin `public/assets/`
  servis etmiyorsa `<use>` boş kalır.
- **Island'lar hiç açılmıyor.** `main.js` manifest'te yok (entry dizini boş ya
  da build atlanmış) veya bir build hatası var.
- **Dev'de sayfa aniden stilsiz kaldı.** Manifest ile diskteki dosya
  ayrışmıştır; `jskelet dev`i yeniden başlatmak yeterli.

## Sırada ne var

- Watch akışı ve CSS hot-swap: [09-dev-araclari.md](./09-dev-araclari.md)
- Prod build + start ve Docker: [10-dagitim.md](./10-dagitim.md)
- `entries` ve island bundle'ının kullanımı: [05-islands.md](./05-islands.md)
