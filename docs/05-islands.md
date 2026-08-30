# 05 — Island'lar

Bu belge etkileşimin nasıl eklendiğini anlatır: `data-island` sözleşmesi, props
geçişi, üç hidrasyon stratejisi ve IntersectionObserver mantığı,
`client/entries/*` yapısı ve sayfa başına ek entry yükleme, runtime API'si
(`register`, `registerAll`, `hydrate`, `observeDocument`, `start`), island'lar
arası durum paylaşımı için `createStore`, DOM yardımcıları, `startSafeImages` ve
ertelenmiş panel (fragment) deseni. Modelin *neden* böyle olduğu
[02-mimari.md](./02-mimari.md)'de, bundle'ın nasıl üretildiği
[08-build.md](./08-build.md)'de.

## Sözleşme

Sunucu HTML'i tamdır; island yalnızca davranış ekler. Üç parça var.

**1. Şablonda işaret.**

```ejs
<div data-island="counter" data-island-props='{"start":5}'></div>
```

**2. Island modülü — `mount` adlı named export.**

```js
// client/islands/counter.js
/**
 * @param {HTMLElement} element
 * @param {{ start?: number }} props
 * @returns {void | (() => void)} temizlik fonksiyonu (opsiyonel)
 */
export function mount(element, props) {
  let value = props.start ?? 0;
  // …
}
```

**3. Entry'de kayıt.**

```js
// client/entries/main.js
import { registerAll, start } from "jskelet/client";

registerAll({
  counter: () => import("../islands/counter.js"),
});

start();
```

Loader'ın dinamik import olması modelin özü: modül yalnızca sayfada o island
gerçekten varsa **ve** bağlanma koşulu sağlandığında indirilir. Bu haritayı
büyütmek ilk yükü büyütmez.

## HTML attribute'ları

| Attribute | Anlamı |
| --- | --- |
| `data-island="ad"` | Bağlanacak island'ın kayıtlı adı. Zorunlu. |
| `data-island-props='{"…":…}'` | JSON props. Ayrıştırılamazsa konsola hata basılır ve `{}` geçilir. |
| `data-island-eager` | Görünürlükten bağımsız, hemen bağla. |
| `data-island-idle` | Görünür olsa bile `load` + boş zamana kadar bekle. |
| `data-island-ready="true"` | **Framework yazar.** `mount()` başarıyla döndükten sonra eklenir; CSS ve testler bunu okuyabilir. |

`data-island-props` içeriği HTML attribute'u olduğu için tek tırnakla sarmak en
kolay yoldur. Değerleri sunucuda üretiyorsanız `jsonScript()` ya da `attrs()`
kullanmak kaçış hatalarını önler:

```ejs
<div <%- attrs({ "data-island": "chart", "data-island-props": JSON.stringify({ symbol }) }) %>></div>
```

## Hidrasyon stratejileri

### Varsayılan: görünürlüğe bağlı

Her island bir `IntersectionObserver`'a verilir (`rootMargin: "200px 0px"`).
Ekranda olanlar zaten ilk gözlemde tetiklenir; ekran dışındakiler kaydırılana
kadar hiç indirilmez. Element bir kez görününce gözlemden çıkarılır.

Bağlama işi ayrıca boş zamana kaydırılır (`requestIdleCallback`,
`timeout: 500`; desteklenmiyorsa `setTimeout(fn, 0)`): aynı anda görünen çok
sayıda island tek bir uzun task'a dönüşürse TBT ve INP bozulur.

### `data-island-eager`

Görünürlük beklenmez, doğrudan bağlanır. Header davranışı, çerez bandı, tema
değiştirici gibi sayfa genelinde geçerli island'lar için.

```ejs
<header data-island="header" data-island-eager></header>
```

### `data-island-idle`

