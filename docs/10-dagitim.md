# 10 — Dağıtım

Bu belge bir JSkelet uygulamasını yayına almayı anlatır: prod build ve start
akışı, ayarlanması gereken ortam değişkenleri, çalışan bir Docker kurulumu, ters
proxy ve `trust proxy` notları, sağlık kontrolü ucunun nasıl eklendiği ve
ölçekleme sırasında önbelleğin nasıl davrandığı. Build adımlarının içeriği
[08-build.md](./08-build.md)'de, önbellek davranışı [06-cache.md](./06-cache.md)'de.

## Prod akışı

```bash
npm ci
npm run build     # jskelet build
npm start         # jskelet start
```

`jskelet build` `NODE_ENV` verilmemişse `production` ayarlar ve tüm adımları
çalıştırır: fontlar, ikon sprite, CSS, client JS, görseller, manifest,
precompress.

`jskelet start` önce `.jskelet/manifest.json` dosyasına bakar; yoksa build'i
kendisi çalıştırır. Docker imajında build zaten yapıldığı için bu bir no-op;
amaç `npm start`ı doğrudan çalıştıran birinin stilsiz bir sayfayla
karşılaşmaması.

Sunucu hazır olduğunda tek satır basar:

```
jskelet → http://localhost:3000 (production)
```

Süreç iki güvenlik ağıyla korunur: `unhandledRejection` ve `uncaughtException`
loglanır ve süreç ayakta kalır. Bir haber sitesinde tek sayfanın hatası tüm
siteyi indirmemeli. Kendi hata izleme aracınıza (Sentry vb.) bağlanmak
istiyorsanız aynı olaylara kendi dinleyicinizi de ekleyebilirsiniz.

## Ortam değişkenleri

Zorunlu hiçbir değişken yok; hepsinin makul bir varsayılanı var. Prod'da
ayarlamayı düşünmeniz gerekenler:

| Değişken | Öneri | Neden |
| --- | --- | --- |
| `NODE_ENV` | `production` | Şablon cache'i, manifest'in bir kez okunması, bozuk route modülünde fırlatma |
| `PORT` | `3000` | Orkestratörünüzün beklediği port |
| `HOST` | `0.0.0.0` | Kapsayıcı içinde dışarıdan erişim için (varsayılan) |
| `PREWARM_MAX` | Site boyutuna göre | Açılışta ısıtılacak sayfa sayısı |
| `PREWARM_INTERVAL_SECONDS` | `0` ya da uzun bir değer | Hiç ziyaret edilmeyen sayfaları sıcak tutmak isterseniz |
| `DEV_TOKEN` | Yalnızca staging'de | Yayına açılmamış ortamı gizler |

Tam liste ve prewarm ayarlarının öncelik sırası:
[07-yapilandirma.md](./07-yapilandirma.md).

CLI `--env-file-if-exists=.env` ile çalıştığı için `.env` dosyası varsa otomatik
yüklenir; yoksa hata verilmez. Kapsayıcıda genelde bu dosya yerine ortam
değişkenleri doğrudan enjekte edilir. İki kaynağı birlikte kullanmak hangi
değerin geçerli olduğunu belirsizleştirir; prod imajında `.env` bulundurmamak en
temizidir.

**Gizli anahtarlar `clientEnv` listesine konmamalıdır:** oradaki değerler client
bundle'a düz metin olarak gömülür ([08-build.md](./08-build.md)).

## Docker

Çok aşamalı bir imaj: build aşaması dev bağımlılıklarıyla derler, çalışma
aşaması yalnızca üretim bağımlılıklarını ve build çıktısını taşır.

```dockerfile
# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Bağımlılıklar ayrı katmanda: kaynak değişince yeniden kurulum yapılmasın.
COPY package.json package-lock.json ./
RUN npm ci

# `public/fonts/` commit edilmiş olmalı: build'in ağa çıkması gerekmesin.
COPY . .

ENV NODE_ENV=production
RUN npx jskelet build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
# sharp ve tailwind yalnızca build zamanı gerekli; çalışma imajına girmesin.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/jskelet.config.mjs ./jskelet.config.mjs
COPY --from=build /app/jsconfig.json ./jsconfig.json
COPY --from=build /app/routes ./routes
COPY --from=build /app/views ./views
COPY --from=build /app/lib ./lib
COPY --from=build /app/public ./public
COPY --from=build /app/.jskelet ./.jskelet

# Root olmayan kullanıcı.
USER node

EXPOSE 3000

# Sağlık kontrolü: aşağıdaki route'u eklediğinizi varsayar.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthcheck').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "jskelet", "start"]
```

Notlar:

- **`client/` ve `styles/` çalışma imajına gerekmez:** çıktıları
  `public/assets/` altında. `views/` ve `routes/` gerekir, çünkü render çalışma
  anında yapılıyor. `lib/` yalnızca projenizde varsa kopyalayın.
