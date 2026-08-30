/**
 * Sunucu açılışında sayfaları önden render edip HTML cache'ini doldurur.
 *
 * Next'teki build-time prerender'ın karşılığı, ama çıktı diske yazılmaz:
 * HTML cache süreç belleğinde yaşadığı için ısıtma da süreç ayağa kalkınca
 * yapılır. Kazanç aynı — ilk ziyaretçi soğuk render'ı beklemez — fakat veri
 * dondurulmaz: her girdi route'un `revalidate` süresiyle yaşlanır ve
 * stale-while-revalidate ile arkada tazelenir.
 *
 * Isıtma gerçek HTTP istekleriyle yapılır: cache anahtarı, sıkıştırma ve
 * middleware zinciri normal trafikle bire bir aynı olsun. Hangi yolların
 * ısıtılacağını uygulama `hooks.prewarmPaths()` ile bildirir; genelde
 * sitemap üreten fonksiyonun aynısıdır.
 *
 * On binlerce yolluk bir sitede tur bir "damla damla" tarayıcıya dönüşür:
 * `priority` desenleri her turda başa alınır, geri kalan kuyruk turlar
 * arasında kaldığı yerden devam eder (`rotate`) ve `rps` toplam hızı upstream
 * kotasının altında tutar. Amaç, kimse gelmese bile hiçbir sayfanın soğuk
 * kalmaması — ama bunu API'yi düşürmeden yapmak.
 */
import process from "node:process";
import { getConfig, hook } from "../config/index.js";

/**
 * Isıtmanın canlı durumu. Dev araçları bunu okuyup ilerlemeyi gösterir;
 * üretimde kimse okumazsa da maliyeti bir nesnedir.
 */
export const prewarmProgress = {
  active: false,
  done: 0,
  total: 0,
  ok: 0,
  failed: 0,
  /** @type {number | null} */
  startedAt: null,
  /** @type {number | null} */
  finishedAt: null,
  /**
   * Denenen her yolun sonucu; dev panelindeki Prewarming sekmesi bunu listeler.
   * @type {{ path: string, status: number, ms: number, bytes: number,
   *   cache: string | null, error: string | null }[]}
   */
  entries: [],
};

/** @param {unknown} value @param {number} fallback */
function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Ayar sırası: ortam değişkeni → `jskelet.config.mjs` → kod varsayılanı.
 * Env önde, çünkü tek seferlik deneyler config'i düzenlemeden yapılabilsin.
 *
 * @param {string} envKey
 * @param {string} configKey
 * @param {number} fallback
 * @returns {number}
 */
function setting(envKey, configKey, fallback) {
  return num(process.env[envKey], num(getConfig().prewarm?.[configKey], fallback));
}

/**
 * @returns {Promise<string[]>}
 */
async function collectPaths() {
  const { prewarmSkip } = getConfig();
  const paths = await hook("prewarmPaths", []);

  if (!Array.isArray(paths)) {
    console.warn("[prewarm] hooks.prewarmPaths() must return an array, ignoring it");
    return [];
  }

  // Tekilleştirme sırayı korur: liste `PREWARM_MAX` ile budandığı için
  // uygulamanın verdiği öncelik sırası anlamlıdır.
  return [...new Set(paths)].filter(
    (candidate) =>
      typeof candidate === "string" &&
      candidate.startsWith("/") &&
      !prewarmSkip.some((prefix) => candidate.startsWith(prefix)),
  );
}

/**
 * `cache().prewarm.priority` desenlerine göre sıralar. Eşleşmeyen yollar
 * listenin sonuna, kendi aralarındaki sırayı koruyarak gider — uygulamanın
 * verdiği sıra hâlâ anlamlı olsun.
 *
 * @param {string[]} paths
 * @returns {{ head: string[], tail: string[] }}
 *   `head` öncelikli yollar (her turda ısıtılır), `tail` geri kalan kuyruk
 *   (turlar arasında dolaşılır).
 */