Görünür olsa bile `load` olayı tamamlanıp ana iş parçacığı boşalana kadar
bekletilir. İlk ekranda görünen ama kritik olmayan ağır modüller — örneğin
grafik kütüphanesi çeken bir mini grafik — LCP ile yarışmasın diye.

```ejs
<div data-island="sparkline" data-island-idle></div>
```

Sayfa yüklendiğinde `document.readyState` zaten `complete` ise bekleme atlanır
ve doğrudan boş zamana kaydırılır.

### Gizli elementler

`hidden` bir drawer ya da dialog'un düzen kutusu yoktur ve
`IntersectionObserver` onu **asla** bildirmez. Bu yüzden `hydrate()` ölçümleri
tek seferde okur (`getClientRects().length > 0`) ve kutusu olmayan elementleri
gözlemciye vermek yerine doğrudan bağlar. Ölçümlerin tek seferde okunması da
bilinçli: araya yazma girmediği için tek reflow olur.

Pratik sonucu: bir modal'ı `hidden` başlatabilirsiniz, island'ı yine bağlanır.

## `client/` dizini

```
client/
├── entries/
│   ├── main.js       her sayfada yüklenen ortak bootstrap
│   └── chart.js      yalnızca isteyen sayfalarda
└── islands/
    ├── counter.js
    └── chart.js
```

`client/entries/*.js` içindeki **her dosya bir esbuild entry'sidir**. `main.js`
layout tarafından her sayfada yüklenir (manifest'te varsa). Ek entry'ler
yalnızca onları isteyen sayfalarda yüklenir:

```js
// controller
return { view: "pages/markets", entries: ["chart.js"] };
```

Layout `entries` dizisindeki her adı `asset(entry)` ile çözüp bir
`<script type="module">` basar. Ad manifest anahtarıdır, yani dosya adının
kendisi (`chart.js`), hash'li hâli değil.

Kod bölme (`splitting: true`) açık: iki entry'nin paylaştığı modüller ortak bir
chunk'a çıkar ve iki kez indirilmez.

`client/islands/` bir zorunluluk değil, yalnızca yaygın düzen; island modülleri
entry'den erişilebilen herhangi bir yerde olabilir. `@/` alias'ı hem sunucuda
hem bundle'da çalışır, böylece `lib/` altındaki paylaşılan modüller aynı import
stilini kullanabilir.

## Runtime API — `jskelet/client`

### `register(name, loader)`

Tek bir island kaydeder. `loader` `Promise<{ mount }>` döndüren bir fonksiyon
olmalıdır.

```js
import { register } from "jskelet/client";

register("counter", () => import("../islands/counter.js"));
```

### `registerAll(entries)`

Nesne biçiminde toplu kayıt. Pratikte tercih edilen biçim.

```js
registerAll({
  counter: () => import("../islands/counter.js"),
  drawer: () => import("../islands/drawer.js"),
});
```

### `hydrate(root?)`

`root` (varsayılan `document`) altındaki tüm `[data-island]` elementlerini tarar
ve bağlanma stratejisine göre işler. Zaten bağlanmış elementler atlanır.

Bir island'ı elle yeniden taramak gerektiğinde (ör. kendi kodunuzla DOM
eklediyseniz) doğrudan çağırabilirsiniz:

```js
container.innerHTML = html;
hydrate(container);
```

### `observeDocument()`

`document.body` üzerine bir `MutationObserver` kurar ve sonradan DOM'a eklenen
island'ları da yakalar (infinite scroll, portal, fragment yükleme).
`MutationObserver` örneğini döndürür, böylece gerekirse `disconnect()`
edilebilir.

### `start()`

Tipik bootstrap: `DOMContentLoaded` beklenir (gerekiyorsa), sonra `hydrate()` ve
`observeDocument()` çağrılır.

```js
registerAll({ /* … */ });
start();
```

### Bağlanma davranışı ve hatalar

- Bir element aynı island adıyla **iki kez bağlanmaz**; kayıt element bazında
  `WeakMap` içinde tutulur.
