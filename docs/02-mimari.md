# 02 — Mimari ve kararların gerekçeleri

Bu belge JSkelet'in nasıl çalıştığını değil, **neden böyle çalıştığını**
anlatır. Bir isteğin sunucudan tarayıcıya kadar izlediği yol, island modelinin
neden görünürlüğe bağlı olduğu, HTML'in neden tam üretildiği, önbelleğin neden
süreç belleğinde durduğu ve middleware sırasının neden yer değiştirmemesi
gerektiği burada. Gerekçelerin çoğu kaynak dosyaların başlıklarındaki ölçüm
notlarından geliyor; API'lerin kendisi için [03](./03-routing.md),
[04](./04-render-ve-sablonlar.md), [05](./05-islands.md) ve
[06](./06-cache.md) numaralı belgelere bakın.

## Temel önerme

Bir haber ya da içerik sitesinde ziyaretçinin gördüğü şeyin neredeyse tamamı
sunucuda hazırdır. Etkileşim ise nokta nokta dağılmıştır: bir arama kutusu, bir
drawer, bir grafik, bir yorum formu. Bu profilde tüm sayfayı istemcide yeniden
kurmak (hidrasyon) ödediğiniz en büyük maliyettir ve karşılığında ziyaretçi
hiçbir şey kazanmaz.

JSkelet bu gözlemi mimarinin merkezine alır:

1. **Sunucu HTML'i tamdır.** JS çalışmasa bile sayfa okunur, gezilebilir ve
   indekslenebilir.
2. **JS yalnızca davranış ekler.** Her etkileşimli parça bağımsız bir "island"
   olarak, kendi modülüyle, kendi zamanında bağlanır.
3. **Sayfa üretimi önbelleklenir.** Aynı HTML'i her istekte yeniden üretmenin
   anlamı yok; TTL'li bir bellek önbelleği ISR'nin yerini tutar.

## Bir isteğin yolu

```
İstek
 ├─ rewrites(beforeFiles)          config → proxy ya da req.url değişimi
 ├─ compression                    brotli/gzip pazarlığı (kalite 5)
 ├─ headers                        statik cache + config headers()
 ├─ devGate                        DEV_TOKEN varsa token yoksa 404
 ├─ redirects                      config redirects(), ilk eşleşen kazanır
 ├─ trailingSlash                  config trailingSlash: true ise 308
 ├─ staticPrecompressed            build'de üretilmiş .br/.gz kopyalar (kalite 11)
 ├─ express.static                 public/ altındaki dosyalar
 ├─ (dev) devtools                 yalnızca NODE_ENV=development
 ├─ body parser'lar                urlencoded 64kb + json 256kb
 ├─ rewrites(afterFiles)           statik denendikten sonra
 ├─ route'lar
 │   └─ route(controller)
 │       └─ withHtmlCache          TTL + stale-while-revalidate
 │           └─ withUpstreamTracking
 │               └─ withRequestCache
 │                   └─ controller → renderPage → EJS
 ├─ 404 → hooks.notFound()
 └─ hata yönetimi                  redirect/notFound + 500 fallback
```

## Middleware sırası neden bu sıra

`src/server/create-app.js` dosyasının asıl değeri sıradır; her konumun bir
sebebi var ve yer değiştirmek sessiz bozulmalara yol açıyor.

- **`rewrites(beforeFiles)` statik dosyalardan da önce.** Aksi hâlde
  `/assets/x.js` yolunu başka bir yere taşıyan bir kural hiç işlemez, çünkü
  `express.static` isteği önce yanıtlar.
- **`compression`, static'ten önce.** Sonra gelirse statik dosyalar hiç
  sıkışmaz.
- **`headers` → `devGate` → `redirects` → `trailingSlash`.** Gate'in 404'ü
  redirect'ten önce gelmeli: yayına açılmamış bir ortam, yönlendirme kurallarını
  bile dışarıya sızdırmamalı. `trailingSlash` config redirects'ten sonra durur,
  böylece açık kurallar istenen yolu önce görür; kanonik slash biçimi ikinci
  adımda dayatılır.
- **`staticPrecompressed`, `express.static`ten önce.** Build'de üretilmiş
  `.br`/`.gz` kopyalar varsa onlar servis edilir (brotli kalite 11); yoksa
  istek altındaki `static`e düşer ve middleware anında sıkıştırır (kalite 5).
  Hash'li ve `immutable` bir dosyayı her istekte yeniden sıkıştırmak boşa CPU.
- **Body parser'lar statikten sonra.** Görsel isteklerinde gövde ayrıştırma
  maliyeti ödenmesin.
