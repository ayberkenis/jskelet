# 06 — Önbellek ve prewarm

Bu belge JSkelet'in ISR ikamesini bütün ayrıntılarıyla anlatır: HTML TTL
önbelleği ve stale-while-revalidate davranışı, `revalidate`'in nereden geldiği,
cache anahtarının nasıl kurulduğu, `X-JSkelet-Cache` başlığının değerleri,
sıkıştırılmış gövdenin neden önbellekte durduğu, istek içi memoizasyon
(`withRequestCache` / `cache()`), veri önbelleği (`withDataCache`), upstream
hatalarının önbelleği nasıl etkilediği (otomatik izleme ve
`reportUpstreamFailure`) ve sunucu açılışındaki ısıtma turu.
Kararların arkasındaki ölçüm gerekçeleri [02-mimari.md](./02-mimari.md)'de,
config alanlarının tam referansı [07-yapilandirma.md](./07-yapilandirma.md)'de.

## Genel resim

```
route(controller, { revalidate })
 └─ withHtmlCache(key, ttl, producer)          ← TTL + stale-while-revalidate
     └─ withUpstreamTracking(...)              ← eksik veri tespiti
         └─ withRequestCache(...)              ← istek içi memoizasyon
             └─ produce() → controller + renderPage
                              └─ withDataCache(...)  ← upstream veri önbelleği
```

Sıra önemli: **istek içi cache en içte** olmalı ki aynı render'daki iki çağrı
tek upstream isteğine düşsün; **upstream takibi HTML cache'in içinde** olmalı ki
eksik veriyle üretilen çıktı önbelleğe yazılmasın.

İki önbelleğin iş bölümü:

| | HTML önbelleği | Veri önbelleği |
| --- | --- | --- |
| Ne tutar | Sayfanın tamamı (+ sıkıştırılmış gövdesi) | Upstream'den gelen JSON |
| Girdi boyutu | ~100-200 kB | ~1-20 kB |
| Girdi sınırı | 500 (`cache().maxEntries`) | 10.000 (`cache().data.maxEntries`) |
| Kime yarar | Trafiği olan sayfalar: render bile edilmez | Uzun kuyruk: render edilir ama API'ye gidilmez |

Bu ayrım pratikte şuna karşılık gelir: on binlerce yollu bir sitede sayfaların
tamamını HTML olarak sıcak tutmak mümkün değil — 500 girdiyi aşan ısıtma kendi
ısıttığını siler. Uzun kuyruk için hedef "HTML hazır olsun" değil, **"sayfayı
üretecek veri API'ye gitmeden bulunsun"** olmalı. O zaman hiç ısıtılmamış bir
sayfa da ilk ziyaretçide milisaniyeler içinde üretilir ve kota harcamaz.

## Public ve kişiye özel ayrımı

Bu belgedeki her şey **herkese aynı gidebilen** HTML için geçerli. Cache
anahtarında kimlik yok (yalnızca yol + query), yani önbellekteki bir sayfa onu
ilk isteyen kişinin değil, o yolun cevabıdır.

Kullanıcıya bağlı bir sayfa bu yüzden ayrı bir yoldan geçer:

```js
app.get("/panel", route(async ({ req }) => { … }, { private: true }));
```

`private: true` üç şeyi birden yapar: önbellek devre dışı kalır, config'in
`cache.html` deseni bu kararı **ezemez** ve yanıt `private, no-store`,
`Vary: Cookie` ile, ETag'siz gider. Ayrıntılar ve oturum/CSRF tarafı
[12-panel-ve-oturum.md](./12-panel-ve-oturum.md)'de.

Bayrağı unutursanız framework sessiz kalmaz: controller `Cookie`,
`Authorization` ya da `req.session`/`req.user` okuduğu anda render işaretlenir
ve önbelleğe **yazılmaz**. Dev'de istek bir hatayla düşer, üretimde `no-store`
ile servis edilip loglanır. Koruma bir mazeret değil son savunma — doğru yer
`private: true`.

## `revalidate` — TTL nereden gelir

Bir route'un TTL'i iki kaynaktan gelebilir ve **config kazanır**:

1. `route(controller, { revalidate: 60 })` — route'un kendi süresi.
2. `jskelet.config.mjs` → `cache().html` içindeki eşleşen desen. Varsa
   route'unkini ezer.

Tek istisna `private: true`: desen eşleşse bile yok sayılır. Kilit tek yönlü,
çünkü ters yönde bir hata sessiz veri sızıntısı anlamına geliyor.

```js
// jskelet.config.mjs
export default {
  async cache() {
    return {
      html: {
        "/": 60,
        "/haber/:slug": 300,
        "/etiket/:slug": 120,
      },
    };
  },
};
```

Config ile ezme, tek bir dosyadan tüm sitenin tazelik profilini ayarlamayı
mümkün kılar; route dosyalarını dolaşmak gerekmez.

Çözüm sonucu **yol başına hatırlanır**, böylece her istekte desen taraması
yapılmaz. Hiç `cache().html` kuralı yoksa doğrudan route'un değeri kullanılır.

`revalidate` verilmemişse ya da 0 ise sayfa **hiç önbelleklenmez**: her istek
render edilir ve yanıt `Cache-Control: private, no-store` ile, ETag'siz gider.
`X-JSkelet-Cache` başlığı da yazılmaz — önbellek yolu hiç çalışmadı, `MISS`
demek yanıltıcı olurdu.

Dinamik bir sayfaya `no-store` yazılması bilinçli. Hiç direktif taşımayan bir
yanıtı HTTP "sezgisel olarak önbelleklenebilir" sayıyor; araya giren bir proxy
ya da tarayıcının geri tuşu, tek bir ziyaretçi için üretilmiş HTML'i
saklayabiliyordu.

