/**
 * Express uygulamasını kurar ve dinlemeye başlar.
 *
 * Middleware **sırası** bu dosyanın asıl değeri; her konumun bir sebebi var
 * ve yer değiştirmek sessiz bozulmalara yol açıyor:
 *
 *   1. rewrites(beforeFiles) — statik dosyalardan da önce çalışmalı, yoksa
 *      `/assets/x.js` yolunu başka bir yere taşıyan kural işlemez.
 *   2. compression — static'ten önce; sonra gelirse statik dosyalar sıkışmaz.
 *   3. headers → devGate → redirects → trailingSlash — gate'in 404'ü
 *      redirect'ten önce; trailingSlash config redirects'ten sonra, böylece
 *      açık kurallar istenen yolu önce görür.
 *   4. staticPrecompressed → express.static — build'de üretilmiş `.br`/`.gz`
 *      kopyalar varsa onlar servis edilir (kalite 11), yoksa istek altındaki
 *      static'e düşer ve middleware anında sıkıştırır (kalite 5).
 *   4b. admin paneli (açıksa) — statikten sonra, route'lardan önce: kendi
 *      gövde ayrıştırıcısını taşır ve uygulama yolunu gölgeleyemez.
 *   5. body parser'lar — statikten sonra: görsel isteklerinde gövde ayrıştırma
 *      maliyeti ödenmesin.
 *   6. csrf — body parser'lardan sonra olmalı: token form alanından okunuyor.
 *      Rewrite'lardan önce, çünkü kontrol istemcinin gördüğü yola bakar.
 *   7. rewrites(afterFiles) — statik denendikten sonra, sayfalardan önce.
 *   8. route'lar → 404 → hata yönetimi.
 */
import path from "node:path";
import process from "node:process";
import express from "express";
import { compression } from "./middleware/compression.js";
import { headersMiddleware } from "./middleware/headers.js";
import { csrf } from "./middleware/csrf.js";
import { staticPrecompressed } from "./middleware/static-precompressed.js";
import { devGate } from "./middleware/dev-gate.js";
import { redirects } from "./middleware/redirects.js";
import { trailingSlash } from "./middleware/trailing-slash.js";
import { configRewrites } from "./middleware/upstream-proxy.js";
import { getConfig, loadConfig } from "../config/index.js";
import { IMMUTABLE_CACHE } from "../config/defaults.js";
import { registerRoutes } from "./router.js";
import { renderNotFound } from "./render.js";
import { renderStatusPage, statusFromError } from "./status-page.js";
import { isPrewarmRequest, notePrewarmError, startPrewarm } from "./prewarm.js";
import { trackUpstreamFetch } from "./upstream-tracking.js";
import { configureUpstreamLimiter } from "./upstream-limiter.js";
import { connectRedis, disconnectRedis } from "./redis.js";
import { isNotFoundError, isRedirectError } from "../http/control-flow.js";

/**
 * @param {{ root?: string, configFile?: string }} [options]
 * @returns {Promise<import('express').Express>}
 */