- **`rewrites(afterFiles)`, statik denendikten sonra ve sayfalardan önce.**
  Next.js'teki iki fazlı rewrite semantiğinin karşılığı.
- **404 ve hata yönetimi en sonda.** Hata yöneticisi `notFound`/`redirect`
  kontrol akışını da yakalar, çünkü bunlar bir controller dışında (ör. bir
  middleware içinde) da fırlatılabilir.

Framework `x-powered-by`'ı kapatır ve yerine markalanabilir bir başlık yazar,
`etag`i `strong` yapar ve `trust proxy`yi açar. `trust proxy` ters proxy
arkasında doğru protokol ve istemci IP'si için gerekli
([10-dagitim.md](./10-dagitim.md)).

## Island modeli: neden görünürlüğe bağlı hidrasyon

`src/client/registry.js` her `[data-island]` elementini bir
`IntersectionObserver`'a verir (`rootMargin: "200px 0px"`). Ekranda olanlar
zaten ilk gözlemde tetiklenir; ekran dışındakiler kaydırılana kadar **hiç
indirilmez**. Ana sayfadaki grafik kütüphanesi gibi ağır modüller böylece ilk
yükten tamamen çıkar.

Üç davranış var, hepsi HTML'den kontrol edilir:

- **Varsayılan:** görünürlüğe bağlı.
- **`data-island-eager`:** görünürlükten bağımsız, hemen bağlanır. Header,
  çerez bandı gibi global davranışlar için.
- **`data-island-idle`:** görünür olsa bile `load` tamamlanıp ana iş parçacığı
  boşalana kadar bekler. İlk ekranda görünen ama kritik olmayan ağır modüller
  (ör. grafik kütüphanesi çeken mini grafik) LCP ile yarışmasın diye.

İki ek ayrıntı ölçümden geldi:

- **Bağlama işi boş zamana kaydırılır** (`requestIdleCallback`, `timeout: 500`).
  Aynı anda görünen çok sayıda island tek bir uzun task'a dönüşürse TBT ve INP
  bozulur.
- **Düzen kutusu olmayan elementler doğrudan bağlanır.** `hidden` bir
  drawer/dialog'un düzen kutusu yoktur ve `IntersectionObserver` onu asla
  bildirmez; bu yüzden `hydrate()` ölçümleri tek seferde okur
  (`getClientRects().length`) ve kutusu olmayanları gözlemciye vermek yerine
  hemen bağlar.

Buradan çıkan bir sonuç: **görsel hata yönetimi island değildir.** Görsel
ağırlıklı bir sayfada 80+ `<img>` olabiliyor ve her birine ayrı island bağlamak
(gözlemci + dinamik import + mount) sırf hata ihtimali için ciddi bir hidrasyon
yükü. `startSafeImages()` bunun yerine belgeye tek bir yakalama fazı
dinleyicisi kurar ([05-islands.md](./05-islands.md)).

## Sunucu HTML'i neden tam

Layout ve sayfa şablonu, ziyaretçinin göreceği içeriğin tamamını üretir.
İstemci tarafında "iskelet göster, sonra doldur" deseni yoktur. Bunun üç
karşılığı var:

1. **SEO:** kazıyıcı JS beklemek zorunda kalmaz.
2. **LCP:** en büyük içerik öğesi ilk HTML yanıtında gelir; JS'in indirilmesi,
   ayrıştırılması ve çalıştırılması LCP yolunda değildir.
3. **CLS:** içerik sonradan enjekte edilmediği için düzen kaymaz.

Aynı ilke `<head>` tarafında da uygulanır. Layout kaynak ipuçlarını
(`preconnect`, LCP `preload`) `<head>`in **en başına** basar; bunları
geciktirmek doğrudan LCP'ye yazılır.

### Neden tek, render-blocking stylesheet

Ayrı bir "critical CSS" üretilmez. Ölçümde inline kritik CSS ilk ekranı tam
kapsamadığı için sheet gelince sayfa yeniden akıyordu (bir liste sayfasında CLS
0.307) ve aynı ~27 KB her HTML yanıtında tekrar ediyordu. Sıkıştırılmış tek
sheet'i render-blocking bırakmak hem daha hızlı hem CLS'siz; ikinci ziyarette
zaten `immutable` önbellekten geliyor.

Aynı mantık ikonlarda da var: her ikon için ayrı istek yerine, build zamanında
yalnızca kaynakta kullanılan sembollerden bir SVG sprite üretilir. Tüm Phosphor
setini göndermek 1500+ ikon, yani birkaç megabayt; tarama sprite'ı tipik olarak
10-30 sembolde tutuyor ([08-build.md](./08-build.md)).

