# AGENTS.md

Bu depo **JSkelet** framework'ünün kaynağıdır: Express 5 + EJS sunucu render,
vanilla JS island'lar, Tailwind v4 ve süreç belleğinde yaşayan HTML TTL cache.
React ve TypeScript yok; düz JavaScript + JSDoc.

Bir JSkelet **uygulamasında** çalışıyorsan (framework'ün kendisinde değil), aynı
kuralların uygulama tarafı karşılıkları için [docs/](./docs/README.md) yeterli;
özellikle 03, 05 ve 07.

## Değişiklik yapmadan önce

Framework'ün davranışını değiştiren bir iş alıyorsan ilgili belgeyi oku. Bu
dosyalar kararların **gerekçelerini** taşıyor ve çoğu "iyileştirme" fikri orada
zaten tartışılmış:

| Dokunacağın yer | Önce oku |
| --- | --- |
| `src/server/render.js`, şablonlar | [04-render-ve-sablonlar.md](./docs/04-render-ve-sablonlar.md) |
| `src/server/html-cache.js`, `route()` | [06-cache.md](./docs/06-cache.md) |
| `src/server/create-app.js`, middleware | [02-mimari.md](./docs/02-mimari.md) |
| `src/client/**` | [05-islands.md](./docs/05-islands.md) |
| `src/build/**` | [08-build.md](./docs/08-build.md) |
| `src/config/**` | [07-yapilandirma.md](./docs/07-yapilandirma.md) |
| `src/dev-server.mjs`, `src/server/dev/**` | [09-dev-araclari.md](./docs/09-dev-araclari.md) |

Belgeler iki dilde: Türkçesi `docs/`, İngilizcesi `docs/en/` altında ve
dosyalar birebir eşlenik. Bir belgeyi değiştirdiysen karşılığını da güncelle;
pazarlama sitesi (`examples/marketing`) bu dosyaları doğrudan `/docs` altında
servis ettiği için eksik kalan çeviri kullanıcıya görünür.

## Doğrulama

**Lint yeterli, tam build zorunlu değil.**

```bash
npm run lint
npm test     # desen derleyicisi ve HTML cache için birim testler
```

Davranış değiştiren bir iş yaptıysan örneklerden biriyle uçtan uca dene:

```bash
npm --prefix examples/blog install     # ilk seferde
npm --prefix examples/blog run build
npm --prefix examples/blog run start   # ayrı terminalde
node examples/blog/smoke.mjs
```

`examples/blog` bilinçli olarak framework'ün her yüzeyini kullanır (dinamik
route, tüm config bölümleri, fragment, form, prewarm, RSS/sitemap, dört island).
Bir şeyi bozduysan smoke testi genelde yakalar.

## Mimari kurallar

**Framework domain bilgisi taşımaz.** `src/` altında hiçbir yerde uygulamaya
özel URL, marka adı, metin ya da veri şekli olmaz. Uygulamaya ait mantık
`hooks` üzerinden gelir (`metadata`, `layoutContext`, `notFound`,
`prewarmPaths`), görünen adlar `brand` üzerinden.

**Yol hesabı tek yerde.** Hiçbir modül `../..` sayarak dizin bulmaz;
`getConfig().dirs` kullanılır. Framework `node_modules/` içine girdiğinde
göreli yol sayan her satır bozulur.

**Yapılandırma hatası siteyi düşürmez.** Bozuk bir `jskelet.config.mjs`, hata
veren bir `headers()` ya da fırlatan bir hook uyarı basar ve varsayılana döner.

**Build çıktısı olmadan da ayağa kalkar.** `asset()` manifest yoksa hash'siz
yola döner, `hasAsset()` false olur ve layout etiketi basmaz. `jskelet build`
unutulduğunda hata değil, stilsiz ama çalışan bir sayfa görülür.

**Opsiyonel bağımlılıklar sessizce atlanır.** `sharp`, `postcss`,
`@phosphor-icons/core` yoksa ilgili build adımı çalışmaz. Peer bağımlılıklar
**uygulamanın** `node_modules`'ünden çözülmeli: `src/build/resolve-peer.mjs`
içindeki `importFromApp` / `tryImportFromApp` kullanılır, doğrudan `import
"postcss"` yazılmaz.

**Middleware sırası sözleşmedir.** `src/server/create-app.js` başındaki
numaralı yorum sırayı ve her konumun gerekçesini anlatır. Sıra değiştirmek
sessiz bozulmalara yol açar; değiştiriyorsan yorumu da güncelle.

**Cache'lenen HTML herkese aynı gider.** Kişiye özel hiçbir şey `route()` ile
render edilen sayfaya girmez. Tema gibi kararlar client'ta, kullanıcıya özel
parçalar ayrı ve `no-store` işaretli fragment uçlarında.

## Kod stili

- **JSDoc zorunlu**: dışa açık her fonksiyonda parametre ve dönüş tipleri.
- **Yorumlar Türkçe** ve *neden*i anlatır. Kodun ne yaptığını tekrar eden yorum
  yazma; bir kararın gerekçesini, bir takası ya da bir tuzağı yaz.
- Sunucu ve build tarafı `node:` önekli çekirdek modülleri kullanır.
- `src/client/**` tarayıcıda çalışır: Node API'si, `process` (build sırasında
  değiştirilen `clientEnv` dışında) ve senkron ağ yok.
- Yeni bir dışa açık yüzey ekliyorsan `package.json` → `exports` ve
  `src/index.js` / `src/client/index.js` barrel'larını güncelle; belgelerde
  yalnızca `exports` haritasındaki belirteçler kullanılır (`jskelet`,
  `jskelet/client`, `jskelet/html`, `jskelet/tags`).

## EJS tuzakları

- `include` **async**'tir: `await include('partials/x')` yalnızca şablonun kendi
  gövdesinde çalışır. Bir `forEach` callback'i içinde derleme hatası verir —
  `for` döngüsü kullan.
- `views/components/**` altındaki her named export otomatik olarak şablon local'i
  olur; import gerekmez. Bileşenler EJS değil, HTML string döndüren
  fonksiyonlardır.
- Şablona giden her kullanıcı verisi `<%= %>` ile ya da `esc()` üzerinden
  geçmeli; `<%- %>` yalnızca güvenli bildiğin HTML için.

## Tailwind

Sınıf taraması `styles/globals.css` içindeki `@source` direktiflerine bağlıdır
ve otomatik tespit `source(none)` ile kapatılmıştır. Sınıf kullanmaya başladığın
yeni bir dizin varsa oraya bir `@source` satırı eklemek gerekir; yoksa sınıflar
sessizce çıktıdan düşer.

## Örnekleri güncel tut

Framework'ün genel yüzeyini değiştirdiysen (`route()` imzası, hook adları,
config alanları, client API'si) `examples/minimal`, `examples/blog` ve
`examples/marketing`'i de güncelle. Örnekler belgelerdeki kod parçalarının kaynağı; kaymaları en hızlı
fark edilen yer orası.

## Windows notları

Bu depo Windows üzerinde geliştiriliyor ve iki tuzak tekrar tekrar çıkıyor:

- `--import` argümanı modül belirteci bekler. `H:\...` gibi mutlak bir yol `h:`
  şemalı URL sanılıp reddedilir; `pathToFileURL(...).href` kullan.
- `fs.watch` bir dosya yazıldığında komşuları için de olay üretebiliyor. Dev
  sunucusu bu yüzden olayları `mtime` karşılaştırmasıyla eler; watcher mantığını
  değiştirirken bu elemeyi kaldırma.
