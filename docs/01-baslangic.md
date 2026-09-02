# 01 — Başlangıç

Bu belge JSkelet'i sıfırdan çalıştırmayı anlatır: paket kurulumu, `jskelet init`
ile iskeletin oluşturulması, ilk route ve ilk island'ın yazılması, oluşan dizin
yapısının ne anlama geldiği ve CLI komutları. Sonunda tarayıcıda sunucuda
render edilmiş, önbelleğe alınmış ve island'ı görünürlükte hidre olan bir sayfa
olacak. Kararların *nedenleri* için [02-mimari.md](./02-mimari.md)'ye, buradaki
her config alanının tam referansı için
[07-yapilandirma.md](./07-yapilandirma.md)'ye bakın.

## Gereksinimler

- **Node.js 22 veya üstü.** `package.json` → `engines` bunu zorunlu tutuyor.
  Framework `node:async_hooks`, `fs.readdirSync(..., { recursive: true })`,
  `--env-file-if-exists` ve `module.register()` gibi yeni Node yüzeylerini
  doğrudan kullanıyor.
- Tailwind CSS kullanacaksanız `postcss`, `@tailwindcss/postcss` ve
  `tailwindcss` paketleri. Bunlar framework'ün **opsiyonel peer
  bağımlılıkları**dır; kurulu değilse CSS adımı atlanır ve site stilsiz ama
  çalışır durumda kalır (ayrıntı: [08-build.md](./08-build.md)).

## Kurulum

```bash
mkdir benim-sitem && cd benim-sitem
npm init -y
npm pkg set type=module
npm install jskelet
npm install -D postcss @tailwindcss/postcss tailwindcss lightningcss
```

`type: "module"` şart: route modülleri, bileşenler ve config dosyası ESM olarak
yüklenir.

Ardından `package.json` içine script'leri ekleyin:

```json
{
  "scripts": {
    "dev": "jskelet dev",
    "build": "jskelet build",
    "start": "jskelet start"
  }
}
```

## `jskelet init`

```bash
npx jskelet init
```

Bu komut bulunduğunuz dizine çalışan bir minimum iskelet kurar. **Var olan
dosyaların üzerine yazmaz**: ikinci kez çalıştırmak yalnızca eksikleri
tamamlar, atlanan dosyaların sayısını uyarı olarak basar. Amaç, "kurulumu
yaptım ama hiçbir şey çalışmıyor" aşamasını tamamen atlamak — `jskelet dev`
hemen ardından çalışır.

Oluşturulan dosyalar (feature-first + `.jsk`):

```
jskelet.config.mjs                       config: brand, preconnect, cache(), hooks
features/home/index.js                   "/" route'u
features/home/views/pages/home.jsk       ana sayfa şablonu
features/home/views/components/button.js örnek bileşen (<Button />)
features/home/client/counter.js          örnek island
features/home/server/.gitkeep
views/pages/not-found.jsk                uygulama geneli 404
client/entries/main.js                   island bootstrap'ı
styles/globals.css                       Tailwind girişi + @source direktifleri
jsconfig.json                            checkJs + "@/*" alias'ı
.gitignore                               node_modules/, .jskelet/, public/assets/, .env
```

Büyümek için: `npx jskelet generate feature <name>` (veya `page` / `island`).

Sonra:

```bash
npm run dev
```

Terminalde banner, hizalı build satırları ve bir `Ready` özeti görürsünüz;
`http://localhost:3000` sayfayı verir. Sağ altta dev overlay baloncuğu durur,
`Alt+D` ile açılır ([09-dev-araclari.md](./09-dev-araclari.md)).

## Dizin yapısı

Dizin adlarının hiçbiri sabit değildir; hepsi `jskelet.config.mjs` → `paths`
ile ezilebilir. Aşağıdaki değerler varsayılanlardır (`src/config/defaults.js`).