## Cache stratejisi: ISR yerine bellek içi TTL

`src/server/html-cache.js` route + query anahtarlı, TTL'li, LRU bir HTML
önbelleği tutar (en fazla 500 girdi). TTL dolduğunda girdi hemen atılmaz: `stale`
pencerede eski HTML anında döner ve tazeleme arkada çalışır
(stale-while-revalidate, `STALE_FACTOR = 1`, yani stale penceresi TTL kadar).

Kazanç: ilk ısıtmadan sonra hiçbir istek render'ı beklemez. Bedel: HTML'deki
veri en fazla `revalidate + bir tazeleme turu` kadar geride olabilir. Bu bedel
kabul edilebilir, çünkü fiyat gibi canlı alanlar istemcide WebSocket'ten
güncelleniyor ve gecikme ekranda görünmüyor.

Diske yazmama kararı bilinçli. Next'teki build-time prerender'ın karşılığı
prewarm'dır ama çıktı diske yazılmaz: önbellek süreç belleğinde yaşadığı için
ısıtma da süreç ayağa kalkınca yapılır. Kazanç aynı — ilk ziyaretçi soğuk
render'ı beklemez — fakat veri dondurulmaz; her girdi route'un `revalidate`
süresiyle yaşlanır ([06-cache.md](./06-cache.md)).

### Sıkıştırılmış gövdenin önbellekte durması

Önbelleğe alınan her girdi, brotli/gzip çıktısını HTML ile birlikte saklar
(`encoded` haritası, HTML ile aynı ömrü paylaşır). Aynı sayfa her istekte
yeniden brotli'lenmez. `Content-Encoding` bu yolda `route()` içinde ayarlandığı
için sıkıştırma middleware'i devreye girmez.

### Neden geçici ve kalıcı upstream hataları farklı ele alınır

Render sırasında upstream düştüyse çıktı eksik veri içeriyor demektir ve böyle
bir HTML önbelleğe **yazılmaz**: sonraki istek yeniden dener.

Ancak bu yalnızca *geçici* hatalar için geçerli (ağ hatası, 408, 425, 429 ve tüm
5xx). 400/403/404 gibi deterministik cevaplar tekrar denemekle düzelmez; onlar
yüzünden önbelleği kapatmak sayfayı her ziyarette baştan render etmek olur —
içerik yine aynı eksik hâliyle döner, ziyaretçi sadece render süresini öder. Bu
yüzden kalıcı hatalar yalnızca loglanır, önbelleği engellemez.

Bu bilginin framework'e ulaşma yönü de bilinçli olarak terstir: framework veri
katmanını tanımaz, veri katmanı framework'e haber verir
(`reportUpstreamFailure()`). Hiç çağıran olmazsa maliyet boş bir dizidir.

### Üç kapsamın iç içe sırası

`route()` şu sırayı kurar:

```
withHtmlCache( withUpstreamTracking( withRequestCache( controller ) ) )
```

Sıra önemli: **istek içi cache en içte** olmalı ki aynı render'daki iki çağrı
tek upstream isteğine düşsün; **upstream takibi HTML cache'in içinde** olmalı ki
eksik veriyle üretilen çıktı önbelleğe yazılmasın.

## Hata toleransı: hiçbir eksik siteyi indirmez

Framework boyunca tekrarlanan bir ilke var: eksik yapılandırma ya da eksik build
çıktısı, hata yerine bozulmuş ama çalışan bir sayfa üretir.

- **Config dosyası yoksa ya da okunamıyorsa** uyarı basılır ve sunucu
  varsayılanlarla ayağa kalkar. Bozuk bir düzenleme siteyi açılamaz hâle
  getirmemeli. Aynı şekilde `headers()`/`redirects()`/`rewrites()`/`cache()`
  bölümlerinden biri hata verirse yalnızca o bölüm yok sayılır.
- **Hook'lar hata verirse** framework kendi varsayılanına döner ve uyarır.
- **Build çalışmadıysa** `asset()` `/assets/<isim>` döner, `hasAsset()` false
  olur ve layout stylesheet/script etiketlerini hiç basmaz. `jskelet build`
  unutulduğunda hata yerine stilsiz ama çalışan bir sayfa görürsünüz.
- **Dev'de bozuk bir route modülü** uyarı basıp atlanır; **üretimde fırlatır.**
  Yarım route tablosuyla yayına çıkmak, sessizce 404 dönen sayfalar demek.
- **404 render'ı da patlarsa** şablonsuz, minimal bir HTML döner; ziyaretçi boş
  yanıt görmesin.