- **`.jskelet/` gerekir:** `manifest.json` olmadan `asset()` hash'li URL'leri
  bulamaz ve `jskelet start` build'i baştan çalıştırmaya kalkar.
- **`sharp` çalışma imajında gerekmez:** yalnızca build zamanı görsel
  optimizasyonu için. `--omit=dev` ile dışarıda kalır (devDependency olarak
  kurulmuşsa).
- `jskelet start`ı `npx` olmadan çağırmak isterseniz
  `CMD ["node", "node_modules/jskelet/bin/jskelet.mjs", "start"]` de çalışır.

`.dockerignore`:

```
node_modules
.git
.jskelet
public/assets
.env
```

Build aşaması `npx jskelet build` ile bunları kendisi üretir.

### Depo alt dizininden dağıtım

Bu depodaki örnekler jskelet'i npm'den değil `"jskelet": "file:../.."` ile
alıyor. Coolify, Railway, Render gibi araçlarda "base directory" olarak
`examples/marketing` verilirse build context yalnızca o dizin olur, `../..`
context'in dışında kalır ve kurulum `npm ci`de düşer. Doğru ayar: **base
directory `/`**, Dockerfile konumu `/examples/marketing/Dockerfile`. Çalışan
örnek `examples/marketing/Dockerfile` içinde ve context'i depo kökü kabul eder:

```bash
docker build -f examples/marketing/Dockerfile -t jskelet-marketing .
docker run --rm -p 3000:3000 -e SITE_URL=https://example.com jskelet-marketing
```

Kendi uygulamanızda jskelet normal bir bağımlılık olacağı için bu kısıt yoktur;
yukarıdaki çok aşamalı imaj yeterli.

## Sağlık kontrolü

Framework hazır bir sağlık kontrolü ucu **eklemez**; kendi route'unuza koymanız
gerekir. Varsayılan `devGateBypass` listesi `/api/healthcheck` yolunu içerdiği
için bu adı kullanmak en az sürprizli seçenektir: `DEV_TOKEN` ayarlı bir ortamda
bile erişilebilir kalır.

```js
// routes/00-health.mjs
import { getHtmlCacheSize } from "jskelet";

export default function register(app) {
  app.get("/api/healthcheck", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      uptime: process.uptime(),
      cache: getHtmlCacheSize(),
    });
  });
}
```

Dosya adındaki `00-` öneki, bu route'un herhangi bir yakalayıcıdan önce
kaydedilmesini sağlar ([03-routing.md](./03-routing.md)).

Farklı bir yol kullanacaksanız `devGateBypass` listesini güncelleyin, aksi hâlde
staging'de orkestratör 404 görür:

```js
devGateBypass: ["/healthz", "/robots.txt", "/sitemap.xml", "/favicon.ico"]
```

Isıtma turu sağlık kontrolünü etkilemez: prewarm başarısız olsa bile süreç ayakta
kalır ve sayfalar (soğuk da olsa) servis edilir.

Hazırlık (readiness) ile canlılık (liveness) ayrımı gerekiyorsa ısıtmanın
durumunu de raporlayabilirsiniz:

```js
import { prewarmProgress } from "jskelet";

app.get("/api/ready", (req, res) => {
  const warmedUp = !prewarmProgress.active && prewarmProgress.finishedAt !== null;
  res.status(warmedUp ? 200 : 503).json({ warmedUp, ...prewarmProgress });
});
```

Bu ucun yolunu `prewarmSkip` ile ısıtma dışında bırakmayı unutmayın (varsayılan
`/api/` öneki zaten kapsıyor).

## Ters proxy

Express uygulaması `trust proxy`yi **açık** olarak kurar (`app.set("trust proxy", true)`).
Bunun sonuçları:

- `req.protocol` `X-Forwarded-Proto` başlığından okunur, yani proxy TLS'i
  sonlandırıyorsa `https` doğru döner.
- `req.ip` `X-Forwarded-For` zincirinden çözülür.
- `res.redirect()` ile üretilen mutlak URL'ler doğru şemayı taşır.

Bu ayar **proxy'nin bu başlıkları güvenilir biçimde yazdığını varsayar.**
Uygulamayı doğrudan internete açacaksanız istemcinin `X-Forwarded-*` başlıklarını
uydurabileceğini unutmayın; her zaman bir proxy ya da yük dengeleyici arkasında
çalıştırın ve proxy'nin gelen `X-Forwarded-For` başlığını üzerine yazdığından
emin olun.

Örnek nginx yapılandırması:

```nginx
upstream jskelet {
  server 127.0.0.1:3000;
  keepalive 32;
}

server {
  listen 443 ssl http2;
  server_name ornek.com;

  # Yanıt gövdeleri zaten sıkıştırılmış geliyor; ikinci kez sıkıştırma yapma.
  gzip off;

  location / {
    proxy_pass http://jskelet;
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection        "";

    # Sıkıştırılmış yanıt alabilmek için upstream'e ilet.
    proxy_set_header Accept-Encoding   $http_accept_encoding;
  }
}
```

Önemli noktalar:

- **Sıkıştırmayı iki kez yapmayın.** JSkelet brotli/gzip pazarlığını kendisi
  yapıyor ve önbelleklenmiş sayfalarda sıkıştırılmış gövdeyi saklıyor. nginx'in
  kendi `gzip`ini açık bırakmak brotli'yi çözüp yeniden gzip'lemeye yol açabilir.
- **`Accept-Encoding`i iletin**, yoksa uygulama sıkıştırma yapmaz ve önbellekteki
  hazır sıkıştırılmış gövdeler kullanılmaz.
- `Vary: Accept-Encoding` uygulama tarafından yazılır; proxy önbelleği bunu
  dikkate alır.

### CDN ile birlikte

Önbelleklenebilir sayfalara yazılan başlık:

```
Cache-Control: public, max-age=0, s-maxage=<revalidate>, stale-while-revalidate=60
```

`max-age=0` tarayıcıda saklamayı kapatır, `s-maxage` CDN'e süreyi bildirir. Yani
aynı tazelik modeli iki katmanda birlikte çalışır: CDN `s-maxage` boyunca kendi
kopyasını verir, süresi geçtiğinde origin'e sorar ve origin de kendi
önbelleğinden anında yanıtlar.

`X-JSkelet-Cache` başlığı hangi katmanın yanıtladığını teşhis etmeyi
kolaylaştırır; CDN'in kendi cache başlığıyla birlikte okuyun
([06-cache.md](./06-cache.md)).

Statik varlıklar (`/assets/`, `/fonts/`) `immutable` işaretli olduğu için CDN'de
süresiz tutulabilir; hash değiştiğinde URL de değişir.

## Ölçekleme

HTML önbelleği **süreç belleğinde** yaşar. Birden fazla kopya çalıştırdığınızda:

- Her kopyanın kendi önbelleği olur; bellek kullanımı kopya sayısıyla çarpılır
  (en fazla 500 girdi + sıkıştırılmış kopyaları).
- Her kopya açılışta kendi ısıtma turunu yapar. `PREWARM_MAX` ve
  `PREWARM_CONCURRENCY` değerlerini upstream API'nizin kopya sayısıyla çarpılmış
  yükü kaldırabileceği şekilde ayarlayın.
- `clearHtmlCache()` yalnızca çağrıldığı süreci etkiler. Tüm kopyaları
  temizlemek gerekiyorsa bunu orkestratör düzeyinde (yeniden başlatma) ya da
  kendi yazacağınız bir yayın mekanizmasıyla çözmeniz gerekir.
- Önünde bir CDN varsa çoğu istek origin'e hiç gelmez ve kopya başına önbellek
  farkı görünmez hâle gelir.

Tek kopyanın kapasitesini artırmak için `revalidate` sürelerini yükseltmek,
kopya eklemekten genellikle daha etkilidir: önbellek isabet oranı arttıkça
istek başına iş neredeyse sıfıra iner.

## Yayın öncesi kontrol listesi

- [ ] `NODE_ENV=production`
- [ ] `npm run build` çalıştı ve `.jskelet/manifest.json` üretildi
- [ ] `public/fonts/` içindeki woff2 dosyaları commit edilmiş
      ([08-build.md](./08-build.md))
- [ ] `styles/globals.css` içindeki `@source` direktifleri tüm şablon
      dizinlerini kapsıyor
- [ ] `hooks.notFound()` tanımlı ve 404 şablonu var
- [ ] `hooks.metadata()` içinde `siteUrl` var (göreli `canonical`lar
      mutlaklaşsın)
- [ ] `cache().html` desenleri sitenin tazelik profiline uygun
- [ ] `hooks.prewarmPaths()` en önemli sayfaları başa koyuyor
- [ ] `headers()` içinde CSP ve güvenlik başlıkları tanımlı
- [ ] Sağlık kontrolü ucu var ve `devGateBypass` listesinde
- [ ] Staging'de `DEV_TOKEN` ayarlı, prod'da **ayarlı değil**
- [ ] Ters proxy `Accept-Encoding`i iletiyor ve kendi sıkıştırmasını yapmıyor
- [ ] `clientEnv` listesinde gizli anahtar yok

## Sırada ne var

- Önbellek ayarları ve prewarm: [06-cache.md](./06-cache.md)
- Ortam değişkenlerinin tamamı: [07-yapilandirma.md](./07-yapilandirma.md)
- Next.js'ten taşıma: [11-tasima.md](./11-tasima.md)