- Kayıtlı olmayan bir ad için konsola uyarı basılır:
  `[island] not registered: <name>`.
- Modül import'u ya da `mount()` hata verirse konsola hata basılır
  (`[island] <name> failed to load`) ve **sayfanın kalanı etkilenmez**.
- `mount()` başarıyla dönerse elemente `data-island-ready="true"` yazılır.
- `mount()` bir temizlik fonksiyonu döndürebilir; framework onu saklar ve
  `unmount()` çağrıldığında işletir (aşağıya bakın).

### `unmount(root?)`

`root` altındaki island'ları söker: saklanan temizlik fonksiyonlarını çağırır,
`data-island-ready` işaretini kaldırır ve kaydı siler, böylece aynı düğüm
tekrar DOM'a girerse yeniden bağlanabilir. `root`'un kendisi de island olabilir.

DOM'un bir bölgesini değiştirirken çağrılması **zorunlu**:

```js
import { hydrate, unmount } from "jskelet/client";

unmount(container);
container.innerHTML = html;
hydrate(container);
```

Atlanması en kolay gözden kaçan sızıntı biçimini üretiyor. `innerHTML` ile
değiştirilen bir bölgenin island'ları DOM'dan çıkar, ama `document`/`window`
üzerine kurdukları dinleyiciler ve `setInterval`'ları yaşamaya devam eder;
birkaç takastan sonra aynı iş onlarca kez çalışır.

```js
export function mount(element) {
  const timer = setInterval(() => tick(element), 1000);
  const onResize = () => layout(element);
  window.addEventListener("resize", onResize);

  return () => {
    clearInterval(timer);
    window.removeEventListener("resize", onResize);
  };
}
```

`swap()` ve form yardımcıları `unmount()`u kendileri çağırıyor; elle DOM
değiştirdiğiniz yerlerde siz çağırıyorsunuz.

### `swap(target, url, options?)` ve `startSwapLinks(root?)`

Bir bölgeyi sunucudan gelen parçayla değiştirir: eski alt ağacı söker, içeriği
yazar, yeniden hidre eder ve odağı kaybolmuşsa geri getirir.

```html
<a href="/_fragment/satirlar?sayfa=2" data-swap="#satirlar">Sonraki</a>
```

Sunucu tarafı ve tüm seçenekler
[12-panel-ve-oturum.md](./12-panel-ve-oturum.md)'de.

### `enhanceForm(form)` ve `startForms(root?)`

`data-enhance` taşıyan formları sayfa yenilemeden gönderir; JS kapalıyken
normal POST + yönlendirme akışı çalışmaya devam eder. Sözleşmenin tamamı
[12-panel-ve-oturum.md](./12-panel-ve-oturum.md)'de.

## Durum paylaşımı: `createStore`

React Context'in yerine kullanılan minimal pub/sub. `useSyncExternalStore`
köprüsünün yerini alır: doğrudan `subscribe`.

```js
// client/stores/theme.js
import { createStore } from "jskelet/client";

export const theme = createStore("light");
```

```js
// client/islands/theme-toggle.js
import { theme } from "../stores/theme.js";

export function mount(element) {
  const paint = (value) => {
    element.textContent = value === "light" ? "Koyu tema" : "Açık tema";
  };

  const unsubscribe = theme.subscribe(paint);
  paint(theme.get());

  element.addEventListener("click", () => {
    theme.set((prev) => (prev === "light" ? "dark" : "light"));
  });

  return unsubscribe;
}
```

API:

| Üye | Davranış |
| --- | --- |
| `get()` | Anlık değer |
| `set(next)` | Değer ya da `(prev) => next` fonksiyonu. Değer **aynıysa** (`===`) dinleyiciler tetiklenmez. |
| `subscribe(listener)` | Dinleyici ekler, kaldıran fonksiyonu döndürür. Abone olurken mevcut değerle çağrılmaz — ilk boyamayı kendiniz yapın. |

