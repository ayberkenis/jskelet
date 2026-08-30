# 09 — Geliştirme araçları

Bu belge `jskelet dev`in ne yaptığını ve neden böyle yaptığını anlatır: iki alt
sürecin yönetimi, terminal çıktısının biçimi, izlenen dizinler ve `node --watch`
yerine kendi watcher'ının yazılma sebebi, CSS hot-swap ile tam yenileme ayrımı,
`Alt+D` ile açılan devtools overlay'i, detaylı rapor sayfası ve `DEV_TOKEN` ile
kurulan dev gate. Build adımlarının kendisi [08-build.md](./08-build.md)'de.

## `jskelet dev` akışı

Komut tek terminalde iki uzun ömürlü alt süreç yönetir:

```
jskelet dev
├─ build watch   node src/build/build.mjs --watch
└─ sunucu        node [--env-file=.env] --import <register.mjs> src/start.mjs
```

`NODE_ENV=development` ataması platformdan bağımsız olarak burada yapılır —
`cross-env` gerekmez. Alt süreçlere ayrıca `JSKELET_CHILD=1` (build banner'ını
bastırır) ve TTY varsa `JSKELET_COLOR=1` (borulanmış çıktıda renk zorlar)
geçirilir.

Açılış sırası: banner → build adımları → sunucu hazır → `Ready` özeti. Özet hem
build hem sunucu hazır olduğunda basılır; aksi hâlde arkadan gelen build
satırlarının arasında kalıyordu.

Sunucunun hazır olduğu, `startServer` içindeki tek satırdan anlaşılır:

```
jskelet → http://localhost:3000 (development)
```

Bu satırın biçimi bir sözleşmedir; dev script'i onu ayrıştırıp özet satırını ona
göre basar.

### Terminal çıktısının biçimi

Alt süreçlerin çıktısı olduğu gibi akmaz. İki bölge vardır ve karışmazlar:

1. **Başlangıç:** banner, hizalı build satırları, `Ready` özeti.
2. **Çalışma anı:** zaman damgalı, tek satırlık olaylar (HTTP istekleri, CSS
   rebuild, sunucu restart).

Hata yığınları çerçeveli bir kutuya dönüşür: yığın satırları parça parça geldiği
için kısa bir sessizlikten (60 ms) sonra toplanır, hata adı ve mesajı
ayrıştırılır, ilk üç frame gösterilir ve proje kökü `.` ile kısaltılır. Kendi
framework'ünü geliştirirken hatanın akış içinde kaybolmaması gerçekten fark
yaratan ayrıntı.

Renk anlam taşır: `✓` yeşil, `✖` kırmızı, `⚠` sarı, `↻` cyan; süre ve yol gri.
Dekoratif renk kullanılmaz. `NO_COLOR` ayarlıysa renk hiç kullanılmaz.

`Ctrl+C` (SIGINT/SIGTERM) tüm alt süreçleri kapatır. Bir alt süreç sıfır dışı
kodla çıkarsa (beklenen restart hariç) hata basılır ve dev süreci de kapanır.

## Watch dizinleri

Sunucu yeniden başlatma framework'ün kendi watcher'ıyla yönetilir.

```js
WATCH_DIRS = [
  config.dirs.routes,
  config.dirs.views,
  <root>/lib,
  ...config.watch,   // jskelet.config.mjs → watch
]
```

Ayrıca `jskelet.config.mjs` dosyasının kendisi izlenir: config değişince hem
sunucu hem build yeni ayarlarla açılmalı.

İzlenen uzantılar: `.js`, `.mjs`, `.json`, `.ejs`.

`views` de izlenir çünkü bileşenlerin çoğu `views/components/**.js` içinde ve bu
modüller sunucuya bir kez import edildiği için, restart olmadan yapılan
değişiklik tarayıcıya hiç yansımıyordu (şablon düzenleyip "hiçbir şey değişmedi"
hissi buradan geliyor).

`client/` ve `styles/` bu listede **yoktur**: onları esbuild ve CSS watcher'ları
kendi içinde hallediyor ([08-build.md](./08-build.md)).

Bir dizin izlenemezse uyarı basılır ve o dizinde otomatik restart olmaz; gerisi
çalışır.

### Neden `node --watch` kullanılmadı

`--watch-path` verilse bile Node bu kurulumda proje kökünü izliyordu. Build
çıktısı (`public/assets`, `manifest.json`) ya da dev araçlarının günlüğü
yazıldığında sunucu boşuna yeniden başlıyor, hatta kendini besleyen bir döngü
kuruluyordu: restart → açılış uyarısı → yazma → restart.