export async function createApp(options = {}) {
  // Config middleware'lerden önce okunur; yoksa uyarı basar, akış durmaz.
  await loadConfig(options);
  const config = getConfig();

  // Upstream hatalarının izlenmesi route'lardan önce kurulmalı: sarmalayıcı
  // yalnızca render bağlamı içindeki `fetch` çağrılarına bakar, ama bağlamın
  // ilk kurulduğu istek de kapsanmalı.
  if (config.trackUpstream) trackUpstreamFetch();

  // Hız freni sarmalayıcının içinden okunuyor; ayarı ona vermek yeterli.
  // `cache().upstream.rate` verilmedikçe hiçbir istek beklemez.
  configureUpstreamLimiter(config.upstream);

  // Önbelleğin ikinci kademesi route'lardan önce kurulmalı: ilk istek de
  // paylaşımlı kopyayı görebilsin. Bağlanamazsa uyarı basılır ve uygulama
  // bellek içi önbellekle çalışmaya devam eder — middleware sırasına
  // dokunmayan, tamamen opsiyonel bir adım.
  await connectRedis(config);

  const app = express();

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Powered-By", config.brand.poweredBy);
    next();
  });

  app.set("etag", "strong");
  // Ters proxy arkasında doğru protokol ve istemci IP'si için. Doğrudan
  // internete açık bir sunucuda kapatılmalı: açıkken istemci kendi
  // `X-Forwarded-For` başlığını uydurabilir ve rate limit ile audit log
  // yanlış IP görür.
  app.set("trust proxy", config.security.trustProxy);

  app.use(configRewrites("beforeFiles"));
  app.use(compression());
  app.use(headersMiddleware());
  app.use(devGate());
  app.use(redirects());
  app.use(trailingSlash());

  app.use(staticPrecompressed(config.dirs.public));
  app.use(
    express.static(config.dirs.public, {
      index: false,
      redirect: false,
      // Hash'siz dosyalar (favicon, robots eki, elle konmuş görseller) içerik
      // değişse de aynı adla kalıyor; bir yıllık cache onları güncellenemez
      // hâle getiriyordu. Hash'li çıktı aşağıda ayrıca immutable işaretlenir.
      maxAge: "1h",
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", IMMUTABLE_CACHE);
        }
      },
    }),
  );

  // Dev overlay yalnızca development'ta; dinamik import sayesinde prod
  // sürecine hiçbir şey yüklenmez.
  if (process.env.NODE_ENV === "development") {
    const { mountDevtools } = await import("./dev/devtools.js");
    mountDevtools(app);
  }

  // Yönetim paneli ortama bakmaz, config'e bakar: açıkça etkinleştirilmedikçe
  // modül hiç yüklenmez ve yol da yoktur. Kendi gövde ayrıştırıcısını
  // taşıdığı için aşağıdaki parser'lardan önce durabiliyor; route'lardan
  // önce olması gerekiyor ki uygulama aynı yolu gölgeleyemesin.
  if (config.admin.enabled) {
    const { mountAdmin } = await import("./admin/mount.js");
    mountAdmin(app);
  }

  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  app.use(express.json({ limit: "256kb" }));

  app.use(csrf());

  app.use(configRewrites("afterFiles"));

  await registerRoutes(app);

  app.use(async (req, res, next) => {
    try {
      res.status(404).type("html").send(await renderNotFound());
    } catch (error) {
      next(error);
    }
  });

  // Hata yönetimi: notFound/redirect kontrol akışı burada da yakalanır,
  // çünkü bir controller dışında (ör. middleware içinde) fırlatılabilir.
  app.use(async (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (isRedirectError(error)) {
      res.redirect(error.statusCode, error.location);
      return;
    }

    if (isNotFoundError(error)) {
      res.status(404).type("html").send(await renderNotFound());
      return;
    }

    const status = statusFromError(error);
    // Isıtma turunun hataları tek tek loglanmaz; tur bitince özet olarak
    // basılır. Yüzlerce yolu tarayan bir tur, upstream bir an tıksırdığında
    // logu yığın izleriyle dolduruyordu.
    if (isPrewarmRequest(req)) notePrewarmError(status, error);
    else console.error(`[${status}] ${req.method} ${req.originalUrl}`, error);

    // Hata sayfası hiçbir katmanda saklanmamalı: geçici bir upstream arızası
    // CDN'de dakikalarca yaşayan bir 500 sayfasına dönüşmesin.
    res.setHeader("Cache-Control", "no-store");
    res
      .status(status)
      .type("html")
      .send(await renderStatusPage(status, { error }));
  });

  return app;
}

/**
 * Uygulamayı kurup dinlemeye başlar. CLI `jskelet start` bunu çağırır;
 * gömülü kullanımda `createApp()` tercih edilir.
 *
 * @param {{ root?: string, configFile?: string, port?: number, host?: string }} [options]
 * @returns {Promise<import('http').Server>}
 */