## DOM yardımcıları

`jskelet/client` island'ların paylaştığı küçük bir yardımcı seti verir.

| Fonksiyon | İmza | Davranış |
| --- | --- | --- |
| `qs` | `(root, selector) => HTMLElement \| null` | `querySelector` |
| `qsa` | `(root, selector) => HTMLElement[]` | `querySelectorAll`, gerçek dizi olarak |
| `on` | `(target, type, handler, options?) => () => void` | Dinleyici ekler ve **kaldıran fonksiyonu döndürür** |
| `onClick` | `(root, selector, handler) => () => void` | Delege edilmiş click; `handler(event, target)` |
| `debounce` | `(ms, fn) => fn` | Son çağrıdan `ms` sonra çalışır |
| `raf` | `(fn) => fn` | Çağrıları tek bir `requestAnimationFrame`'de birleştirir |
| `toggleClass` | `(element, name, active) => void` | `classList.toggle` |
| `getOverlayRoot` | `() => HTMLElement` | `#jskelet-overlays` ya da `body` |

`on()` ve `onClick()`'in kaldırıcı döndürmesi, `mount()`'un temizlik
fonksiyonuyla doğal olarak eşleşir:

```js
import { on, onClick, raf } from "jskelet/client";

export function mount(element) {
  const offClick = onClick(element, "[data-tab]", (event, target) => {
    selectTab(target.dataset.tab);
  });

  const offScroll = on(window, "scroll", raf(() => updateShadow(element)), {
    passive: true,
  });

  return () => {
    offClick();
    offScroll();
  };
}
```

`getOverlayRoot()` modal/drawer içeriğini taşımak için: layout'ta
`<div id="jskelet-overlays"></div>` varsa oraya, yoksa `body`ye. Portal,
`overflow` ya da `transform` taşıyan bir ata elementin `position: fixed`
overlay'i kırpmasını engeller.

## `startSafeImages()`

Yüklenemeyen görseller için tek bir belge dinleyicisi. **Bilinçli olarak island
değildir:** görsel ağırlıklı bir sayfada 80+ `<img>` olabiliyor ve her birine
ayrı island bağlamak (gözlemci + dinamik import + mount) sırf hata ihtimali için
ciddi bir hidrasyon yükü.

```js
// client/entries/main.js
import { registerAll, start, startSafeImages } from "jskelet/client";

registerAll({ /* … */ });
startSafeImages();
start();
```

Kullanım, şablon tarafında:

```ejs
<%# 1. Minimal: framework ölçüleri koruyan bir blokla değiştirir %>
<img src="/kapak.png" alt="Kapak" width="640" height="360" data-safe-image>

<%# 2. Kendi hata görünümü %>
<div data-safe-image-host>
  <img src="/kapak.png" alt="Kapak" data-safe-image>
  <template data-safe-image-fallback>
    <div class="flex h-40 items-center justify-center bg-slate-100">Görsel yok</div>
  </template>
</div>
```

Nasıl çalışır:

- Belgeye **yakalama fazında** tek bir `error` dinleyicisi kurulur. `error`
  olayı kabarmaz ama yakalama fazında görülebilir; bu yüzden tek dinleyici tüm
  görselleri karşılar ve sonradan DOM'a eklenenler de kendiliğinden kapsanır.
- `data-safe-image-host` sarmalayıcısı **ve** içinde
  `<template data-safe-image-fallback>` varsa sarmalayıcının tamamı template
  içeriğiyle değiştirilir. Framework hiçbir stil dayatmaz.
- Yoksa görselin yerine minimal bir blok konur: `role="img"`, `alt` (ya da
  `data-fallback-label`) değeri `aria-label` olarak, görselin `className`i artı
  `data-fallback-class`, ve `width`/`height` varsa aynı ölçüler inline style
  olarak. Ölçülerin korunması değiştirme sırasında düzen kaymasını (CLS)
  önler.
