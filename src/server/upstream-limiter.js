/**
 * Upstream API'ye giden isteklerin host başına hız freni.
 *
 * Isıtma turundaki `rps` ayarı bu işi yapamıyordu: o, kendi sunucumuza atılan
 * **sayfa** isteklerini sayıyor. Bir sayfa render'ı bir API çağrısı da yapabilir
 * yirmi tane de; kotayı bağlayan şey sayfa sayısı değil, çağrı sayısı. Bu
 * yüzden fren `trackUpstreamFetch()` sarmalayıcısına, yani gerçek çağrının
 * geçtiği yere konuyor — ısıtma da, gerçek trafik de aynı bütçeden harcar.
 *
 * Üç mekanizma birlikte çalışıyor, çünkü üç farklı şeyi sınırlıyorlar:
 *
 *   token bucket → ortalama hız (saniyedeki çağrı)
 *   concurrency  → anlık baskı (aynı anda uçan çağrı)
 *   AIMD         → doğru hızın ne olduğu
 *
 * Sabit bir hız her zaman ya çok yavaş ya çok hızlıdır: kotanın gerçek sınırını
 * kimse config'e doğru yazamaz, üstelik gün içinde değişir. 429 geldiğinde hızı
 * yarıya indirip (çarpımsal azalma) temiz geçen her pencerede bir adım geri
 * çıkmak (toplamsal artış), sınırı elle ayar yapılmadan bulur.
 *
 * Devre kesici de aynı gerekçeyle var: 429 geçici sayıldığı için o çağrıyla
 * üretilen HTML önbelleğe **yazılmıyor**. Yani rate limit'e girmiş bir turda
 * kota harcanır ve karşılığında hiçbir şey saklanmaz. Art arda 429 alan bir
 * host'a bir süre hiç gitmemek, o boşa yanmayı kesiyor.
 *
 * Varsayılan **kapalı**: `rate` verilmedikçe hiçbir istek beklemez. Framework
 * mevcut kurulumların davranışını sessizce değiştirmez.
 */
import { DEFAULT_UPSTREAM_LIMIT } from "../config/defaults.js";

/**
 * @typedef {object} HostState
 * @property {string} host
 * @property {number} maxRate Config'te verilen tavan; AIMD bunun üstüne çıkmaz.
 * @property {number} minRate Azalmanın dibi; 0'a inip tamamen kilitlenmesin.
 * @property {number} rate Saniyedeki izin — AIMD bunu oynatır.
 * @property {number} burst Kovanın boyu: kısa patlamalara verilen tolerans.
 * @property {number} concurrency Aynı anda uçabilecek çağrı sayısı.
 * @property {number} tokens
 * @property {number} refilledAt
 * @property {number} active Uçuştaki çağrı.
 * @property {(() => void)[]} waiters Boş yuva bekleyenler.
 * @property {Promise<void>} chain Admission sırası (FIFO).
 * @property {number} blockedUntil `Retry-After` boyunca kova tamamen durur.
 * @property {number} consecutiveFailures
 * @property {number} bypassUntil Devre kesicinin açık kaldığı an.
 * @property {number} adjustedAt Son AIMD kararının zamanı.
 * @property {number} throttled Kaç kez 429/503 görüldü (teşhis için).
 * @property {number} rejected Devre kesici kaç çağrıyı hiç göndermedi.
 */

/** @type {Map<string, HostState>} */
const hosts = new Map();

/** @type {typeof DEFAULT_UPSTREAM_LIMIT} */
let settings = { ...DEFAULT_UPSTREAM_LIMIT };

/**
 * `createApp()` config yüklendikten sonra bir kez çağırır. Ayar değiştiğinde
 * host durumları sıfırlanır: eski `maxRate`'e göre ayarlanmış bir `rate`
 * yeni tavanın üstünde kalabilir.
 *
 * @param {Record<string, unknown> | undefined} config `cache().upstream`
 * @returns {void}
 */
export function configureUpstreamLimiter(config) {
  settings = { ...DEFAULT_UPSTREAM_LIMIT, ...(config ?? {}) };
  hosts.clear();
}

/** @returns {boolean} */
function enabled() {
  return settings.rate > 0 || hostOverrides().length > 0;
}

/** @returns {[string, Record<string, number>][]} */
function hostOverrides() {
  const raw = /** @type {Record<string, any>} */ (settings.hosts ?? {});
  return Object.entries(raw);
}

/**
 * @param {string} url
 * @returns {string | null} Host, ya da URL çözülemediyse `null`.
 */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * @param {string} host
 * @returns {HostState}
 */