Önbellek ayrıca yalnızca `GET` istekleri için devreye girer.

## Cache anahtarı

```
`${req.path}?${new URLSearchParams(query).toString()}`
```

Yani yol **ve tüm query parametreleri** anahtarın parçasıdır. `/liste?sayfa=2`
ile `/liste?sayfa=3` ayrı girdilerdir.

Bunun pratik sonucu: query string'e bağlı olmayan bir sayfa, farklı kampanya
parametreleriyle (`?utm_source=…`) çağrıldığında her kombinasyon için ayrı bir
girdi üretir. Bu tür parametreleri ters proxy katmanında temizlemek ya da
önbelleği kapatmak (`revalidate` vermemek) makul bir önlemdir; store varsayılan
olarak en fazla 500 girdi tutar ve LRU ile en eskiyi düşürür.

## Stale-while-revalidate

Girdi yapısı:

```
expiresAt  = now + ttl
staleUntil = now + ttl * 2      (STALE_FACTOR = 1)
```

Okuma davranışı:

| Durum | Yanıt | Arka plan |
| --- | --- | --- |
| `now < expiresAt` | Önbellekteki HTML, `HIT` | — |
| `expiresAt ≤ now < staleUntil` | Önbellekteki HTML **anında**, `STALE` | Tazeleme başlatılır |
| `now ≥ staleUntil` | Girdi silinir, taze render, `MISS` | — |

Stale penceresinde tazelemenin hatası isteği etkilemez: eski HTML pencere
boyunca geçerli kalır ve hata yalnızca loglanır
(`[html-cache] background refresh failed: …`).

Aynı anahtar için eşzamanlı tazelemeler tek bir çalışmada birleştirilir
(`inflight` haritası): yüz eşzamanlı istek tek render'a düşer.

Kazanç: ilk ısıtmadan sonra hiçbir istek render'ı beklemez. Bedel: HTML'deki
veri en fazla `revalidate + bir tazeleme turu` kadar geride olabilir. Bu bedel
kabul edilebilir, çünkü fiyat gibi canlı alanlar istemcide WebSocket'ten
güncelleniyor.

Store LRU'dur: erişilen girdi sona taşınır, sınır (`cache().maxEntries`,
varsayılan 500) aşılınca en eski düşürülür.

## Ne önbelleğe yazılır

Yalnızca şu iki koşulun **ikisini** birlikte sağlayan çıktı saklanır:

1. `status === 200`
2. `degraded !== true` — render sırasında geçici bir upstream hatası
   bildirilmemiş.

Yani 404 sayfaları, redirect'ler ve eksik veriyle üretilmiş HTML önbelleğe
girmez.

## Yanıt başlıkları

`route()` her yanıta `X-JSkelet-Cache` yazar (başlık adı `brand.cacheHeader`
ile değiştirilebilir):

| Değer | Anlamı |
| --- | --- |
| `HIT` | Önbellekten, taze |
| `STALE` | Önbellekten, süresi geçmiş; arkada tazeleniyor |
| `MISS` | Bu istekte render edildi (ya da önbellek kapalı) |

Önbelleklenebilir yanıtlarda ayrıca:

```
Cache-Control: public, max-age=0, s-maxage=<revalidate>, stale-while-revalidate=60
```

`max-age=0` tarayıcıda saklamayı kapatır, `s-maxage` ara katmanlara (CDN, ters
proxy) süreyi bildirir. Böylece CDN önünde durduğunda aynı tazelik modeli iki
katmanda birlikte çalışır.

## Sıkıştırılmış gövdenin saklanması

Önbelleğe alınan her girdi bir `encoded` haritası taşır ve HTML ile aynı ömrü
paylaşır. Bir sayfa ilk kez brotli ya da gzip ile istendiğinde çıktı hesaplanıp
haritaya konur; sonraki isteklerde aynı buffer gönderilir. Aynı sayfa her
istekte yeniden brotli'lenmez.

Bu yolda `Content-Encoding`, `Vary` ve `Content-Length` doğrudan `route()`
tarafından yazılır; sıkıştırma middleware'i `Content-Encoding` gördüğü için
devreye girmez.

`HEAD` istekleri sıkıştırılmaz (gövde yok). İstemci ne brotli ne gzip kabul
ediyorsa düz HTML gönderilir.

## İstek içi memoizasyon: `cache()`

React'in `cache()` fonksiyonunun karşılığı: aynı istek içinde aynı argümanlarla
yapılan çağrılar tek kez çalışır.

```js
// lib/api/articles.js
import { cache } from "jskelet";

export const getArticle = cache(async (slug) => {
  const response = await fetch(`${process.env.API_ORIGIN}/articles/${slug}`);
  return response.json();
});
```

Artık aynı render'da hem controller hem `hooks.layoutContext()` aynı yazıyı
isterse tek upstream isteği yapılır.

Ayrıntılar:

- Bağlam `AsyncLocalStorage` ile taşınır ve `route()` içinde
  `withRequestCache()` tarafından kurulur.
- **Bağlam yoksa memoizasyon devre dışı kalır** ve fonksiyon doğrudan çağrılır.
  Bir script'ten ya da başka bir sürecin içinden çağırmak güvenlidir.
- Anahtar `JSON.stringify(args)`; argümansız çağrılar `""` anahtarını
  paylaşır. Serileştirilemeyen argümanlar (fonksiyon, `Symbol`, döngüsel nesne)
  ile kullanmayın.
- Saklanan şey fonksiyonun **dönüş değeridir**, yani `async` fonksiyonlarda
  Promise'in kendisi. Aynı Promise paylaşıldığı için eşzamanlı çağrılar da
  birleşir.