function byPriority(paths) {
  const rules = getConfig().prewarmPriority;
  if (!rules.length) return { head: [], tail: paths };

  /** @type {string[][]} */
  const buckets = rules.map(() => []);
  /** @type {string[]} */
  const tail = [];

  for (const candidate of paths) {
    const rank = rules.findIndex((rule) => rule.test(candidate));
    if (rank === -1) tail.push(candidate);
    else buckets[rank].push(candidate);
  }

  return { head: buckets.flat(), tail };
}

/**
 * Kuyruğun kaldığı yer. Periyodik turlar listeyi baştan ısıtıp aynı ilk
 * `max` yolu tekrar tekrar tazelemesin: her tur bir sonraki dilimi alır ve
 * yeterli tur sonunda liste baştan sona ısınır.
 */
let queueCursor = 0;

/**
 * Bir turda ısıtılacak dilimi seçer: önce `priority` eşleşenler, sonra
 * kuyruğun sırası gelen parçası. Dışa açık olması bilinçli — sıralama ve
 * rotasyon, tur çalışmadan doğrulanabilen tek davranış.
 *
 * @param {string[]} all
 * @param {number} limit
 * @param {boolean} rotate
 * @returns {string[]}
 */
export function selectPrewarmPaths(all, limit, rotate = true) {
  if (all.length <= limit) return all;

  const { head, tail } = byPriority(all);
  const selected = head.slice(0, limit);
  const room = limit - selected.length;
  if (room <= 0 || !tail.length) return selected;

  if (!rotate) return [...selected, ...tail.slice(0, room)];

  // Dilim listenin sonunu aşarsa başa sarar: kuyruk halkasal dolaşılır.
  const start = queueCursor % tail.length;
  const slice = tail.slice(start, start + room);
  if (slice.length < room) slice.push(...tail.slice(0, room - slice.length));
  queueCursor = (start + room) % tail.length;

  return [...selected, ...slice];
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

/**
 * Saniyedeki istek sayısını sınırlar. Fren `concurrency`'den bağımsız
 * olmalı: paralellik gecikmeyi kapatmak için var, kotayı koruyan şey toplam
 * hız. İşçiler aynı sayacı paylaştığı için sıra kimde olursa olsun tur
 * verilen hızın üstüne çıkmaz.
 *
 * @param {number} rps 0 → sınırsız
 * @returns {() => Promise<void>}
 */
function createPacer(rps) {
  if (!rps) return async () => {};

  const gap = 1000 / rps;
  let nextSlot = 0;

  return async () => {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + gap;
    if (slot > now) await sleep(slot - now);
  };
}

/**
 * `DEV_TOKEN` ayarlıyken `devGate` token taşımayan her isteğe 404 döner.
 * Isıtma kendi sunucusuna istek attığı için token'ı çerez olarak taşımalı;
 * yoksa tüm sayfalar 404 alır ve önbellek hiç dolmaz.
 *
 * @returns {Record<string, string>}
 */
function devGateHeader() {
  const token = process.env.DEV_TOKEN;
  if (!token) return {};

  const cookie = getConfig().brand.devTokenCookie;
  return { cookie: `${cookie}=${encodeURIComponent(token)}` };
}

/**
 * @param {string} origin
 * @param {string[]} paths
 * @param {number} concurrency
 * @param {(ok: number, failed: number) => void} [report]
 *   Tur ilerlemesini `prewarmProgress`'e yazar. Tekrar turunda sayaçların
 *   anlamı değiştiği için çağıran taraf kendi formülünü verir.
 * @param {() => Promise<void>} [pace] İstek başına beklenen hız freni.
 * @returns {Promise<{ ok: number, failed: number, failedPaths: string[] }>}
 */
async function crawl(origin, paths, concurrency, report = undefined, pace = undefined) {
  const { brand } = getConfig();
  const cacheHeader = brand.cacheHeader.toLowerCase();

  let index = 0;
  let ok = 0;
  let failed = 0;
  /** @type {string[]} */
  const failedPaths = [];

  async function worker() {
    while (index < paths.length) {
      const target = paths[index];
      index += 1;

      if (pace) await pace();

      const startedAt = Date.now();

      try {
        const response = await fetch(`${origin}${target}`, {
          headers: {
            // Sıkıştırılmış gövde de cache'lensin.
            "accept-encoding": "br, gzip",
            "user-agent": brand.prewarmUserAgent,
            ...devGateHeader(),
          },
        });
        // Gövde okunmadan bağlantı açık kalır.
        const body = await response.arrayBuffer();
        if (response.ok) ok += 1;
        else {
          failed += 1;
          failedPaths.push(target);
        }

        prewarmProgress.entries.push({
          path: target,
          status: response.status,
          ms: Date.now() - startedAt,
          bytes: body.byteLength,
          cache: response.headers.get(cacheHeader),
          error: response.ok ? null : `HTTP ${response.status}`,
        });
      } catch (error) {
        failed += 1;
        failedPaths.push(target);
        prewarmProgress.entries.push({
          path: target,
          status: 0,
          ms: Date.now() - startedAt,
          bytes: 0,
          cache: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (report) {
        report(ok, failed);
      } else {
        prewarmProgress.done = ok + failed;
        prewarmProgress.ok = ok;
        prewarmProgress.failed = failed;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, paths.length) }, worker),
  );

  return { ok, failed, failedPaths };
}

/**
 * @param {{ origin: string, quiet?: boolean, paths?: string[] }} options
 *   `paths` verilirse hook çağrılmaz, yalnızca o yollar ısıtılır (dev
 *   panelindeki "tekrar dene" bunu kullanır).
 * @returns {Promise<{ ok: number, failed: number, total: number, elapsed: number }>}
 */
export async function prewarm({ origin, quiet = false, paths: only }) {
  const started = Date.now();
  const limit = setting("PREWARM_MAX", "max", 400);
  // Dev'de daha az paralellik: tarama, o an tarayıcıda açtığın sayfanın
  // render'ıyla CPU için yarışmasın.
  const concurrency = setting(
    "PREWARM_CONCURRENCY",
    "concurrency",
    process.env.NODE_ENV === "development" ? 2 : 4,
  );

  const rps = num(process.env.PREWARM_RPS, num(getConfig().prewarm?.rps, 0));
  const pace = createPacer(rps);

  const all = only?.length ? only : await collectPaths();
  // Elle verilen liste budanmaz ve sıralanmaz: çağıran tam olarak neyi
  // istediğini biliyor (dev panelindeki "tekrar dene" bunu kullanır).
  const paths = only?.length
    ? all
    : selectPrewarmPaths(all, limit, getConfig().prewarm?.rotate !== false);

  Object.assign(prewarmProgress, {
    active: true,
    done: 0,
    total: paths.length,
    ok: 0,
    failed: 0,
    startedAt: started,
    finishedAt: null,
    entries: [],
  });

  let ok = 0;
  let failed = 0;
  let recovered = 0;
  try {
    /** @type {string[]} */
    let failedPaths;
    ({ ok, failed, failedPaths } = await crawl(
      origin,
      paths,
      concurrency,
      undefined,
      pace,
    ));

    // Hatalar çoğunlukla upstream rate limit'i (429): ilk tur yüzlerce sayfayı
    // aynı anda çekerken API'yi zorluyor. Tek seri tekrar turu bu sayfaların
    // önbelleğe girmesini sağlıyor; aksi hâlde ziyaretçi soğuk render'ı öder.
    if (failedPaths.length) {
      const firstOk = ok;
      const firstFailed = failed;

      // Rate limit pencereleri saniye mertebesinde; hemen tekrar denemek aynı
      // 429'u almak demek.
      const retryDelay = setting("PREWARM_RETRY_DELAY_MS", "retryDelayMs", 2000);
      await sleep(retryDelay);

      const retry = await crawl(
        origin,
        failedPaths,
        1,
        (retriedOk) => {
          // Tekrar turunda her başarı bir hatayı başarıya çevirir.
          prewarmProgress.ok = firstOk + retriedOk;
          prewarmProgress.failed = firstFailed - retriedOk;
        },
        pace,
      );
      recovered = retry.ok;
      ok += retry.ok;
      failed -= retry.ok;
    }
  } finally {
    prewarmProgress.active = false;
    prewarmProgress.finishedAt = Date.now();
  }
  const elapsed = Date.now() - started;

  if (!quiet && paths.length) {
    const skipped = all.length - paths.length;
    // Rotasyon açıkken sınırın dışında kalan yollar kaybolmuyor, bir sonraki
    // tura kalıyor; log bunu ayırt etmeli, yoksa "400 yol atlandı" satırı
    // hatalı bir kurulum sanılıyor.
    const rotate = !only?.length && getConfig().prewarm?.rotate !== false;
    console.log(
      `[prewarm] warmed ${ok}/${paths.length} pages` +
        `${failed ? `, ${failed} failed` : ""}` +
        `${recovered ? `, ${recovered} recovered on the retry pass` : ""}` +
        `${skipped > 0 ? `, ${skipped} ${rotate ? "deferred to the next pass" : "over the limit"}` : ""}` +
        ` (${(elapsed / 1000).toFixed(1)}s)`,
    );
  }

  return { ok, failed, total: paths.length, elapsed };
}

/**
 * Açılışta ısıtmayı tetikler. `listen` geri çağrısından çağrılır; isteğe
 * bağlı olarak periyodik tekrarlar. Hiçbir hata süreci düşürmez.
 *
 * @param {{ port: number }} options
 * @returns {void}
 */
export function startPrewarm({ port }) {
  const config = getConfig();
  if (process.env.PREWARM === "0") return;
  if (process.env.PREWARM !== "1" && config.prewarm?.enabled === false) return;
  // Isıtacak yol bildirmeyen bir projede zamanlayıcı kurmanın anlamı yok.
  if (typeof config.hooks?.prewarmPaths !== "function") return;

  const isDev = process.env.NODE_ENV === "development";
  const origin = `http://127.0.0.1:${port}`;

  // Hız frenli bir tur `intervalSeconds`'tan uzun sürebilir; üst üste binen
  // turlar `prewarmProgress`'i bozar ve upstream'e iki kat yük bindirir.
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await prewarm({ origin });
    } catch (error) {
      console.error("[prewarm] failed", error);
    } finally {
      running = false;
    }
  };

  // Isıtma ilk isteklerle yarışmasın diye gecikmeyle başlar. Dev'de gecikme
  // daha uzun: dosya kaydı süreci yeniden başlattığı için zamanlayıcı da
  // ölür; yalnızca sunucu bir süre sakin kalınca ısınır.
  const delay = setting("PREWARM_DELAY_MS", "delayMs", isDev ? 3000 : 500);
  setTimeout(() => void run(), delay).unref();

  // Girdiler `revalidate` ile yaşlanır; stale-while-revalidate sayesinde
  // ziyaretçi beklemez. Periyodik tur, hiç ziyaret edilmeyen sayfaları da
  // sıcak tutmak isteyen kurulumlar için opsiyoneldir.
  // `rotate` ile birlikte bu ayar "damla damla ısıtma"ya dönüşür: her tur
  // kuyruğun bir dilimini alır, yeterli tur sonunda liste baştan sona ısınır.
  const interval = setting("PREWARM_INTERVAL_SECONDS", "intervalSeconds", 0);
  if (interval > 0) setInterval(() => void run(), interval * 1000).unref();
}
