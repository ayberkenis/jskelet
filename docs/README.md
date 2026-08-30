# JSkelet belgeleri

JSkelet, SEO ve hız odaklı siteler için "framework'süz hissettiren" bir
framework: Express 5 + EJS ile sunucuda tam HTML üretir, etkileşimi vanilla JS
island'larla ekler, CSS'i Tailwind v4 ile tek bir stylesheet'e derler ve ISR
yerine süreç belleğinde yaşayan, stale-while-revalidate'li bir HTML TTL cache
kullanır. React yok, TypeScript yok; düz JavaScript ve JSDoc.

Bu dizin framework'ün tam referansıdır. Sıralı okumak için baştan başlayın;
belirli bir konuyu arıyorsanız doğrudan ilgili başlığa gidin.

## Sıralı okuma

| Belge | Konu |
| --- | --- |
| [01-baslangic.md](./01-baslangic.md) | Kurulum, `jskelet init`, ilk route, ilk island, dizin yapısı, CLI komutları |
| [02-mimari.md](./02-mimari.md) | Mimari kararlar ve gerekçeleri: island modeli, tam sunucu HTML'i, cache stratejisi, middleware sırası |
| [03-routing.md](./03-routing.md) | Route modülü sözleşmesi, yükleme sırası, controller sözleşmesi, `ctx`, `notFound`/`redirect`, config redirects/rewrites |
| [04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md) | EJS layout, sayfalar, otomatik bileşen kaydı, `html`/`tags` yardımcıları, metadata → `<head>`, hook'lar |
| [05-islands.md](./05-islands.md) | `data-island` sözleşmesi, hidrasyon stratejileri, `client/entries/*`, `createStore`, DOM yardımcıları, `startSafeImages` |
| [06-cache.md](./06-cache.md) | `withHtmlCache`, `revalidate`, stale-while-revalidate, cache anahtarı, `X-JSkelet-Cache`, istek içi cache, degraded render, prewarm |
| [07-yapilandirma.md](./07-yapilandirma.md) | `jskelet.config.mjs` tam referansı, `source` desen sözdizimi, ortam değişkenleri tablosu |
| [08-build.md](./08-build.md) | Build hattı, manifest, hash'li varlıklar, CSS/Tailwind `@source`, fontlar, ikon sprite, görsel optimizasyonu, precompress |
| [09-dev-araclari.md](./09-dev-araclari.md) | `jskelet dev` akışı, watch dizinleri, CSS hot-swap, devtools overlay (Alt+D), rapor sayfası, dev gate |
| [10-dagitim.md](./10-dagitim.md) | Prod build + start, ortam değişkenleri, Docker, ters proxy, sağlık kontrolü |
| [11-tasima.md](./11-tasima.md) | Next.js'ten taşıma: karşılık tablosu ve adım adım plan |

## Konuya göre hızlı erişim

- **Bir sayfa nasıl eklenir?** → [03-routing.md](./03-routing.md) ve
  [04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md)
- **Bir butona tıklandığında bir şey olsun istiyorum** →
  [05-islands.md](./05-islands.md)
- **Sayfa neden `MISS` dönüyor / neden eski veri görüyorum?** →
  [06-cache.md](./06-cache.md)
- **Hangi config alanı ne yapıyor?** → [07-yapilandirma.md](./07-yapilandirma.md)
- **Stil çıkmıyor / ikon görünmüyor** → [08-build.md](./08-build.md)
- **Yayına alma** → [10-dagitim.md](./10-dagitim.md)

## Çalışan örnekler

Üçü de çalışır durumda; belgelerdeki örneklerin çoğu buralardan alınmıştır.

**`examples/minimal/`** — iki route, bir bileşen, bir island, minimal config.
Framework'ün en küçük çalışan hâli.

```bash
npm --prefix examples/minimal install
npm --prefix examples/minimal run dev
```

**`examples/blog/`** — dinamik route (`/blog/:slug`), etiket sayfaları,
`redirects`/`rewrites`/`headers`/`cache` yapılandırmasının tamamı, fragment ile
gelen sekme panelleri, form gönderimi, prewarm, `robots.txt`/`sitemap.xml`/`rss.xml`
ve dört island (tema, sekme, arama, form).

```bash
npm --prefix examples/blog install
npm --prefix examples/blog run dev
```

**`examples/marketing/`** — framework'ün kendi tanıtım sitesi: hero, kıyaslama
tablosu, canlı gecikme ölçümü, SSS, belgeler dizini, sürüm notları ve indirme
sayfası. Sayfadaki bayt sayıları `lib/payload.js` içinde sitenin **kendi** build
çıktısından, sürüm künyesi ise `lib/release.js` içinde kurulu paketin
`package.json`'ından okunur; gecikme sayıları `latency` island'ında tarayıcıda
ölçülür. Uzun TTL (bir saat) ve tüm sayfaları ısıtan prewarm ile, cache'in en
verimli çalıştığı profili gösterir.

Site aynı zamanda **iki dilli**: varsayılan İngilizce kökte, Türkçe `/tr`
altında ve route adları iki dilde de aynı. Framework'te i18n yok; dil
çözümlemesi `lib/i18n.js` içinde uygulamanın kendi sözleşmesi olarak duruyor ve
`hooks.layoutContext` ile bir sözlüğe bağlanıyor. Çok dilli bir siteyi bu
yüzeyle nasıl kurabileceğinizi görmek için bakılacak yer burası.

```bash
npm --prefix examples/marketing install
npm --prefix examples/marketing run dev
```

Her üç örnekte `node smoke.mjs` sunucu ayaktayken uçların beklendiği gibi
yanıt verdiğini doğrular.