export async function startServer(options = {}) {
  const app = await createApp(options);
  const port = Number(options.port ?? process.env.PORT ?? 3000);

  // Varsayılan `::`, `0.0.0.0` değil: ikisi de "tüm arayüzler" demek, ama
  // yalnızca IPv6 soketi çift yığın çalışır ve `localhost`un `::1`e çözüldüğü
  // durumu da kapsar. Tarayıcılar `localhost` için önce `::1` deniyor; sıradan
  // isteklerde IPv4'e düşüyorlar ama WebSocket el sıkışması bu geri düşüşü
  // yapmadan "failed" veriyordu. IPv6'sı olmayan bir makinede bağlama hata
  // verir; aşağıda IPv4'e dönülür.
  const host = options.host ?? process.env.HOST ?? null;

  // Tek bir istek hatası süreci düşürmesin; logla ve ayakta kal. Bir haber
  // sitesinde tek sayfanın hatası tüm siteyi indirmemeli.
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("[uncaughtException]", error);
  });

  // Dev panelinin canlı kanalı: el sıkışma `upgrade` olayında geçtiği için
  // middleware zincirine değil, doğrudan sunucuya bağlanır. Modül `listen`den
  // önce yüklenir; dinleme başladıktan sonra beklenen bir `await` kalırsa ilk
  // upgrade isteği dinleyici yokken gelip reddedilebiliyor.
  const attachDevSocket =
    process.env.NODE_ENV === "development"
      ? (await import("./dev/devtools.js")).attachDevSocket
      : null;

  return new Promise((resolve, reject) => {
    /** @param {string} address */
    const listen = (address) => {
      const server = app.listen(port, address, () => {
        // Bu satırın biçimi sözleşme: `jskelet dev` sunucunun hazır olduğunu
        // buradan anlar ve özet satırını ona göre basar.
        console.log(
          `jskelet → http://localhost:${port} (${process.env.NODE_ENV ?? "production"})`,
        );
        startPrewarm({ port });
        attachShutdown(server);
        resolve(server);
      });

      server.on("error", (error) => {
        // IPv6 desteklenmiyorsa yalnızca varsayılan adres için IPv4'e dönülür;
        // kullanıcı bir adres verdiyse sessizce başkasını dinlemek yanlış olur.
        if (!host && isAddressUnsupported(error)) {
          listen("0.0.0.0");
          return;
        }
        reject(error);
      });

      attachDevSocket?.(server);
    };

    listen(host ?? "::");
  });
}

/**
 * `SIGTERM`/`SIGINT` sonrası düzenli kapanış.
 *
 * Kapatılması gereken tek dış bağlantı Redis ve `quit` uçuştaki komutların
 * bitmesini bekliyor; sert `disconnect` yarıda kalan bir `SET` bırakabiliyor.
 *
 * Açık HTTP bağlantıları **beklenmez**. `close()` tek başına yalnızca yeni
 * bağlantıyı reddediyor; keep-alive bir istemci ya da dev panelinin
 * WebSocket'i sunucuyu süresiz ayakta tutuyor ve Ctrl+C yanıt vermiyormuş gibi
 * görünüyordu. Sinyal geldiğinde ters proxy zaten trafik göndermiyor.
 *
 * Yine de bir zamanlayıcı var: Redis kapanışı askıda kalırsa süreç `SIGKILL`
 * beklemek zorunda kalmasın.
 *
 * @param {import('http').Server} server
 */
function attachShutdown(server) {
  let closing = false;

  const shutdown = () => {
    // İkinci sinyal beklemeyi kısa kessin: kullanıcı Ctrl+C'ye tekrar bastıysa
    // gerçekten çıkmak istiyor.
    if (closing) process.exit(0);
    closing = true;

    const timer = setTimeout(() => process.exit(0), 3000);
    timer.unref();

    server.close();
    server.closeAllConnections?.();

    void disconnectRedis().finally(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

/**
 * @param {NodeJS.ErrnoException} error
 * @returns {boolean} adres ailesi bu makinede kullanılamıyor mu
 */
function isAddressUnsupported(error) {
  return error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL";
}
