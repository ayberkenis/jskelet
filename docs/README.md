# JSkelet belgeleri

JSkelet, SEO ve hız odaklı siteler için "framework'süz hissettiren" bir
framework: Express 5 + build-time `.jsk` ile sunucuda tam HTML üretir (EJS
opsiyonel legacy peer), etkileşimi vanilla JS island'larla ekler, CSS'i
Tailwind v4 ile tek bir stylesheet'e derler ve ISR yerine süreç belleğinde
yaşayan, stale-while-revalidate'li bir HTML TTL cache kullanır. React yok;
framework kaynağı düz JavaScript + JSDoc'tur. Uygulama tarafında client
island/entry'ler TypeScript yazılabilir ve paket `.d.ts` yayınlar.

Bu dizin framework'ün tam referansıdır. Sıralı okumak için baştan başlayın;
belirli bir konuyu arıyorsanız doğrudan ilgili başlığa gidin.

Aynı belgelerin İngilizcesi [`docs/en/`](./en/README.md) altında. İki sürüm elle
eşlenik tutuluyor; birini değiştiriyorsan diğerini de değiştir.

## Sıralı okuma

| Belge | Konu |
| --- | --- |
| [01-baslangic.md](./01-baslangic.md) | Kurulum, `jskelet init`, ilk route, ilk island, dizin yapısı, CLI komutları |
| [02-mimari.md](./02-mimari.md) | Mimari kararlar ve gerekçeleri: island modeli, tam sunucu HTML'i, cache stratejisi, middleware sırası |
| [03-routing.md](./03-routing.md) | Route modülü sözleşmesi, yükleme sırası, controller sözleşmesi, `ctx`, `notFound`/`redirect`, config redirects/rewrites |
| [04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md) | `.jsk` layout/sayfalar, otomatik bileşen kaydı, `html`/`tags`, metadata → `<head>`, hook'lar; EJS legacy |
| [05-islands.md](./05-islands.md) | `data-island` sözleşmesi, hidrasyon stratejileri, `client/entries/*`, `createStore`, DOM yardımcıları, `startSafeImages` |
| [06-cache.md](./06-cache.md) | `withHtmlCache`, `revalidate`, stale-while-revalidate, cache anahtarı, `X-JSkelet-Cache`, istek içi cache, degraded render, prewarm |
| [07-yapilandirma.md](./07-yapilandirma.md) | `jskelet.config.mjs` tam referansı, `source` desen sözdizimi, ortam değişkenleri tablosu |
| [08-build.md](./08-build.md) | Build hattı, manifest, hash'li varlıklar, CSS/Tailwind `@source`, fontlar, ikon sprite, görsel optimizasyonu, precompress |
| [09-dev-araclari.md](./09-dev-araclari.md) | `jskelet dev` akışı, watch dizinleri, CSS hot-swap, devtools overlay (Alt+D, SEO highlight), rapor sayfası, dev gate |
| [10-dagitim.md](./10-dagitim.md) | Prod build + start, ortam değişkenleri, Docker, ters proxy, sağlık kontrolü |
| [11-tasima.md](./11-tasima.md) | Next.js'ten taşıma: karşılık tablosu ve adım adım plan |
| [12-panel-ve-oturum.md](./12-panel-ve-oturum.md) | Kişiye özel sayfalar: `private: true`, imzalı cookie oturumu, CSRF, `fragment()`, parça takası ve form döngüsü |

## Konuya göre hızlı erişim

- **Bir sayfa nasıl eklenir?** → [03-routing.md](./03-routing.md) ve
  [04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md)
- **Bir butona tıklandığında bir şey olsun istiyorum** →
  [05-islands.md](./05-islands.md)
- **Sayfa neden `MISS` dönüyor / neden eski veri görüyorum?** →
  [06-cache.md](./06-cache.md)
- **Oturuma bağlı bir sayfa nasıl yazılır?** →
  [12-panel-ve-oturum.md](./12-panel-ve-oturum.md)
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
gelen sekme panelleri, form gönderimi, prewarm, `robots.txt`/`sitemap.xml`/`rss.xml`,
dinamik OG görselleri (`/og/blog/:slug.png`) ve dört island (tema, sekme, arama,
form).

```bash
npm --prefix examples/blog install
npm --prefix examples/blog run dev
```

**`examples/dashboard/`** — diğer ikisinin tersi eksen: kişiye özel sayfalar.
İmzalı cookie ile giriş, `private: true` korumalı panel, sayfalı tablo
fragment'i, CSRF'li mutasyon formu ve temizlik fonksiyonu döndüren bir island.
Public bir tanıtım sayfası da var, böylece aynı uygulamada önbelleklenen ve
`no-store` dönen iki yanıt yan yana görülüyor.

```bash
npm --prefix examples/dashboard install
npm --prefix examples/dashboard run dev
```

Her üç örnekte `node smoke.mjs` sunucu ayaktayken uçların beklendiği gibi
yanıt verdiğini doğrular.