Kendi watcher'ı üç şey yapar:

1. **Yalnızca sunucu kaynaklarını izler.**
2. **Değişiklikleri birleştirir** (250 ms) ve hangi dosyaların değiştiğini
   bildirir.
3. **Sahte olayları eler.** Windows'ta `fs.watch` bir dosya yazıldığında
   komşuları için de olay üretebiliyor; `mtime` karşılaştırılmazsa tek kaydetme
   iki restart'a dönüşüyordu. Açılışta mevcut zamanlar önden okunur, böylece ilk
   sahte olay da elenir.

Restart satırı değişen dosyayı ya da sayısını gösterir:

```
21:04:12 ↻ server  restarting…  routes/10-pages.mjs
21:04:12   server  restarted    412ms
```

`JSKELET_VERBOSE=1` ayarlıysa birden fazla dosya değiştiğinde tamamı listelenir.

## CSS hot-swap ve tam yenileme

Dev sunucusu `.jskelet/manifest.json` dosyasını izler ve olayları canlı kanal
(`<devBasePath>/ws`) üzerinden tarayıcıya yayınlar. Manifest her build turunda
yeniden yazıldığı için değişiklik tespiti manifest üzerinden yapılır.

| Değişen | Davranış |
| --- | --- |
| Yalnızca `app.css` | **CSS hot-swap:** stylesheet takas edilir, sayfa yenilenmez. Durum ve kaydırma korunur. |
| `main.js`, sprite, başka bir varlık ya da birden fazla anahtar | **Tam yenileme** |

Her iki durumda önce HTML önbelleği temizlenir: saklanan HTML eski hash'li varlık
URL'lerini taşıyor olur ve temizlenmezse sayfa silinmiş dosyayı istemeye devam
eder.

Manifest olayları 120 ms birleştirilir. Watch desteklenmiyorsa live reload devre
dışı kalır ve gerisi çalışır.

Sunucu yeniden başladığında overlay bunu **boot kimliğinden** anlar: her süreç
kendine özgü bir `boot` değeri yayınlar, overlay değişikliği görüp "restarted"
bilgisini gösterir ve kendi durumunu sıfırlamaz.

## Canlı kanal

Overlay'e giden her şey — istatistikler, live reload ve CSS hot-swap olayları —
tek bir WebSocket üzerinden gelir (`<devBasePath>/ws`). Panel eskiden
istatistikleri iki saniyede bir çekiyordu; açık her sekme, panel kapalıyken bile
sunucuya sürekli istek atıyordu. Artık sunucu değişiklik oldukça iter: bir istek
ya da hata kaydedildiğinde (120 ms birleştirilerek), ısıtma sürerken saniyede
bir, geri kalan zamanda yalnızca uptime/bellek tazelensin diye dört saniyede bir.
Bağlı panel yoksa hiçbir şey hesaplanmaz.

El sıkışma HTTP `upgrade` olayında geçtiği ve o olay middleware zincirine hiç
uğramadığı için kanal `listen` sonrası doğrudan sunucuya bağlanır
(`attachDevSocket`). Sunucu tarafı `ws` gibi bir bağımlılık kullanmaz: yalnızca
sunucu→istemci metin çerçevesi yazmak ve istemcinin ping/close çerçevelerini
yanıtlamak gerekiyor.

