# JSkelet

SEO ve hız odaklı siteler için, framework'süz hissettiren bir framework.

Express 5 sunucuda EJS ile **tam HTML** üretir, etkileşimi vanilla JS
**island**'larla ekler, CSS'i Tailwind v4 ile **tek bir stylesheet**e derler ve
ISR yerine süreç belleğinde yaşayan, stale-while-revalidate'li bir **HTML TTL
cache** kullanır. React yok, TypeScript yok; düz JavaScript ve JSDoc.

```bash
mkdir sitem && cd sitem
npm init -y && npm pkg set type=module
npm install jskelet
npm install -D postcss @tailwindcss/postcss tailwindcss lightningcss
npx jskelet init
npx jskelet dev
```

`http://localhost:3000` sunucuda render edilmiş, önbelleğe alınmış ve island'ı
görünürlükte hidre olan bir sayfa verir.

## Neye benziyor

```js
// routes/10-pages.mjs
import { getPosts } from "../lib/posts.js";

export default function register(app, { route, notFound }) {
  app.get("/", route(
    async () => ({
      view: "pages/home",
      metadata: { title: "Ana sayfa", canonical: "/" },
      data: { posts: getPosts() },
    }),
    { revalidate: 60 }, // HTML 60 saniye önbellekte
  ));

  app.get("/blog/:slug", route(async ({ params }) => {
    const post = getPost(params.slug);
    if (!post) notFound();
    return { view: "pages/blog-post", data: { post } };
  }));
}
```

```html
<!-- views/pages/home.ejs -->
<section class="wrapper">
  <h1 class="text-3xl font-bold">Son yazılar</h1>
  <% posts.forEach(function (post) { %>
  <%- postCard({ post }) %>
  <% }); %>

  <!-- görünür olduğunda inilir ve bağlanır -->
  <div data-island="newsletter"></div>
</section>
```

## Ne veriyor

- **Sunucuda tam HTML.** İlk boyama JS beklemez; içerik tarayıcıda kurulmadığı
  için SEO'da eksiksiz görünür.
- **Island'lar.** Etkileşim `data-island` taşıyan elementlere bağlanır. Modüller
  varsayılan olarak görünürlükte, dinamik import ile inilir; `data-island-eager`
  ve `data-island-idle` ile strateji seçilir.
- **HTML TTL cache.** Route başına `revalidate`, TTL dolduğunda eski HTML anında
  döner ve tazeleme arkada yürür. Açılışta prewarm önbelleği doldurur.
- **Hızlı gezinme.** `navigation` bölümü Speculation Rules ile bağlantıları
  önden getirir ya da prerender eder ve view transition'ı açar — hiç client
  runtime'ı eklemeden.
- **Tanıdık yapılandırma.** `redirects()`, `rewrites()`, `headers()` ve `cache()`
  — `next.config` sözdiziminin fiilen kullanılan alt kümesiyle aynı.
- **Build hattı.** Fontlar, kullanılan ikonlardan üretilen SVG sprite, Tailwind
  v4 CSS, esbuild bundle'ları, webp varyantları, hash'li çıktı ve brotli/gzip
  ön sıkıştırma.
- **Dev deneyimi.** Tek komut, tek terminal: watch build + sunucu, CSS hot-swap,
  otomatik restart ve Alt+D ile açılan devtools overlay (istekler, hatalar,
  upstream çağrıları, cache dökümü, Web Vitals).
- **Hook'lar.** Metadata, layout bağlamı, 404 ve prewarm yolları uygulamadan
  gelir; framework hiçbir domain varsayımı taşımaz.

## Ne vermiyor

Bilinçli eksikler:

- Dosya sistemine dayalı routing yok — yollar açıkça yazılır.
- Streaming/RSC yok; sayfa tek parça basılır. Yavaş bölümler ayrı fragment
  uçlarından çekilir.