| Dizin | Varsayılan | İçeriği |
| --- | --- | --- |
| `views` | `views` | Uygulama geneli layout, sayfalar ve bileşenler |
| `features` | `features` | Feature dilimleri (`<name>/{server,views,client}`) |
| `shared` | `shared` | Feature'lar arası paylaşılan server/views/client |
| `public` | `public` | Statik dosyalar; build çıktısı da buraya yazılır |
| `client` | `client` | Island runtime kaynakları ve entry'ler |
| `routes` | `routes` | Route modülleri (feature'lardan önce yüklenir) |
| `styles` | `styles/globals.css` | Tailwind/PostCSS giriş **dosyası** |
| `generated` | `.jskelet` | Build ara çıktıları: `manifest.json`, `metafile.json`, `images.json`, `templates/` |

Bunlara ek olarak framework iki yolu her zaman türetir ve ayrı ayar kabul
etmez: `public/assets` (hash'li build çıktısı) ve `public/fonts` (self-host
fontlar).

Tipik bir proje (`jskelet init` çıktısına yakın):

```
benim-sitem/
├── jskelet.config.mjs
├── jsconfig.json
├── features/
│   └── home/
│       ├── index.js
│       ├── server/
│       ├── views/
│       │   ├── pages/home.jsk
│       │   └── components/button.js
│       └── client/counter.js
├── views/
│   └── pages/not-found.jsk
├── client/
│   └── entries/main.js
├── styles/
│   └── globals.css
├── public/
│   └── (statik dosyalar; build → public/assets)
└── .jskelet/
    ├── manifest.json
    └── templates/
```

## İlk route

Route modülleri **dosya sistemine dayalı otomatik URL türetmez**; her modül
kendi yollarını `app.get(...)` ile açıkça yazar. Modül sözleşmesi: default
export ya da `register` adlı named export, `(app, api)` imzasıyla.

```js
// features/home/index.js
export default function register(app, { route }) {
  app.get(
    "/",
    route(
      async () => ({
        view: "pages/home",
        metadata: { title: "Ana sayfa" },
        data: { message: "JSkelet çalışıyor" },
      }),
      { revalidate: 60 },
    ),
  );
}
```

`api` nesnesi içinde `route`, `renderView`, `renderPage`, `notFound`, `redirect`
ve `permanentRedirect` hazır gelir; route dosyaları framework'ten tek tek import
yapmak zorunda kalmaz. `route()` controller'ı sarar: HTML cache'i,
notFound/redirect kontrol akışı, sıkıştırma ve `X-JSkelet-Cache` başlığı ondan
gelir. Controller'ın tek işi bir sayfa tanımı döndürmektir.

`routes/` kullanıyorsanız dosya adındaki `10-` öneki yükleme sırasını belirler;
`/:slug` gibi yakalayıcı route'ları daha yüksek numaralı bir dosyaya koyun.
Feature `index.js` dosyaları `routes/` tarandıktan sonra alfabetik eklenir.
Ayrıntı: [03-routing.md](./03-routing.md).

Şablon tarafı `.jsk` (build-time derlenir):

```html
{# features/home/views/pages/home.jsk #}
<section class="wrapper">
  <h1>{{ metadata.title }}</h1>
  <p>{{ message }}</p>
  <Button text="Örnek bileşen" />
  <div data-island="counter" data-island-props='{"start":0}'></div>
</section>
```

`Button`, `features/home/views/components/button.js` içindeki `button` named
export'undan gelir — PascalCase etiket; import gerekmez
([04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md)).

## İlk island

Island, sunucunun ürettiği HTML'e davranış ekleyen küçük bir modüldür. Sözleşme
iki parçadan oluşur.

**1. Şablonda işaret:** bir elemente `data-island="ad"` verin. Props JSON olarak
`data-island-props` içinde taşınır.

```ejs
<div data-island="counter" data-island-props='{"start":5}'></div>
```

**2. Modülde `mount`:** island `mount(element, props)` adlı bir named export
verir.

```js
// features/home/client/counter.js
/**
 * @param {HTMLElement} element
 * @param {{ start?: number }} props
 */
export function mount(element, props) {
  let value = props.start ?? 0;

  const button = document.createElement("button");
  button.type = "button";

  const paint = () => {
    button.textContent = `Tıklama: ${value}`;
  };

  button.addEventListener("click", () => {
    value += 1;
    paint();
  });

  paint();
  element.append(button);
}
```

**3. Kayıt:** `client/entries/main.js` island adını dinamik import'a bağlar ve
runtime'ı başlatır.

```js
import { registerAll, start } from "jskelet/client";

registerAll({
  counter: () => import("../../features/home/client/counter.js"),
});

start();
```

Değerlerin dinamik import olması kritik: modül yalnızca sayfada o island
gerçekten varsa **ve** element görünür hâle geldiğinde indirilir. Yani bu
haritayı büyütmek ilk yükü büyütmez. Hidrasyon stratejileri
(`data-island-eager`, `data-island-idle`) ve runtime API'sinin tamamı
[05-islands.md](./05-islands.md)'de.

## CLI komutları

`bin/jskelet.mjs` şu alt komutları sunar. Her biri ayrı bir Node sürecinde
çalışır; sebebi `dev`in iki uzun ömürlü süreci yönetmesi ve sunucunun ESM
resolve hook'larına (`--import`) süreç başlangıcında ihtiyaç duyması.

| Komut | Ne yapar |
| --- | --- |
| `jskelet dev` | Build watch + sunucu, tek terminalde. Canlı yenileme, CSS hot-swap, dev overlay. `NODE_ENV=development`. |
| `jskelet build` | Tek seferlik prod build: fontlar → ikon sprite → CSS → client JS → görseller → manifest → precompress. `NODE_ENV` verilmemişse `production`. |
| `jskelet start` | Prod sunucu. Build çıktısı yoksa önce üretir. `NODE_ENV` verilmemişse `production`. |
| `jskelet init` | Bulunduğun dizine feature-first `.jsk` iskeleti kurar; var olan dosyalara dokunmaz. |
| `jskelet generate` | `feature` / `page` / `island` iskeleti üretir. |

Bilinmeyen bir komut ya da argümansız çağrı kullanım metnini basar.

Her komut iki Node bayrağıyla çalışır:

- `--env-file=.env` — yalnızca dosya gerçekten varsa geçilir; yoksa hiçbir
  bayrak eklenmez ve uyarı basılmaz.
- `--import <register.mjs>` — `jsconfig.json` / `tsconfig.json` içindeki
  `compilerOptions.paths` alias'larını (`@/lib/x`) ve uzantısız göreli
  import'ları (`./cache` → `./cache.js`) çözen ESM hook'larını kurar.
  (`jskelet dev` bu hook'ları kendi alt süreçlerinde kurar, dış süreçte kurmaz.)

## İthal yolları

`package.json` → `exports` haritası kararlı yüzeyi tanımlar. Örneklerde
yalnızca bu belirteçleri kullanın:

| Belirteç | İçeriği |
| --- | --- |
| `jskelet` | Sunucu API'si: `route`, `renderPage`, `renderView`, `renderNotFound`, `createApp`, `startServer`, `notFound`, `redirect`, `permanentRedirect`, `cache`, `withRequestCache`, `reportUpstreamFailure`, `asset`, `hasAsset`, `optimizedImage`, `getSpriteIds`, `headHints`, `renderHeadMeta`, HTML cache fonksiyonları, `prewarm`, `createProxy`, `getConfig`, `loadConfig` ve html/tag yardımcıları |
| `jskelet/server` | `jskelet` ile aynı modül (okunurluk için takma ad) |
| `jskelet/client` | Tarayıcı runtime'ı: `register`, `registerAll`, `hydrate`, `observeDocument`, `start`, `createStore`, DOM yardımcıları, `startSafeImages` |
| `jskelet/html` | `esc`, `attrs`, `cx`, `cn`, `jsonScript` |
| `jskelet/tags` | `link`, `image`, `icon`, `preloadImage`, `toKebab` |
| `jskelet/log` | Konsol çıktısı yardımcıları (`banner`, `event`, `task`, `size`, `ms`, …) |
| `jskelet/register` | `node --import jskelet/register` ile alias + uzantı hook'ları |
| `jskelet/layout` | Framework'ün varsayılan `layout.ejs` dosyasının yolu |

## Sırada ne var

- Neden bu şekilde çalışıyor: [02-mimari.md](./02-mimari.md)
- Daha fazla route ve yakalayıcı desenler: [03-routing.md](./03-routing.md)
- Layout'u devralmak ve metadata: [04-render-ve-sablonlar.md](./04-render-ve-sablonlar.md)
- Önbelleği ayarlamak: [06-cache.md](./06-cache.md)
