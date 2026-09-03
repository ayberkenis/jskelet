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
```

Şablon derlemesi asset taramasından **önce** biter; istek yolunda parse yoktur.
Tailwind `@source` ve ikon taraması kaynak `.jsk` dosyalarını okur (üretilmiş
`.mjs` değil).

Sıra rastgele değil:

- **CSS ikon sprite'ından sonra gelir.** Sprite bir varlıktır ve sınıf üretmez,
  ama manifest anahtarı verir.
- **Precompress en sonda:** sıkıştırılacak her şey üretilmiş olmalı.
- **Görseller watch turunda hiç çalışmaz:** `sharp` ile yeniden kodlama pahalı.

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
<link rel="stylesheet" href="<%= asset('app.css') %>">
<% } %>
```

- `asset(name)` manifest'te varsa hash'li URL'i, yoksa `/assets/<name>` döner.
- `hasAsset(name)` manifest'te olup olmadığını söyler.

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
yamalar; diğer anahtarlar korunur.

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
- Çıktı tek bir dosyadır ve layout onu render-blocking olarak yükler. Ayrı bir
  "critical CSS" üretilmemesinin ölçüm gerekçesi
  [02-mimari.md](./02-mimari.md)'de.

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

`client/entries/*.js` içindeki her `.js` dosyası bir entry'dir. Dizin yoksa ya da
boşsa adım atlanır.

esbuild ayarları:

| Ayar | Değer | Sebebi |
| --- | --- | --- |
| `bundle`, `splitting` | `true` | Ortak modüller paylaşılan chunk'a çıkar |
| `format` | `esm` | `type="module"` script'ler |
| `target` | `chrome111`, `edge111`, `firefox111`, `safari16.4` | ESM + dinamik import + `IntersectionObserver` island modelinin alt sınırı; daha eskisine transpile etmek çıktıyı büyütüp hiçbir ziyaretçi kazandırmıyor |
| `minify` | `true` | — |
| `sourcemap` | `true` | Tarayıcıda teşhis |
| `entryNames` | `[name].[hash]` | `immutable` cache |
| `chunkNames` | `chunks/[name].[hash]` | — |
| `legalComments` | `none` | — |

Çıktı `public/assets/js/` altına düşer ve her turda önce temizlenir.
`browserslist` okunmaz; hedef listesi kod içinde sabittir.

### `@/` alias'ı

esbuild tarafında `@/` proje köküne çözülür ve uzantı tamamlama yapılır
(`.js`, `.mjs`, `.json`, `/index.js`). Node tarafındaki `alias-hooks.mjs` ile
aynı davranış, böylece `lib/` altındaki modüller hem sunucuda hem tarayıcıda
aynı import stilini kullanabilir.

### `clientEnv` gömülmesi

Tarayıcıda `process` yoktur; sunucuyla paylaşılan modüller yine de `process.env`
okur. `config.clientEnv` ile bildirilen anahtarlar ve `NODE_ENV` build zamanında
tek nesne olarak define edilir, yani listede olmayan bir anahtar okunduğunda
çökme yerine `undefined` döner. Ayrıntı: [07-yapilandirma.md](./07-yapilandirma.md).

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

## İkon sprite

`@phosphor-icons/core` içindeki tek tek SVG'lerden, **yalnızca kaynakta
kullanılan** ikonlar için `<symbol>` seti üretir. Tüm seti göndermek 1500+ ikon,
yani birkaç megabayt; kullanım taraması sprite'ı tipik olarak 10-30 sembolde
tutuyor.

- Sembol id'si: `<kebab-ad>-<weight>`, örn. `arrow-right-bold`.
- Paket **uygulamanın** `node_modules`'ünden çözülür (ikon seti uygulamanın
  devDependency'si); kurulu değilse adım sessizce atlanır.
- Taranan dizinler varsayılan olarak `views`, `client`, `routes`, `lib`;
  `icons.scan` ile değiştirilebilir. Taranan uzantılar: `.ejs`, `.js`, `.mjs`.
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

Phosphor'da bulunamayan adlar build sonunda özet olarak uyarılır:
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
`.jskelet/image-cache/` altına yazar. Ayrıntı: [07-yapilandirma.md](./07-yapilandirma.md).

## Precompress

Build çıktısı varlıkların brotli (kalite 11) ve gzip (seviye 9) kopyalarını
üretir: `app.<hash>.css.br`, `app.<hash>.css.gz`, …

- Yalnızca `public/assets/` kapsanır: oradaki dosyalar hash'li ve `immutable`,
  yani içerikleri hiç değişmiyor ve her istekte yeniden sıkıştırmak boşa CPU.
  Build'de bir kez kalite 11 ile sıkıştırmak hem sunucu yükünü sıfırlar hem de
  çalışma anında göze alınamayacak bir oran verir (istek anındaki kalite 5'e
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
| `@phosphor-icons/core` | İkon sprite | Adım atlanır; `icon()` boş `<use>` üretir |

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
  uyarısına bakın.
- **Island'lar hiç açılmıyor.** `main.js` manifest'te yok (entry dizini boş ya
  da build atlanmış) veya bir build hatası var.
- **Dev'de sayfa aniden stilsiz kaldı.** Manifest ile diskteki dosya
  ayrışmıştır; `jskelet dev`i yeniden başlatmak yeterli.

## Sırada ne var

- Watch akışı ve CSS hot-swap: [09-dev-araclari.md](./09-dev-araclari.md)
- Prod build + start ve Docker: [10-dagitim.md](./10-dagitim.md)
- `entries` ve island bundle'ının kullanımı: [05-islands.md](./05-islands.md)