- Nokta atışı önbellek geçersizleme yok; TTL ve tüm önbelleği boşaltma var.
- Global state yönetimi yok; island'lar arası paylaşım için küçük bir store var.

Oturum arkasında çalışan, sayfa HTML'i cache'lenemeyen uygulama ağırlıklı
arayüzler için (dashboard, editör, yönetim paneli) bu framework yanlış seçim.
Gerekçesi ve karşılaştırma: [docs/11-tasima.md](./docs/11-tasima.md).

## Gereksinimler

- **Node.js 22+**
- Tailwind kullanacaksanız `postcss`, `@tailwindcss/postcss`, `tailwindcss`,
  `lightningcss`; ikonlar için `@phosphor-icons/core`; görsel optimizasyonu için
  `sharp`. Hepsi **opsiyonel peer bağımlılık**: kurulu değilse ilgili build
  adımı atlanır ve site çalışmaya devam eder.

## CLI

| Komut | İşi |
| --- | --- |
| `jskelet dev` | Watch build + sunucu, canlı yenileme, devtools |
| `jskelet build` | Prod build (fontlar → sprite → CSS → JS → görseller → manifest → precompress) |
| `jskelet start` | Prod sunucu; build eksikse üretir |
| `jskelet init` | Bulunduğun dizine minimal iskelet kurar |

## Belgeler

Tam referans [docs/](./docs/README.md) altında:

| Belge | Konu |
| --- | --- |
| [01-baslangic](./docs/01-baslangic.md) | Kurulum, ilk route, ilk island, dizin yapısı, CLI |
| [02-mimari](./docs/02-mimari.md) | Kararlar ve gerekçeleri, middleware sırası |
| [03-routing](./docs/03-routing.md) | Route modülleri, controller sözleşmesi, yükleme sırası |
| [04-render-ve-sablonlar](./docs/04-render-ve-sablonlar.md) | Layout, bileşenler, yardımcılar, metadata |
| [05-islands](./docs/05-islands.md) | Island sözleşmesi, hidrasyon, store, DOM yardımcıları |
| [06-cache](./docs/06-cache.md) | TTL, stale-while-revalidate, anahtar, prewarm |
| [07-yapilandirma](./docs/07-yapilandirma.md) | `jskelet.config.mjs` tam referansı |
| [08-build](./docs/08-build.md) | Build hattı, manifest, Tailwind `@source`, sprite |
| [09-dev-araclari](./docs/09-dev-araclari.md) | Dev akışı, overlay, rapor sayfası, dev gate |
| [10-dagitim](./docs/10-dagitim.md) | Prod, Docker, ters proxy, sağlık kontrolü |
| [11-tasima](./docs/11-tasima.md) | Next.js'ten taşıma: karşılık tablosu ve plan |

Yapay zekâ ajanlarıyla çalışıyorsanız [AGENTS.md](./AGENTS.md) projedeki
kuralları özetler.

## Örnekler

```bash
npm --prefix examples/minimal   install && npm --prefix examples/minimal   run dev
npm --prefix examples/blog      install && npm --prefix examples/blog      run dev
npm --prefix examples/marketing install && npm --prefix examples/marketing run dev
```

- **`examples/minimal`** — iki route, bir bileşen, bir island. En küçük çalışan hâl.
- **`examples/blog`** — dinamik route'lar, etiket sayfaları, tüm config
  bölümleri, fragment ile gelen sekmeler, form, prewarm, RSS/sitemap ve dört
  island.
- **`examples/marketing`** — framework'ün tanıtım sitesi: kıyaslama tablosu,
  uzun TTL, tüm sayfaları ısıtan prewarm. Sayfadaki bayt sayıları sitenin kendi
  build çıktısından ölçülüyor, gecikme sayıları da tarayıcıda; uydurma benchmark
  yok.

Sunucu ayaktayken `node smoke.mjs` uçların beklendiği gibi yanıt verdiğini
doğrular.

## Lisans

MIT