- JS çalışmadan önce başarısız olmuş görseller olay üretmez; bu yüzden bir kez
  tarama yapılır (`requestIdleCallback`, `timeout: 2000`): `complete` olup
  `naturalWidth === 0` olanlar değiştirilir.

## Ertelenmiş panel (fragment) deseni

Ağır ve ikincil bir bölümü (yorumlar, ilgili haberler, uzun bir tablo) ilk HTML
yanıtından tamamen çıkarmak istediğinizde island + layout'suz render birleşimi
kullanılır. Framework'te bunun için özel bir API yok; iki hazır parçanın
kombinasyonu:

**1. Sunucuda layout'suz bir fragment ucu** (`renderView`, bkz.
[03-routing.md](./03-routing.md)):

```js
// routes/80-fragments.mjs
export default function register(app, { renderView }) {
  app.get("/_fragment/yorumlar/:id", async (req, res) => {
    const comments = await getComments(req.params.id);
    res.type("html").send(await renderView("fragments/comments", { comments }));
  });
}
```

**2. Sayfada bir yer tutucu island.** Görünürlüğe bağlı bağlandığı için,
ziyaretçi o bölüme kaydırmazsa ne modül ne de fragment indirilir:

```ejs
<div data-island="deferred" data-island-props='{"src":"/_fragment/yorumlar/42"}'></div>
```

**3. Island fragment'ı çekip yerleştirir ve içindeki island'ları hidre eder:**

```js
// client/islands/deferred.js
import { hydrate } from "jskelet/client";

export async function mount(element, { src }) {
  try {
    const response = await fetch(src, { headers: { accept: "text/html" } });
    if (!response.ok) return;

    element.innerHTML = await response.text();
    hydrate(element);
  } catch {
    // İkincil içerik: sessizce vazgeç, sayfanın kalanı etkilenmesin.
  }
}
```

`observeDocument()` zaten çalışıyorsa son satırdaki `hydrate()` çağrısı
gereksizdir; yine de açıkça çağırmak, `start()` kullanmayan bir kurulumda da
doğru davranmasını sağlar.

Fragment yolları için `/_fragment/` öneki önerilir: varsayılan `prewarmSkip`
listesinde olduğu için ısıtma turu bu uçları taramaz
([06-cache.md](./06-cache.md)).

## Ortam değişkenleri ve `clientEnv`

Tarayıcıda `process` yoktur, ama sunucuyla paylaşılan modüller yine de
`process.env` okuyabilir. `jskelet.config.mjs` → `clientEnv` ile bildirilen
anahtarlar build zamanında bundle'a gömülür:

```js
export default {
  clientEnv: ["PUBLIC_WS_URL", "PUBLIC_CDN"],
};
```

Next'teki `NEXT_PUBLIC_*` ile aynı sözleşme, ama hangi anahtarın herkese açık
olduğu isimden değil config'ten belli. `process.env`in tamamı tek nesne olarak
define edilir, yani listede olmayan bir anahtar okunduğunda çökme yerine
`undefined` döner. `NODE_ENV` her zaman gömülür.

## Tarayıcı desteği

Bundle hedefi sabittir: `chrome111`, `edge111`, `firefox111`, `safari16.4`. ESM
+ dinamik import + `IntersectionObserver` island modelinin zaten alt sınırı;
daha eskisine transpile etmek çıktıyı büyütüp hiçbir ziyaretçi kazandırmıyor.
JS hiç çalışmasa da sunucu HTML'i tam olduğu için sayfa okunur kalır.

## Sırada ne var

- Bundle, hash'ler ve `entries` manifest'i: [08-build.md](./08-build.md)
- `entries` alanının controller tarafı: [03-routing.md](./03-routing.md)
- Island durumunu dev panelinden izlemek: [09-dev-araclari.md](./09-dev-araclari.md)
