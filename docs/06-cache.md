# 06 — Önbellek ve prewarm

Bu belge JSkelet'in ISR ikamesini bütün ayrıntılarıyla anlatır: HTML TTL
önbelleği ve stale-while-revalidate davranışı, `revalidate`'in nereden geldiği,
cache anahtarının nasıl kurulduğu, `X-JSkelet-Cache` başlığının değerleri,
sıkıştırılmış gövdenin neden önbellekte durduğu, istek içi memoizasyon
(`withRequestCache` / `cache()`), upstream hatalarının önbelleği nasıl
etkilediği (`reportUpstreamFailure`) ve sunucu açılışındaki ısıtma turu.
Kararların arkasındaki ölçüm gerekçeleri [02-mimari.md](./02-mimari.md)'de,
config alanlarının tam referansı [07-yapilandirma.md](./07-yapilandirma.md)'de.

## Genel resim

```
route(controller, { revalidate })
 └─ withHtmlCache(key, ttl, producer)          ← TTL + stale-while-revalidate
     └─ withUpstreamTracking(...)              ← eksik veri tespiti
         └─ withRequestCache(...)              ← istek içi memoizasyon
             └─ produce() → controller + renderPage
```

Sıra önemli: **istek içi cache en içte** olmalı ki aynı render'daki iki çağrı
tek upstream isteğine düşsün; **upstream takibi HTML cache'in içinde** olmalı ki
eksik veriyle üretilen çıktı önbelleğe yazılmasın.

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
önbelleği kapatmak (`revalidate` vermemek) makul bir önlemdir; store en fazla
500 girdi tutar ve LRU ile en eskiyi düşürür.

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

Store LRU'dur: erişilen girdi sona taşınır, `MAX_ENTRIES = 500` aşılınca en
eski düşürülür.

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

## Degraded render: `reportUpstreamFailure`

Render sırasında upstream düştüyse çıktı eksik veri içeriyor demektir. Böyle bir
HTML'i tüm TTL boyunca servis etmek yerine önbelleğe **hiç yazmamak** doğru
davranış: sonraki istek yeniden dener.

Bağımlılık yönü bilinçli olarak tersine çevrilmiştir: framework veri katmanını
tanımaz, veri katmanı framework'e haber verir. Hiç çağıran olmazsa maliyet boş
bir dizidir.

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

## Önbelleği yönetmek

`jskelet` şu fonksiyonları dışa açar:

| Fonksiyon | Ne yapar |
| --- | --- |
| `withHtmlCache(key, ttlSeconds, producer)` | Önbelleği doğrudan kullanmak için. `ttlSeconds` 0 ise producer her zaman çalışır. |
| `clearHtmlCache()` | Store'u tamamen boşaltır. |
| `getHtmlCacheSize()` | Girdi sayısı. |
| `getHtmlCacheEntries()` | Döküm: `{ key, bytes, status, stale, expiresIn, encodings }`. HTML gövdesi dönmez, yalnızca boyutu. |

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
etkiler.

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
- Tekilleştirme **sırayı korur**: liste `PREWARM_MAX` ile budandığı için
  uygulamanın verdiği öncelik sırası anlamlıdır — en önemli sayfaları başa
  koyun.
- Bu hook tanımlı değilse ısıtma hiç kurulmaz; zamanlayıcı bile açılmaz.

### Tur mantığı

1. Liste toplanır, `PREWARM_MAX` (varsayılan 400) ile budanır.
2. `PREWARM_CONCURRENCY` işçi paralel olarak istek atar (prod'da 4, dev'de 2).
   Dev'de daha az paralellik: tarama, o an tarayıcıda açtığın sayfanın
   render'ıyla CPU için yarışmasın.
3. Başarısız yollar için **tek seri tekrar turu** yapılır (`concurrency: 1`).
   Hatalar çoğunlukla upstream rate limit'i (429): ilk tur yüzlerce sayfayı aynı
   anda çekerken API'yi zorluyor. Tekrar turu bu sayfaların önbelleğe girmesini
   sağlıyor; aksi hâlde ziyaretçi soğuk render'ı öder.
4. Özet loglanır:
   `[prewarm] warmed 128/130 pages, 2 failed, 5 recovered on the retry pass (12.4s)`

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
| En fazla yol | `PREWARM_MAX` | `max` | `400` |
| Paralellik | `PREWARM_CONCURRENCY` | `concurrency` | prod 4, dev 2 |
| Başlangıç gecikmesi (ms) | `PREWARM_DELAY_MS` | `delayMs` | prod 500, dev 3000 |
| Periyot (saniye) | `PREWARM_INTERVAL_SECONDS` | `intervalSeconds` | `0` (kapalı) |

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

## Sırada ne var

- Config alanlarının tam referansı ve env tablosu:
  [07-yapilandirma.md](./07-yapilandirma.md)
- Önbelleği dev panelinden izlemek: [09-dev-araclari.md](./09-dev-araclari.md)
- CDN/ters proxy ile birlikte kullanım: [10-dagitim.md](./10-dagitim.md)