function stateFor(host) {
  const existing = hosts.get(host);
  if (existing) return existing;

  const override = /** @type {Record<string, any>} */ (settings.hosts ?? {})[host] ?? {};
  const merged = { ...settings, ...override };
  const rate = num(merged.rate, 0);

  /** @type {HostState} */
  const created = {
    host,
    maxRate: rate,
    minRate: Math.min(num(merged.minRate, DEFAULT_UPSTREAM_LIMIT.minRate), rate || 1),
    rate: rate,
    // Kova boyu verilmezse bir saniyelik bütçe: hız 4/s ise dört çağrılık bir
    // patlama tolere edilir, beşincisi bekler.
    burst: num(merged.burst, 0) || Math.max(1, Math.ceil(rate)),
    concurrency: Math.floor(num(merged.concurrency, DEFAULT_UPSTREAM_LIMIT.concurrency)),
    tokens: num(merged.burst, 0) || Math.max(1, Math.ceil(rate)),
    refilledAt: Date.now(),
    active: 0,
    waiters: [],
    chain: Promise.resolve(),
    blockedUntil: 0,
    consecutiveFailures: 0,
    bypassUntil: 0,
    // 0, `Date.now()` değil: ilk saniye içinde gelen bir 429 de hızı
    // düşürmeli. Aksi hâlde ısıtma turunun ilk patlaması cezasız kalıyor.
    adjustedAt: 0,
    throttled: 0,
    rejected: 0,
  };

  hosts.set(host, created);
  return created;
}

/** @param {unknown} value @param {number} fallback */
function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

/**
 * Geçen süreye göre kovayı doldurur ve hata görülmeyen pencereler için hızı
 * bir adım yukarı çeker. İkisi aynı yerde: her ikisi de "zaman geçti" bilgisine
 * dayanıyor ve zamanlayıcı kurmadan, çağrı anında hesaplanıyorlar — boşta duran
 * bir süreç için sayaç işletmenin anlamı yok.
 *
 * @param {HostState} state
 * @returns {void}
 */
function refill(state) {
  const now = Date.now();
  const elapsed = now - state.refilledAt;

  if (elapsed > 0) {
    state.tokens = Math.min(state.burst, state.tokens + (elapsed * state.rate) / 1000);
    state.refilledAt = now;
  }

  if (state.rate >= state.maxRate) return;
  if (now - state.adjustedAt < settings.increaseIntervalMs) return;

  // Toplamsal artış: azalma yarıya indiriyor, geri çıkış adım adım. Ters
  // olsaydı (hızlı çık, yavaş in) her pencerede yeniden 429 yerdik.
  state.rate = Math.min(state.maxRate, state.rate + num(settings.increaseStep, 1));
  state.adjustedAt = now;
}

/**
 * @param {HostState} state
 * @returns {number} Kaç ms sonra tekrar denenmeli; 0 → yuva hazır.
 */
function waitFor(state) {
  const now = Date.now();
  if (state.blockedUntil > now) return state.blockedUntil - now;

  refill(state);
  if (state.tokens >= 1) return 0;

  // Bir tokenlik eksiğin dolması için gereken süre. `rate` düşükken bu
  // saniyeler olabilir; beklemek doğru davranış — alternatifi 429.
  return Math.max(10, Math.ceil(((1 - state.tokens) / state.rate) * 1000));
}

/**
 * Boş bir eşzamanlılık yuvası bekler.
 *
 * @param {HostState} state
 * @returns {Promise<void>}
 */
function waitForSlot(state) {
  if (state.active < state.concurrency) return Promise.resolve();
  return new Promise((resolve) => state.waiters.push(resolve));
}

/**
 * Çağrı için izin alır. `null` dönerse fren kapalı ya da host çözülemedi;
 * `blocked` dönerse devre kesici açık ve çağrı hiç yapılmamalı.
 *
 * @param {string} url
 * @returns {Promise<{ blocked: boolean, host: string, release: () => void } | null>}
 */
export async function limitUpstream(url) {
  if (!enabled()) return null;

  const host = hostOf(url);
  if (!host) return null;

  const state = stateFor(host);
  if (!state.maxRate) return null;

  if (state.bypassUntil > Date.now()) {
    state.rejected += 1;
    return { blocked: true, host, release: () => {} };
  }

  // Admission FIFO: her çağrı kendinden öncekinin izin almasını bekler. Sıra
  // olmadan, uyanan çağrılar rastgele yarışır ve ilk gelen en son geçebilir.
  const previous = state.chain;
  /** @type {() => void} */
  let releaseChain = () => {};
  state.chain = new Promise((resolve) => {
    releaseChain = resolve;
  });

  try {
    await previous;

    for (;;) {
      await waitForSlot(state);
      const wait = waitFor(state);
      if (wait === 0) break;
      await sleep(wait);
    }

    state.tokens -= 1;
    state.active += 1;
  } finally {
    releaseChain();
  }

  let released = false;
  return {
    blocked: false,
    host,
    release: () => {
      if (released) return;
      released = true;
      state.active -= 1;
      state.waiters.shift()?.();
    },
  };
}