- `withRequestCache(run)` dışa açıktır; `route()` dışında (ör. kendi yazdığınız
  bir Express handler'ında) aynı kapsamı kurmak için kullanılabilir.

## İstekler arası veri önbelleği: `withDataCache`

`cache()` yalnızca **tek bir istek** boyunca yaşar. Uzun kuyruğu API kotasından
korumak için gereken şey istekler arasında yaşayan, TTL'li ve kendi kendini
tazeleyen bir veri katmanı:

```js
// lib/api/articles.js
import { withDataCache, reportUpstreamFailure } from "jskelet";

export async function getArticle(slug) {
  return withDataCache(`haber:${slug}`, 600, async () => {
    const response = await fetch(`${process.env.API_ORIGIN}/articles/${slug}`);

    if (!response.ok) {
      reportUpstreamFailure({ status: response.status, path: `/articles/${slug}` });
      return null;
    }

    return response.json();
  });
}
```

Aynı kalıbın sarmalayıcı biçimi — anahtar argümanlardan üretilir:

```js
import { dataCache } from "jskelet";

export const getArticle = dataCache(
  async (slug) => apiGet(`/articles/${slug}`),
  { key: "haber", revalidate: 600 },
);
```

Davranış:

| Durum | Sonuç |
| --- | --- |
| Taze girdi | Anında döner, `producer` çalışmaz |
| TTL geçmiş, bayat pencere sürüyor | Bayat değer **anında** döner, tazeleme arkada yürür |
| Girdi yok | `producer` beklenir |
| `producer` hata verdi, bayat girdi var | Bayat değer döner, uyarı: `[data-cache] producer failed, serving stale value: …` |
| `producer` hata verdi, girdi yok | Hata çağırana gider |

Ayrıntılar:

- **Aynı anahtarı eşzamanlı isteyen çağrılar tek upstream isteğine düşer.**
  Isıtma turlarında kotayı en çok kurtaran davranış bu: 50 sayfa aynı endeks
  verisini istiyorsa API bir kez çağrılır.
- **`null` ve `undefined` saklanmaz.** Uygulamaların HTTP istemcisi hatada
  genellikle `null` döner; bunu saklamak geçici bir 429'u TTL boyunca "veri yok"
  hâline dondurmak olurdu. Boş cevabı bilinçli olarak saklamak isteyen
  `{ storeEmpty: true }` verir.
- **Bayat pencere HTML'dekinden uzun**: `staleFactor` varsayılanı 10, yani girdi
  TTL'inin 11 katı boyunca acil durum yedeği olarak kalır. Bayat veri, eksik
  sayfadan iyidir. Anahtar başına `{ staleFactor: 0 }` ile kapatılabilir.
- Anahtar tamamen uygulamanın: dil, sürüm, sayfa numarası gibi ayrımlar anahtara
  yazılır (`haber:tr:v2:${slug}`).
- TTL `0` verildiğinde önbellek devre dışı kalır ve `producer` her çağrıda
  çalışır — bir ayarı geçici olarak kapatmak için yeterli.

Yönetim yüzeyi:

| Fonksiyon | Ne yapar |
| --- | --- |
| `withDataCache(key, ttlSeconds, producer, options?)` | Ana giriş noktası |
| `dataCache(fn, { key, revalidate, … })` | Fonksiyon sarmalayıcısı |
| `clearDataCache(prefix?)` | Önek eşleşen girdileri (ya da tümünü) düşürür, silinen sayısını döner |
| `getDataCacheSize()` | Girdi sayısı |
| `getDataCacheEntries()` | Döküm: `{ key, stale, expiresIn }`. Değerin kendisi dönmez. |

`clearDataCache("haber:")`, "bu içerik güncellendi" webhook'unun karşılığıdır:
tek bir bölümün verisini düşürür ve **o veriyi okumuş HTML sayfalarını da**
bayatlatır, yani güncelleme TTL beklenmeden görünür. Ayrıntısı aşağıda,
"Otomatik bağımlılık" bölümünde.

## Degraded render: `reportUpstreamFailure`

Render sırasında upstream düştüyse çıktı eksik veri içeriyor demektir. Böyle bir
HTML'i tüm TTL boyunca servis etmek yerine önbelleğe **hiç yazmamak** doğru
davranış: sonraki istek yeniden dener.

Bu bilgi iki yoldan gelir.

### Otomatik izleme (varsayılan)

`createApp()` açılışta `globalThis.fetch`i sarar ve render sırasında yapılan
çağrılardaki **geçici** hataları (`429`, `5xx`, ağ hatası) kendiliğinden
bildirir. Uygulama tarafında hiçbir satır gerekmez; `fetch` ile konuşan bir API
istemcisi varsa rate limit koruması hazırdır.

Ayrıntılar:

- Yalnızca bir render bağlamı içindeki çağrılar sayılır. Script'ten, cron'dan
  ya da istek dışı bir yerden yapılan `fetch` dokunulmaz kalır.
- Kendi sunucumuza yapılan istekler (`localhost`, `127.0.0.1`) atlanır: ısıtma
  turu ve sağlık kontrolü upstream değildir.
- `404`/`403` gibi deterministik cevaplar **otomatik olarak bildirilmez**. Çoğu
  API'de `404` "böyle bir kayıt yok" demektir; onu eksik veri saymak her yok
  sayfasında yanlış uyarı üretirdi.
- Kapatmak için `cache().trackUpstream: false`. `fetch`i kendisi saran bir
  uygulama (ölçüm, retry, circuit breaker) bunu tercih edebilir.

### Elle bildirim

`fetch` kullanmayan bir istemci (veritabanı sürücüsü, gRPC, satıcı SDK'sı) ya da
kalıcı hataları da işaretlemek isteyen bir katman için sözleşme aynı kaldı.
Bağımlılık yönü bilinçli olarak tersine çevrilmiştir: framework veri katmanını
tanımaz, veri katmanı framework'e haber verir. Hiç çağıran olmazsa maliyet boş
bir dizidir. Aynı hata her iki yoldan bildirilirse tekilleştirilir.

```js
// lib/api/client.js
import { reportUpstreamFailure } from "jskelet";

export async function apiGet(path) {
  try {
    const response = await fetch(`${process.env.API_ORIGIN}${path}`);

    if (!response.ok) {
      reportUpstreamFailure({ status: response.status, path });
      return null;
    }

    return response.json();
  } catch (error) {
    // Yanıt hiç gelmedi: status 0 ağ hatası anlamına gelir.
    reportUpstreamFailure({ status: 0, path });
    return null;
  }
}
```

### Geçici ve kalıcı hata ayrımı

| Durum | Sayılır | Sonuç |
| --- | --- | --- |
| `0` (ağ hatası), `408`, `425`, `429`, `>= 500` | **Geçici** | Sayfa önbelleğe yazılmaz, uyarı: `[render] <path> was produced with missing data, not caching it (…)` |
| Diğerleri (`400`, `403`, `404`, …) | **Kalıcı** | Yalnızca uyarı: `[render] <path> was produced with missing data, upstream is failing permanently (…)`. Önbellek engellenmez. |

Kalıcı hataların önbelleği engellememesi bilinçli: deterministik cevaplar tekrar
denemekle düzelmez. Onlar yüzünden önbelleği kapatmak sayfayı her ziyarette
baştan render etmek olur — içerik yine aynı eksik hâliyle döner, ziyaretçi
sadece render süresini öder.

Eksik veriyle üretilen çıktı **paylaşılan önbelleklere de sunulmaz**: `degraded`
bir yanıt `public, s-maxage=…` değil `private, no-store` alır. Süreç içi
önbelleğe yazmama kararını CDN'de geri almak, aynı hatayı bir katman yukarıda
tekrarlamak olurdu. Teşhis başlığı (`X-JSkelet-Cache: MISS`) yine yazılır.

### `notFound()` geçici hataya denk gelirse

Veri gelmediği için `notFound()` çağıran bir controller, upstream rate limit'e
girdiğinde tüm siteyi 404'e çevirebilir — ve bu 404'ler önbelleğe girdiği için
geçici bir kota sorunu TTL boyunca "bu sayfa yok" cevabına dönüşür. Arama motoru
için bu kalıcı bir kayıp.

Framework bu durumu ayırır: render sırasında **geçici** bir upstream hatası
varsa `notFound()` 404 olarak servis edilmez. Sırayla:

1. Sayfa kısa bir beklemeden sonra **yeniden denenir** (varsayılan bir kez,
   300 ms sonra). Deneme kendi upstream ve istek içi cache bağlamında koşar;
   ilk turun hatası da memoize edilmiş boş cevabı da ikinci turu etkilemez.
2. İkinci tur sayfayı üretebilirse ziyaretçi **gerçek içeriği** görür ve çıktı
   normal şekilde önbelleğe girer. Isıtma günlükleri bunun sık olduğunu
   gösteriyor: aynı yol saniyeler sonra 200 dönüyor.
3. Denemeler tükendiyse yanıt `503` olur — önbelleğe girmez, `Retry-After`
   taşır, sonraki istek yine gerçek içeriği üretebilir.

| Render sırasında | `notFound()` sonucu |
| --- | --- |
| Geçici hata var (`429`, `5xx`, ağ hatası) | Tekrar dene → başarılıysa sayfa; hâlâ olmuyorsa `503`, `Retry-After: 30`, `no-store` |
| Tekrar denemede upstream sağlam cevap verip "yok" dedi | Normal `404` |
| Kalıcı hata var (`404`, `403`…) ya da hata yok | Normal `404`, tekrar denenmez |

Log satırları:

```
[render] /haber/x returned notFound() while upstream is failing (429 /api/...), retrying (1/1)
[render] /haber/x could not be produced, upstream is still failing (429 /api/...), serving an uncached 503 instead of a 404
```

Yani **var olan bir sayfa hiçbir koşulda 404'e dönüşmez**: ya gerçek içerik
gelir, ya önbelleğe girmeyen bir 503. Hiçbir şey "yok" olarak dondurulmaz.

Tekrar denemenin maliyeti upstream'e binen ikinci bir istek turudur; bu yüzden
varsayılan tek deneme. Ayar `cache().transientRetry`:

```js
cache: {
  transientRetry: { attempts: 2, delayMs: 500 },
}
```

`transientRetry: false` (ya da `attempts: 0`) tekrarı kapatır ve doğrudan 503'e
düşer.

## Önbelleği yönetmek

`jskelet` şu fonksiyonları dışa açar:

| Fonksiyon | Ne yapar |
| --- | --- |
| `withHtmlCache(key, ttlSeconds, producer)` | Önbelleği doğrudan kullanmak için. `ttlSeconds` 0 ise producer her zaman çalışır. |
| `invalidateHtmlCache(target, options?)` | Eşleşen sayfaları bayatlatır (ya da `{ hard: true }` ile düşürür), etkilenen sayı döner. |
| `clearHtmlCache()` | Store'u tamamen boşaltır. |
| `getHtmlCacheSize()` | Girdi sayısı. |
| `getHtmlCacheEntries()` | Döküm: `{ key, bytes, status, stale, expiresIn, encodings, deps }`. HTML gövdesi dönmez, yalnızca boyutu. |

### Hedefli invalidation

TTL'i beklemekle tüm önbelleği boşaltmak arasındaki boşluğu `invalidateHtmlCache()`
doldurur:

```js
import { invalidateHtmlCache } from "jskelet";

invalidateHtmlCache("/haber/abc");            // o yol ve altı
invalidateHtmlCache("/haber/:slug");          // desen sözdizimi
invalidateHtmlCache([/-yorumlar$/, "/"]);     // RegExp ve liste
```

Varsayılan davranış **bayatlatmaktır**, silmek değil: girdi süresi geçmiş
sayılır ve normal stale-while-revalidate yoluna düşer. Bir webhook beş yüz
sayfayı birden düşürdüğünde sert silme, tam da içeriğin güncellendiği anda beş
yüz soğuk render başlatır ve upstream'i döver. Bayatlatmada ziyaretçi eski
HTML'i beklemeden alır, tazeleme arkada ve anahtar başına tek seferde koşar.
Eski HTML'in gerçekten geçersiz olduğu durumlar için `{ hard: true }`.

Anahtar `yol?query` olduğundan eşleştirme **yol kısmına** yapılır: bir yolun
bütün query varyantları (`?utm_source=…` dahil) tek çağrıyla düşer. Düz
string'te önek segment sınırında kesilir — `/haber` kuralı `/haberler`i
etkilemez.

Uçuşta olan bir render de hedeflenir: purge'den önce başlamış bir tur, sonucu
artık eski veriyi taşıdığı için önbelleğe **yazılmaz** ve bir sonraki istek yeni
bir tur başlatır.

### Otomatik bağımlılık: `clearDataCache` HTML'i de tazeler

Hangi sayfanın hangi içerikten etkilendiğini bildirmek gerekmez. Render
sırasında okunan her `withDataCache` anahtarı kaydedilir; `clearDataCache()` bir
anahtarı düşürdüğünde onu **fiilen okumuş** bütün HTML girdileri bayatlar.

```js
// "bu haber güncellendi" webhook'u
clearDataCache(`haber:${slug}`);
```

Bu tek satır haber detayını, o haberi listeleyen ana sayfayı ve etiket
sayfasını birlikte tazeler — çünkü üçü de o anahtarı okumuştu. Elle tag'lemede
en sık yapılan hata (detayı işaretleyip listeyi unutmak) burada yapısal olarak
mümkün değil: bildirim değil, gözlem var.

Ayrıntılar:

- Bağımlılık **her tazelemede yeniden** toplanır; sayfanın okuduğu anahtarlar
  zamanla değişebilir.
- Render sürerken gelen bir purge de yakalanır: o turun çıktısı "doğduğu anda
  bayat" olacağı için önbelleğe yazılmaz.
- Sayfa başına bağımlılık sayısı `getHtmlCacheEntries()` dökümünde `deps`
  alanında görünür. Bir invalidation beklediğiniz sayfayı tazelemiyorsa önce
  buraya bakın: sayfa o veriyi `withDataCache` üzerinden okumuyor olabilir.
- `withDataCache` kullanmayan bir uygulamada kaydedilecek bir şey yoktur;
  `cache().trackDependencies: false` ile izleme tamamen kapatılabilir.
- Bayatlatılan yollar ısıtma kuyruğunun **başına** alınır. `prewarm` kuruluysa
  sayfa, ziyaretçi gelmesini beklemeden tazelenir ve tur özeti bunu ayırt eder:
  `[prewarm] warmed 12/12 pages, 3 invalidated (0.4s)`.

Bir yönetim ucu yazmak için:

```js
import { clearHtmlCache, getHtmlCacheEntries } from "jskelet";

export default function register(app) {
  app.post("/_admin/cache/temizle", (req, res) => {
    if (req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN) {
      res.status(404).end();
      return;
    }
    clearHtmlCache();
    res.json({ ok: true });
  });

  app.get("/_admin/cache", (req, res) => {
    res.json(getHtmlCacheEntries());
  });
}
```

Dev sunucusu ayrıca manifest her değiştiğinde önbelleği kendiliğinden temizler:
saklanan HTML eski hash'li varlık URL'lerini taşıyor olur ve temizlenmezse sayfa
silinmiş dosyayı istemeye devam eder ([09-dev-araclari.md](./09-dev-araclari.md)).

Önbellek süreç belleğinde yaşadığı için birden fazla süreç/kopya çalıştırıyorsanız
her birinin kendi önbelleği olur; `clearHtmlCache()` yalnızca çağrıldığı süreci
etkiler. Birden fazla instance çalıştıran bir kurulumda bunu aşmanın yolu bir
sonraki bölümde.

## Paylaşımlı önbellek: Redis

Varsayılan önbellek tek prosese ait. Bu, tek instance çalışan bir sitede en hızlı
ve en basit kurulum — ama üç kopya çalıştırdığınızda iki sorun çıkar:

1. **Her kopya kendi başına ısınır.** Yeni bir instance açıldığında ya da bir
   deploy sonrası konteyner yenilendiğinde önbellek boştur; aynı sayfa üç kez
   render edilir, aynı veri üç kez çekilir.
2. **Invalidation tek kopyaya ulaşır.** `invalidateHtmlCache()` çağıran webhook
   yalnızca isteği alan instance'ı tazeler; diğerleri TTL'i bekler. Ziyaretçi
   hangi kopyaya düştüğüne göre eski ya da yeni içeriği görür.

`cache().redis` bu iki sorunu çözer. Redis **birincil store olmaz**: bellek içi
önbellek (L1) aynen kalır ve her istek onu okur; Redis ikinci kademedir (L2).

```js
// jskelet.config.mjs
export default {
  cache() {
    return {
      html: { "/haber/:slug": 300 },
      redis: {
        enabled: true,
        url: process.env.REDIS_URL,
        namespace: "haber-sitesi",
      },
    };
  },
};
```

`ioredis` opsiyonel bir peer bağımlılıktır, uygulamanın kendisine kurulur:

```bash
npm install ioredis
```

Kurulmadıysa ya da Redis'e bağlanılamıyorsa uyarı basılır ve site **bellek içi
önbellekle çalışmaya devam eder**. Redis çalışırken düşerse aynı şey olur: bir
devre kesici art arda beş hatadan sonra katmanı beş saniye baypas eder, böylece
her istek ağ zaman aşımı beklemez.

### Ne kazanırsınız

- **Soğuk instance sıcak önbellek bulur.** L1'de olmayan bir yol için render
  çalışmadan önce Redis okunur; başka bir kopya o sayfayı ürettiyse render hiç
  çalışmaz.
- **Veri önbelleği kotayı bir kez harcar.** `withDataCache` aynı mantıkla
  çalışır ve kazanç burada daha büyük: JSON küçük, bir kopyanın çektiği veri
  hepsine yeter.
- **Invalidation her kopyaya gider.** `invalidateHtmlCache()`,
  `clearHtmlCache()` ve `clearDataCache()` bir pub/sub kanalına mesaj bırakır;
  her instance kendi L1'ine aynı işlemi uygular. Deseni yayınlar, eşleşen
  anahtarları değil — hangi yolun nerede sıcak olduğu kopyaya bağlı.

### Anahtar düzeni

```
_jskelet:{namespace}:{buildId}:html:{yol}?{query}
_jskelet:{namespace}:{buildId}:data:{anahtar}
_jskelet:{namespace}:events
```

`buildId` her build'de değişir (`jskelet build` bunu `.jskelet/build.json`
dosyasına yazar) ve **zorunlu bir parçadır**: saklanan HTML hash'li varlık
yollarını gömüyor, yani bir deploy'dan sonra eski HTML geçersizdir. Kimlik
önekte durduğu için yeni sürüm kendiliğinden yeni bir isim alanına yazar, eski
anahtarlar TTL ile ölür — elle temizlik ya da `FLUSHDB` gerekmez. Build
çalıştırılmadıysa kimlik `dev` olur.

`namespace` aynı Redis'i paylaşan birden fazla uygulamayı ayırır. Olay kanalı
bilinçli olarak `buildId` **taşımaz**: deploy sırasında eski ve yeni sürüm yan
yana koşuyor ve bir purge ikisine de ulaşmalı.

### Bilmeniz gereken takaslar

- **Kişiye özel çıktı paylaşılmaz.** `storable: false` işaretlenen bir render
  (cookie/`Authorization` okuyan sayfa) Redis'e hiç yazılmaz. Tek prosesteyken
  bile geçerli olan bu kural paylaşımlı kademede daha da kritik: sızması, bir
  kullanıcının HTML'ini tüm kümeye servis etmek olur. `degraded` render ve 200
  dışındaki durum kodları da paylaşılmaz.
- **Sıkıştırılmış gövdeler varsayılan olarak yerel kalır.** `storeEncoded: true`
  ile açılabilir, ama girdi başına boyutu iki-üç katına çıkarır; brotli'yi
  yeniden üretmek çoğu zaman Redis'ten indirmekten ucuzdur.
- **Yumuşak invalidation Redis kopyasını siler.** Bayatlatmanın Redis karşılığı
  her anahtar için oku-değiştir-yaz turu demek ve bir webhook binlerce anahtarı
  birden düşürüyor. Silmenin bedeli, o yolu hiç görmemiş bir kopyanın bir kez
  render etmesi; L1'i sıcak olan kopyalar eski HTML'i bayat pencerede servis
  etmeye devam eder.
- **Yalnızca taze girdi kabul edilir.** Bayat bir kopyayı L1'e almak tazelemeyi
  sonsuza kadar ertelerdi: girdi bayat kalır, her tur yine Redis'i okur ve
  render hiç çalışmaz.
- **Tutarlılık nihai.** Bir purge ile o purge'ün her kopyaya ulaşması arasında
  kısa bir pencere var. Bu pencerede bir kopya eski HTML'i servis edebilir;
  süresi TTL ile sınırlı.
- **Dev'de kapalı tutun.** Dev sunucusu manifest her değiştiğinde önbelleği
  boşaltıyor; paylaşımlı bir store bunu anlamsızlaştırır. `enabled` yalnızca
  açıkça `true` verildiğinde açılır.

### Durumu görmek

```js
import { getRedisStatus } from "jskelet";

app.get("/api/healthcheck", (req, res) => {
  res.json({ ok: true, cache: getRedisStatus() });
});
```

Bağlantı kurulmamışken de güvenle çağrılır. Dönen nesne
`{ enabled, connected, keyPrefix, buildId, errors, bypassed }`; `bypassed` devre
kesicinin açık olduğunu, `errors` toplam komut hatasını gösterir. Aynı özet dev
panelinin raporunda da var ([09-dev-araclari.md](./09-dev-araclari.md)).

Ayarların tam listesi: [07-yapilandirma.md](./07-yapilandirma.md).

## Prewarm — açılışta ısıtma

Next'teki build-time prerender'ın karşılığı, ama çıktı diske yazılmaz: önbellek
süreç belleğinde yaşadığı için ısıtma da süreç ayağa kalkınca yapılır. Kazanç
aynı — ilk ziyaretçi soğuk render'ı beklemez — fakat veri dondurulmaz; her girdi
route'un `revalidate` süresiyle yaşlanır ve stale-while-revalidate ile arkada
tazelenir.

Isıtma **gerçek HTTP istekleriyle** yapılır (`http://127.0.0.1:<port>`), çünkü
cache anahtarı, sıkıştırma ve middleware zinciri normal trafikle bire bir aynı
olsun.

### `hooks.prewarmPaths()`

Hangi yolların ısıtılacağını uygulama bildirir; genelde sitemap üreten
fonksiyonun aynısıdır.

```js
// jskelet.config.mjs
export default {
  hooks: {
    async prewarmPaths() {
      const slugs = await getAllArticleSlugs();
      return ["/", "/piyasalar", ...slugs.map((slug) => `/haber/${slug}`)];
    },
  },
};
```

Kurallar:

- Dizi döndürmezse uyarı basılır ve ısıtma yapılmaz.
- Yalnızca `/` ile başlayan string'ler alınır.
- `prewarmSkip` öneklerinden biriyle başlayanlar atlanır. Varsayılan liste:
  `/api/`, `/_fragment/`, `/__jskelet/`. Oturuma bağlı sayfalar ısıtılmamalı.
- Tekilleştirme **sırayı korur**: `priority` verilmediğinde uygulamanın verdiği
  sıra anlamlıdır — en önemli sayfaları başa koyun.
- Bu hook tanımlı değilse ısıtma hiç kurulmaz; zamanlayıcı bile açılmaz.

### Tur mantığı

1. Liste toplanır. `max`'tan (varsayılan 400) uzunsa bir dilim seçilir:
   `priority` eşleşenler **her turda** başa alınır, kalan yerler kuyruktan
   doldurulur.
2. `concurrency` işçi paralel olarak istek atar (prod'da 4, dev'de 1). Dev'de
   tek işçi: tarama, o an tarayıcıda açtığın sayfanın render'ıyla CPU için
   yarışmasın.
3. `rps` verilmişse tur bu hızın üstüne çıkmaz — paralellik ne olursa olsun.
   Dev'de varsayılan olarak saniyede 4 istek uygulanır: render tek bir olay
   döngüsünde çalıştığı için aralıksız bir tur, sayfa isteklerini ve dev
   panelinin canlı kanalını arkasında bekletiyor.
4. Başarısız yollar için, `retryDelayMs` bekledikten sonra **tek seri tekrar
   turu** yapılır (`concurrency: 1`). Bekleme bilinçli: rate limit pencereleri
   saniye mertebesinde, hemen tekrar denemek aynı 429'u almak demek.
5. Özet loglanır:
   `[prewarm] warmed 128/130 pages, 2 failed, 5 recovered on the retry pass (12.4s)`

Tur sırasında oluşan istek hataları tek tek loglanmaz; sayılır ve tur bitince
özetin ardından tek bir satırda, en sık görülen türler başta olacak şekilde
basılır:

```text
[prewarm] 37 request errors were not logged individually:
  31× 502 upstream fetch failed: /api/quotes
  6× 500 Cannot read properties of undefined (reading 'title')
```

Böylece bir anlık upstream arızası "warmed …" satırını yüzlerce yığın izinin
altına gömmüyor. Gerçek trafiğin hataları eskisi gibi anında loglanır, tek bir
yolun ayrıntısı için dev panelindeki **Prewarming** sekmesine bakılır.

### Isıtma sırası: `priority`

```js
// jskelet.config.mjs
cache: () => ({
  prewarm: {
    priority: [
      "/",
      "/piyasalar/:path*",
      /-yorumlar$/,
    ],
  },
}),
```

Desen sözdizimi (`/haber/:slug`) ve doğrudan `RegExp` birlikte kullanılabilir;
ikincisi "sonu `-yorumlar` ile bitenler" gibi desen sözdiziminin karşılamadığı
kurallar için. Önce yazılan önce ısınır, hiçbirine uymayan yollar kuyruğa gider
ve kendi aralarındaki sırayı korur.

### Damla damla ısıtma: `rotate` + `rps` + `intervalSeconds`

10.000 yolluk bir sitede tek turda her şeyi ısıtmak ne mümkün (HTML önbelleği
500 girdi tutar) ne de doğru (API kotası dolar). Doğru davranış listeyi zamana
yaymak:

```js
prewarm: {
  max: 300,               // her turda 300 sayfa
  rps: 4,                 // saniyede en fazla 4 istek
  intervalSeconds: 300,   // 5 dakikada bir tur
  rotate: true,           // kuyruk kaldığı yerden devam eder
  priority: ["/", "/piyasalar/:path*"],
}
```

Bu kurulumda öncelikli sayfalar her turda tazelenir, geri kalan kuyruk turlar
boyunca baştan sona dolaşılır ve upstream saniyede dört isteğin üstünü hiç
görmez. Veri önbelleği ile birlikte kullanıldığında ikinci turdan sonra ısıtma
API'ye neredeyse hiç gitmez: veri katmanından okur.

Rotasyon açıkken sınırın dışında kalan yollar kaybolmuyor, bir sonraki tura
kalıyor; log bunu ayırt eder:
`… , 700 deferred to the next pass`. `rotate: false` ile klasik davranışa
dönülür — her tur listenin aynı ilk dilimini ısıtır ve gerisi hiç ısınmaz
(`… , 700 over the limit`).

Bir tur `intervalSeconds`'tan uzun sürerse yeni tur başlatılmaz; üst üste binen
turlar upstream'e iki kat yük bindirirdi.

İstekler `user-agent: jskelet-prewarm` (`brand.prewarmUserAgent`) ve
`accept-encoding: br, gzip` başlıklarıyla gider; ikincisi sıkıştırılmış gövdenin
de önbelleğe girmesi için.

`DEV_TOKEN` ayarlıysa ısıtma token'ı çerez olarak taşır; yoksa dev gate tüm
sayfalara 404 döner ve önbellek hiç dolmaz.

Dev panelindeki istek listesi ve terminal, `prewarmUserAgent` taşıyan istekleri
filtreler: yüzlerce ısıtma isteği görünümü doldurmasın. İlerleme baloncuğun
yanındaki rozette görünür.

### Zamanlama

- Isıtma açılışta **gecikmeyle** başlar: ilk gerçek isteklerle yarışmasın.
  Varsayılan gecikme prod'da 500 ms, dev'de 3000 ms. Dev'de daha uzun, çünkü
  dosya kaydı süreci yeniden başlattığı için zamanlayıcı da ölür; yalnızca
  sunucu bir süre sakin kalınca ısınır.
- `PREWARM_INTERVAL_SECONDS` / `cache().prewarm.intervalSeconds` > 0 ise tur
  periyodik tekrarlanır. Girdiler `revalidate` ile yaşlandığı ve
  stale-while-revalidate sayesinde ziyaretçi beklemediği için bu **opsiyoneldir**;
  hiç ziyaret edilmeyen sayfaları da sıcak tutmak isteyen kurulumlar için.
- Tüm zamanlayıcılar `unref()` edilmiştir: süreç kapanışını geciktirmezler.
- Hiçbir ısıtma hatası süreci düşürmez.

### Ayarlar

Öncelik sırası: **ortam değişkeni → config → kod varsayılanı.** Env önde, çünkü
tek seferlik deneyler config'i düzenlemeden yapılabilsin.

| Ayar | Env | `cache().prewarm` | Varsayılan |
| --- | --- | --- | --- |
| Açık/kapalı | `PREWARM=0` kapatır, `PREWARM=1` config'i ezip açar | `enabled` | `true` |
| Tur başına en fazla yol | `PREWARM_MAX` | `max` | `400` |
| Paralellik | `PREWARM_CONCURRENCY` | `concurrency` | prod 4, dev 1 |
| Saniyedeki istek | `PREWARM_RPS` | `rps` | prod `0` (sınırsız), dev 4 |
| Başlangıç gecikmesi (ms) | `PREWARM_DELAY_MS` | `delayMs` | prod 500, dev 3000 |
| Tekrar turu gecikmesi (ms) | `PREWARM_RETRY_DELAY_MS` | `retryDelayMs` | `2000` |
| Periyot (saniye) | `PREWARM_INTERVAL_SECONDS` | `intervalSeconds` | `0` (kapalı) |
| Kuyruk rotasyonu | — | `rotate` | `true` |
| Isıtma sırası | — | `priority` | `[]` |

Sayısal ayarlar yalnızca **pozitif ve sonlu** değer kabul eder; geçersiz bir
değer sessizce bir sonraki katmana düşer.

### Elle tetikleme

```js
import { prewarm, prewarmProgress } from "jskelet";

await prewarm({ origin: "http://127.0.0.1:3000" });          // hook'tan yollar
await prewarm({ origin, paths: ["/", "/piyasalar"] });        // yalnızca bu yollar
await prewarm({ origin, quiet: true });                       // özet basmadan
```

`paths` verilirse hook hiç çağrılmaz. Dönüş değeri
`{ ok, failed, total, elapsed }`.

`prewarmProgress` canlı durumu tutar ve dev paneli bunu okur:

```js
{
  active, done, total, ok, failed, startedAt, finishedAt,
  entries: [{ path, status, ms, bytes, cache, error }],
}
```

`entries` içindeki `cache` alanı o yolun `X-JSkelet-Cache` yanıtıdır; ısıtma
turunun gerçekten `MISS` → önbellek doldurup doldurmadığını buradan görürsünüz.

## Teşhis: sık görülen durumlar

- **Her istek `MISS` dönüyor.** Route'a `revalidate` verilmemiş ya da
  `cache().html` içindeki desen 0 saniye veriyor. Veya sayfa `status: 200`
  dışında bir kod dönüyor.
- **Sayfa `MISS` dönüyor ama upstream sağlam.** Geçici bir upstream hatası
  bildirilmiş olabilir; logda `was produced with missing data, not caching it`
  satırını arayın.
- **Sürekli eski veri.** `revalidate` çok yüksek; unutmayın ki gerçek gecikme en
  fazla `revalidate` + bir tazeleme turudur.
- **Önbellek şişiyor.** Query parametreleri anahtara girdiği için kampanya
  parametreleri girdi çoğaltıyor olabilir.
- **Isıtma hiç çalışmıyor.** `hooks.prewarmPaths` tanımlı değil, `PREWARM=0`
  ayarlı ya da `cache().prewarm.enabled === false`.
- **Isıtma turu API'yi 429'a sokuyor.** `rps` verilmemiş. `concurrency`
  düşürmek yeterli değil; kotayı koruyan ayar toplam hız. Kalıcı çözüm veri
  önbelleği: ikinci turdan sonra ısıtma upstream'e gitmez.
- **Isıtma listesi `max`'tan uzun ve sonu hiç ısınmıyor.** `rotate: false`
  olabilir; logdaki `over the limit` ifadesi bunu gösterir.
- **Bir bölümün tamamı 404 dönüyor.** Upstream düşmüş olabilir. Artık bu durumda
  sayfa bir kez daha denenir, olmazsa 404 değil önbelleğe girmeyen 503 döner;
  logda `returned notFound() while upstream is failing` satırını arayın. Hâlâ
  404 görüyorsanız hata `fetch` dışı bir istemciden geliyor olabilir
  (`reportUpstreamFailure()` gerekir) ya da `cache().trackUpstream` kapatılmış.

## Sırada ne var

- Config alanlarının tam referansı ve env tablosu:
  [07-yapilandirma.md](./07-yapilandirma.md)
- Önbelleği dev panelinden izlemek: [09-dev-araclari.md](./09-dev-araclari.md)
- CDN/ters proxy ile birlikte kullanım: [10-dagitim.md](./10-dagitim.md)