Soket hiç açılamazsa (araya giren bir proxy WebSocket'i geçirmiyor olabilir)
overlay eski yola düşer: `/events` SSE akışı + `/stats` yoklaması. Soket kurulup
sonra düşerse — yani sunucu yeniden başlıyorsa — yarım saniyede bir yeniden
bağlanır ve gösterge bu sırada "bağlantı yok" der.

## Devtools overlay

Sağ altta yüzen bir baloncuk; `Alt+D` ile açılır, `Esc` ya da karartma alanına
tıklamak kapatır. Yalnızca `NODE_ENV=development` iken layout tarafından
basılır:

```ejs
<% if (devtools) { %>
<script type="module" src="<%= devBasePath %>/overlay.js"></script>
<% } %>
```

Overlay dosyası **build'e dâhil değildir.** Sunucu onu framework paketinden ham
olarak servis eder; bu yüzden içinde bundler yoktur, tek dosya olarak çalışır ve
prod çıktısına hiçbir şey eklemez. Tüm arayüz shadow DOM içinde durur, sayfanın
CSS'i ile karışmaz.

Gösterdikleri:

- **Hatalar:** tarayıcı tarafındaki JS hataları, kaynak yükleme hataları
  (`img`/`script`/`link`), ve sunucudaki `console.error` / `console.warn`
  çıktıları. Sunucu tarafında `console` sarılır, böylece uyarılar terminalde
  kaybolmaz.
- **İstekler:** her HTML isteğinin metodu, yolu, durumu, süresi ve
  `X-JSkelet-Cache` değeri. Aynı satırlar terminale de basılır.
- **Web Vitals:** TTFB, FCP, LCP, CLS, INP, DCL, load, uzun task sayısı ve
  bloke süresi.
- **Prewarm:** ısıtma turunun ilerlemesi; panelden elle tetiklenebilir, tek tek
  yollar tekrar denenebilir.
- **Süreç:** pid, Node sürümü, uptime, RSS ve heap kullanımı.
- **Sürüm:** kurulu JSkelet sürümü ve npm'deki `latest` ile karşılaştırması.
  Yeni bir sürüm varsa **Server** sekmesinde `update` rozeti ve yükseltme
  komutunu kopyalayan bir satır çıkar. Yoklama açılıştan 1,5 saniye sonra bir
  kez yapılır, sonucu 6 saat boyunca `os.tmpdir()` içinde saklanır ve ağ yoksa
  sessizce atlanır. `JSKELET_VERSION_CHECK=0` ile tamamen kapatılır.

Isıtma istekleri (`user-agent: jskelet-prewarm`) hem terminalden hem istek
listesinden filtrelenir: yüzlerce istek görünümü doldurmasın. İlerleme baloncuğun
yanındaki rozette görünür.

### Durum neden `os.tmpdir()`'e yazılıyor

İstek ve hata kayıtları süreç belleğinde durursa her yeniden başlatmada geçmiş
silinir ve overlay boşalır. Bu yüzden kayıtlar restart'lar arasında bir dosyada
taşınır.

Dosya **proje ağacına yazılmaz**: her yazma watcher'ı tetikleyip sunucuyu
yeniden başlatıyordu ve bu kendini besleyen bir döngü kuruyordu (restart →
açılış uyarısı → yazma → restart). Bunun yerine dosya
`os.tmpdir()/jskelet-devtools-<proje kökünün hash'i>.json` yoluna yazılır;
hash sayesinde aynı makinede birden fazla JSKelet projesi birbirinin kaydını
ezmez.

Yazma her istekte değil, 300 ms sessizlikten sonra yapılır ve başarısızlığı dev
akışını durdurmaz. En fazla 50 istek ve 50 hata tutulur.

Panelin açık/kapalı durumu, aktif sekmesi ve tarayıcı hata günlüğü ise sekme
belleğinde (`sessionStorage`) saklanır, böylece yenileme sonrası panel aynı
sekmeyle geri gelir.

## Rapor sayfası

Baloncuk anlık durumu gösterir; rapor sayfası sitenin tamamına bakan bir görünüm
üretir. Adres:

```
http://localhost:3000/__jskelet/dev/report
```

(`brand.devBasePath` değiştirilmişse ona göre.)

İçeriği:

- **Sayfalar:** gezilen her sayfanın Web Vitals ölçümleri, kaynak sayısı ve
  toplam bayt (tür kırılımıyla), island durumu (kaç tanesi hazır, adları),
  tarayıcıdaki API çağrıları ve SSR çıktısının boyutu/süresi/cache durumu. Hiç
  gezilmemiş ama ısıtılmış sayfalar da listelenir: SSR tarafı bilinir, istemci
  ölçümleri boş kalır.
- **Sunucu API çağrıları:** SSR sırasında yapılan dış `fetch` çağrıları — URL,
  host, metot, durum, süre, bayt. `globalThis.fetch` yalnızca development'ta
  sarılır; üretim yolu dokunulmaz kalır. Kendi sunucumuza yapılan istekler
  (ısıtma, sağlık kontrolü) API sayılmaz.
- **Build çıktısı:** manifest'teki her varlığın ham/gzip/brotli boyutu, ve
  esbuild metafile'ından chunk analizi — her çıktının boyutu, hangi kaynaklardan
  oluştuğu, hangi chunk'ları import ettiği. Kaynaklar okunur gruplara indirgenir
  (paket adı ya da üst klasör), böylece "bu chunk'ın 40 kB'ı hangi kütüphaneden"
  sorusu yanıtlanabilir.
- **HTML önbelleği:** girdi sayısı ve döküm (anahtar, bayt, durum, bayat mı, kaç
  saniye sonra dolacak, hangi encoding'ler saklanmış).
- **Prewarm:** son turun tam sonucu.
- **İstek ve hata günlükleri.**

Ölçümler tarayıcı sekmesinde değil sunucuda durur; sıfırlama da sunucudan
yapılır. Boyut hesapları dosya değişmedikçe tekrarlanmaz.

Rapor katmanı yalnızca development'ta yüklenir, üretim çıktısına hiç girmez.

## Dev uçları

`brand.devBasePath` (varsayılan `/__jskelet/dev`) altında:

| Yol | Metot | İşi |
| --- | --- | --- |
| `/overlay.js` | GET | Overlay script'i |
| `/logo.png` | GET | Overlay logosu |
| `/ws` | GET (upgrade) | Canlı kanal: istatistikler, live reload ve CSS hot-swap olayları |
| `/events` | GET | SSE: yalnızca WebSocket kurulamazsa kullanılan yedek olay akışı |
| `/stats` | GET | Anlık istatistikler; aynı yedek yolun veri ucu |
| `/report` | GET | Rapor sayfası (HTML) |
| `/report.js` | GET | Rapor sayfasının script'i |
| `/report/data` | GET | Raporun tek veri kaynağı (JSON) |
| `/vitals` | POST | Overlay'in gönderdiği ölçüm paketi |
| `/report/clear` | POST | Sayfa ölçümlerini ve sunucu API kayıtlarını sıfırlar |
| `/prewarm` | POST | Isıtmayı elle tetikler. Gövdede `paths` varsa yalnızca o yollar; ısıtma zaten çalışıyorsa 409. |
| `/clear` | POST | İstek ve hata günlüklerini sıfırlar |

Bu uçların tamamı `mountDevtools()` tarafından yalnızca
`NODE_ENV=development` iken bağlanır; prod sürecine dinamik import sayesinde
hiçbir şey yüklenmez.

## Dev gate — `DEV_TOKEN`

Yayına açılmamış bir ortamı gizlemek için: `DEV_TOKEN` ayarlıyken token
taşımayan **her** isteğe 404 döner.

```bash
DEV_TOKEN=uzun-rastgele-bir-dize npm start
```

Erişim:

```
https://staging.ornek.com/?dev_token=uzun-rastgele-bir-dize
```

Davranış:

- **403 değil 404.** 403 ortamın var olduğunu doğrular; 404 hiç yokmuş gibi
  davranır.
- Token bir kez query parametresiyle gelirse çereze yazılır (`Path=/`,
  `SameSite=Lax`, 14 gün), böylece link paylaşımı yeterli olur. Çerez ve
  parametre adı `brand.devTokenCookie` (varsayılan `dev_token`).
- `devGateBypass` listesindeki **tam** yollar her koşulda açıktır. Varsayılan:
  `/api/healthcheck`, `/robots.txt`, `/sitemap.xml`, `/site.webmanifest`,
  `/favicon.ico`. Sağlık kontrolünüz farklı bir yolda ise bu listeye eklemeyi
  unutmayın, aksi hâlde orkestratör 404 görür.
- `DEV_TOKEN` yoksa middleware tamamen devre dışıdır ve üretimde hiçbir maliyeti
  olmaz.
- Isıtma kendi sunucusuna istek attığı için token'ı çerez olarak taşır; yoksa tüm
  sayfalar 404 alır ve önbellek hiç dolmaz ([06-cache.md](./06-cache.md)).

Gate middleware zincirinde `headers`tan sonra, `redirects`ten **önce** durur:
yayına açılmamış bir ortam yönlendirme kurallarını bile dışarıya sızdırmamalı.

## Development ile production farkları

| Konu | Development | Production |
| --- | --- | --- |
| EJS şablon cache'i | Kapalı | Açık |
| Manifest okuma | Her istekte | Bir kez |
| Görsel manifest'i | Her çağrıda | Bir kez |
| Bozuk route modülü | Uyarı + atla | Fırlat |
| Devtools ve rapor | Mount edilir | Hiç yüklenmez |
| `globalThis.fetch` | Sarılır (ölçüm) | Dokunulmaz |
| Prewarm paralelliği | 2 | 4 |
| Prewarm gecikmesi | 3000 ms | 500 ms |
| Eksik ikon uyarısı | Verilir | Verilmez |
| Precompress | Watch'ta çalışmaz | Çalışır |
| Görsel optimizasyonu | Watch'ta çalışmaz | Çalışır |

## Sırada ne var

- Build adımlarının ayrıntısı: [08-build.md](./08-build.md)
- Prod'a alma: [10-dagitim.md](./10-dagitim.md)
- Önbelleği okumak ve temizlemek: [06-cache.md](./06-cache.md)