/**
 * Yanıtın hıza etkisini işler. 429/503 hızı yarıya indirir ve `Retry-After`
 * varsa kovayı o süre boyunca tamamen durdurur; başarı sayaçları sıfırlar.
 *
 * @param {string} host
 * @param {number} status `0` → ağ hatası (yanıt gelmedi).
 * @param {string | null} [retryAfter] `Retry-After` başlığı.
 * @returns {void}
 */
export function noteUpstreamResponse(host, status, retryAfter = null) {
  const state = hosts.get(host);
  if (!state) return;

  // Yalnızca "yavaşla" anlamına gelen cevaplar hızı cezalandırır. 400/404 bir
  // kota sorunu değil, 500 de öyle: onlar için yavaşlamak arızayı düzeltmez,
  // sadece siteyi yavaşlatır.
  if (status !== 429 && status !== 503) {
    state.consecutiveFailures = 0;
    return;
  }

  state.throttled += 1;
  state.consecutiveFailures += 1;

  const now = Date.now();
  const cooldown = retryAfterMs(retryAfter);
  if (cooldown) state.blockedUntil = Math.max(state.blockedUntil, now + cooldown);

  // Çarpımsal azalma, ama pencere başına bir kez: aynı anda uçan on çağrı
  // hep 429 dönerse hız on kez yarılanıp dibe vururdu.
  if (now - state.adjustedAt >= settings.decreaseIntervalMs) {
    state.rate = Math.max(state.minRate, state.rate / 2);
    state.adjustedAt = now;
  }

  if (
    state.consecutiveFailures >= settings.breakerFailures &&
    state.bypassUntil <= now
  ) {
    state.bypassUntil = now + settings.breakerCooldownMs;
    console.warn(
      `[upstream] ${state.host}: ${state.consecutiveFailures} consecutive rate limits — ` +
        `bypassing for ${settings.breakerCooldownMs}ms (rate is now ${state.rate.toFixed(1)}/s)`,
    );
  }
}

/**
 * `Retry-After` iki biçimde gelir: saniye ya da HTTP tarihi.
 *
 * @param {string | null | undefined} value
 * @returns {number} ms; okunamazsa 0.
 */
function retryAfterMs(value) {
  if (!value) return 0;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 300_000);

  const date = Date.parse(value);
  if (Number.isNaN(date)) return 0;

  return Math.min(Math.max(0, date - Date.now()), 300_000);
}

/**
 * Dev paneli ve teşhis için host başına durum. Fren kapalıysa boş dizi.
 *
 * @returns {{ host: string, rate: number, maxRate: number, concurrency: number,
 *   active: number, throttled: number, rejected: number, bypassed: boolean,
 *   blockedMs: number, bypassedMs: number }[]}
 */
export function getUpstreamLimiterStatus() {
  const now = Date.now();

  return [...hosts.values()].map((state) => ({
    host: state.host,
    rate: Number(state.rate.toFixed(2)),
    maxRate: state.maxRate,
    concurrency: state.concurrency,
    active: state.active,
    throttled: state.throttled,
    rejected: state.rejected,
    bypassed: state.bypassUntil > now,
    blockedMs: Math.max(0, state.blockedUntil - now),
    bypassedMs: Math.max(0, state.bypassUntil - now),
  }));
}

/**
 * Freni bekleten en uzun süre. Isıtma turunun tekrar denemesi bunu kullanıyor:
 * sabit bir bekleme, kesici 10 saniye açıkken 2 saniye sonra tekrar denemek
 * demekti — yani aynı 429'u peşin peşin almak.
 *
 * @returns {number} ms; fren kapalıysa ya da bekleyen bir şey yoksa 0.
 */
export function upstreamCooldownMs() {
  const now = Date.now();
  let longest = 0;

  for (const state of hosts.values()) {
    longest = Math.max(longest, state.bypassUntil - now, state.blockedUntil - now);
  }

  return Math.max(0, longest);
}

/**
 * Testler için: ayarları verip tüm host durumlarını sıfırlar.
 *
 * @param {Record<string, unknown>} [config]
 * @returns {void}
 */
export function resetUpstreamLimiterForTests(config = {}) {
  configureUpstreamLimiter(config);
}