- **Tek bir istek hatası süreci düşürmez:** `unhandledRejection` ve
  `uncaughtException` loglanır ve süreç ayakta kalır. Bir haber sitesinde tek
  sayfanın hatası tüm siteyi indirmemeli.

## Neden dosya sistemi tabanlı routing yok

Sıra önemli. `/:slug` gibi tek segmentli bir yakalayıcı `/about` rotasından önce
kaydedilirse "about" bir slug sanılır. Sırayı dosya adına gizlemek yerine
görünür kılmak teşhisi kolaylaştırıyor: ya `jskelet.config.mjs` → `routes` ile
açık bir liste verirsiniz, ya da `routes/` dizinini alfabetik taratıp dosya
adlarına sayısal önek koyarsınız (`10-pages.js`, `50-blog.js`,
`99-catch-all.js`). Ayrıntı: [03-routing.md](./03-routing.md).

## Neden tek bir config gerçek kaynağı

`src/config/index.js` proje kökünü, dizin yollarını, markalamayı, hook'ları ve
kuralları normalize eder. Diğer modüller yol hesaplamaz, `getConfig()` çağırır.
Sebebi somut: framework `node_modules/` içine girdiğinde `../..` sayarak kök
bulmaya çalışan her dosya bozulur. Aynı gerekçeyle build tarafında da tek bir
mutasyon noktası var (`initBuildPaths()`).

`getConfig()` `loadConfig()` çağrılmadan kullanılırsa boş bir proje kökü
varsaymak yerine hata verir: sessiz yanlış yol, "stylesheet neden yok" gibi
teşhisi zor sorunlara dönüşüyor.

## Neden bu bağımlılık listesi

Çalışma zamanı bağımlılıkları dörttür: `express`, `ejs`, `esbuild`,
`tailwind-merge`. Geri kalan her şey (Tailwind, PostCSS, lightningcss, sharp,
Phosphor ikonları) **opsiyonel peer bağımlılığıdır** ve yoksa ilgili build adımı
atlanır.

İki karar ayrıca açıklanmayı hak ediyor:

- **`compression` paketi yerine `node:zlib`.** Paket brotli desteklemiyor ve
  yedi geçişli bir bağımlılık ağacı getiriyor; brotli + gzip pazarlığını elle
  yapmak yeterli. Brotli tercih edilir: ana sayfa HTML'inde gzip'e göre ~%35
  daha küçük.
- **`tailwind-merge` çalışma zamanında kalır.** Sınıf hesabı yalnızca sunucuda
  yapılır, client bundle'a hiç girmez, dolayısıyla sayfa ağırlığına etkisi
  yoktur. Elle yazılmış bir grup tablosu ise `border-2` + `border-transparent`
  gibi genişlik/renk çiftlerini birbirine karıştırıp sınıf düşürdüğü için
  görsel regresyon üretiyordu.

Opsiyonel paketler **uygulamanın** `node_modules`'ünden çözülür, framework'ün
kendisinden değil. Framework `file:` ya da workspace bağlantısıyla kuruluysa düz
bir `import "postcss"` framework'ün ağacına bakar — uygulamanınkine değil.

## Neden alias ve uzantı hook'ları

`node --import jskelet/register` iki iş yapar:

1. `jsconfig.json` / `tsconfig.json` içindeki `compilerOptions.paths`
   alias'larını çözer (`@/lib/x` → `<root>/lib/x`). Editör ve çalışma zamanı aynı
   dosyadan beslendiği için ikisi birbirinden ayrışmaz.
2. Uzantısız göreli import'lara uzantı ekler (`./cache` → `./cache.js`). Node ESM
   bunu yapmaz ve bundler'dan taşınan kodda en sık karşılaşılan kırılma noktası
   budur.

esbuild tarafındaki `@/` çözümü de aynı davranışı taklit eder, böylece `lib/`
altındaki modüller hem sunucuda hem tarayıcıda aynı import stilini kullanabilir.

`--import` bir modül **belirteci** bekler, dosya yolu değil. Windows'ta `H:\...`
mutlak yolu `h:` şemalı bir URL sanılıp reddediliyor; bu yüzden framework her
yerde `pathToFileURL(...).href` kullanır. Aynı sebeple config, route modülleri
ve bileşenler de `file://` URL'le import edilir.

## Sırada ne var

- Route ve controller sözleşmesi: [03-routing.md](./03-routing.md)
- Şablon katmanı ve metadata: [04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md)
- Island runtime API'si: [05-islands.md](./05-islands.md)
- Önbelleğin ayarları ve prewarm: [06-cache.md](./06-cache.md)
- Dev akışının iç işleyişi: [09-dev-araclari.md](./09-dev-araclari.md)
