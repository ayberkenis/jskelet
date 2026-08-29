/**
 * Dev overlay: sağ altta yüzen baloncuk; hataları ve performans
 * istatistiklerini gösterir.
 *
 * Bu dosya **build'e dahil değildir**. `npm run dev` sırasında sunucu onu
 * `/__jskelet/dev/overlay.js` altından ham olarak servis eder, layout da
 * script etiketini yalnızca development'ta basar. Bu yüzden burada bundler
 * yok: import yapmadan, tek dosya olarak çalışır.
 *
 * Tüm arayüz shadow DOM içinde durur; sayfanın CSS'i ile karışmaz.
 */

const BASE = "/__jskelet/dev";
const POLL_MS = 2000;
const MAX_ERRORS = 100;

/** @type {{ id: number, level: string, message: string, stack: string | null, source: string, at: number }[]} */
const clientErrors = [];
let nextId = 1;

/** @type {{ requests: any[], errors: any[], memory?: { rss: number, heapUsed: number }, uptime?: number, node?: string } | null} */
let serverStats = null;

const metrics = {
  ttfb: null,
  fcp: null,
  lcp: null,
  cls: 0,
  inp: null,
  dcl: null,
  load: null,
  longTasks: 0,
  blocking: 0,
};

let activeTab = "errors";
let open = false;

/** Açık bırakılan yığın izleri; panel her poll'da yeniden çizildiği için gerekir. */
let expanded = new Set();

/**
 * Sunucu `node --watch` ile yeniden başladığında ya da sayfa tazelendiğinde
 * panelin kapanmaması için görünüm durumu ve tarayıcı hata günlüğü sekme
 * belleğinde saklanır.
 */
const STATE_KEY = "jskelet-devtools";
const BOOT_KEY = "jskelet-devtools-boot";

/** Son görülen sunucu süreci; değişirse yeniden başlatılmış demektir. */
let bootId = null;
let offline = false;

function saveState() {
  try {
    sessionStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        open,
        activeTab,
        aboutSection,
        expanded: [...expanded],
        errors: clientErrors.slice(0, 30),
      }),
    );
  } catch {
    // Kota dolu olabilir; durum kaybı dev akışını engellemez.
  }
}

function loadState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? "null");
    if (!saved) return;

    open = Boolean(saved.open);
    activeTab = saved.activeTab ?? "errors";
    aboutSection = saved.aboutSection ?? "framework";
    expanded = new Set(saved.expanded ?? []);
    clientErrors.push(...(saved.errors ?? []));
    nextId = Math.max(nextId, ...clientErrors.map((item) => item.id + 1));
  } catch {
    // Bozuk kayıt: temiz başla.
  }
}

/* ---------------------------------------------------------------- hatalar */

/**
 * @param {string} level
 * @param {string} message
 * @param {{ stack?: string | null, source?: string }} [extra]
 */
function pushError(level, message, extra = {}) {
  clientErrors.unshift({
    id: nextId++,
    level,
    message,
    stack: extra.stack ?? null,
    source: extra.source ?? "client",
    at: Date.now(),
  });
  if (clientErrors.length > MAX_ERRORS) clientErrors.length = MAX_ERRORS;
  saveState();
  render();
}

function captureErrors() {
  window.addEventListener("error", (event) => {
    if (event.error instanceof Error) {
      pushError("error", `${event.error.name}: ${event.error.message}`, {
        stack: event.error.stack,
      });
      return;
    }
    // Kaynak yükleme hataları (img/script/link) Error taşımaz.
    const target = /** @type {HTMLElement | null} */ (event.target);
    if (target && target !== /** @type {any} */ (window)) {
      const url = target.getAttribute?.("src") ?? target.getAttribute?.("href");
      pushError("error", `Kaynak yüklenemedi: ${url ?? target.tagName}`, {
        source: "resource",
      });
      return;
    }
    pushError("error", event.message);
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    pushError(
      "error",
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : `Unhandled rejection: ${String(reason)}`,
      { stack: reason instanceof Error ? reason.stack : null },
    );
  });

  for (const level of ["error", "warn"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const error = args.find((arg) => arg instanceof Error);
      pushError(
        level,
        args
          .map((arg) =>
            typeof arg === "string"
              ? arg
              : arg instanceof Error
                ? `${arg.name}: ${arg.message}`
                : safeJson(arg),
          )
          .join(" "),
        { stack: error?.stack ?? null, source: "console" },
      );
      original(...args);
    };
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/* ------------------------------------------------------------- performans */

/**
 * @param {string} type
 * @param {(entries: PerformanceEntry[]) => void} handler
 * @param {PerformanceObserverInit} [options]
 */
function observe(type, handler, options = {}) {
  try {
    new PerformanceObserver((list) => handler(list.getEntries())).observe({
      type,
      buffered: true,
      ...options,
    });
  } catch {
    // Tarayıcı bu metriği desteklemiyor; sessizce atla.
  }
}

function captureMetrics() {
  const nav = performance.getEntriesByType("navigation")[0];
  if (nav) {
    metrics.ttfb = nav.responseStart;
    metrics.dcl = nav.domContentLoadedEventEnd || null;
    metrics.load = nav.loadEventEnd || null;
  }

  observe("paint", (entries) => {
    for (const entry of entries) {
      if (entry.name === "first-contentful-paint") metrics.fcp = entry.startTime;
    }
    render();
  });

  observe("largest-contentful-paint", (entries) => {
    const last = entries.at(-1);
    if (last) metrics.lcp = last.startTime;
    render();
  });

  observe("layout-shift", (entries) => {
    for (const entry of entries) {
      if (!entry.hadRecentInput) metrics.cls += entry.value;
    }
    render();
  });

  observe("longtask", (entries) => {
    for (const entry of entries) {
      metrics.longTasks += 1;
      metrics.blocking += Math.max(0, entry.duration - 50);
    }
    render();
  });

  observe("event", (entries) => {
    for (const entry of entries) {
      const value = entry.duration;
      if (metrics.inp == null || value > metrics.inp) metrics.inp = value;
    }
    render();
  }, { durationThreshold: 40 });

  window.addEventListener("load", () => {
    const entry = performance.getEntriesByType("navigation")[0];
    if (entry) {
      metrics.dcl = entry.domContentLoadedEventEnd;
      metrics.load = entry.loadEventEnd;
    }
    render();
  });
}

/**
 * Ölçüm okumaları saniyede birden fazla yapılmaz. Kaynak listesi yüzlerce
 * kayda çıkabiliyor ve her yeniden çizimde baştan taranması sekme geçişini
 * hissedilir şekilde yavaşlatıyordu.
 *
 * @template T
 * @param {() => T} compute
 * @param {number} [ttl]
 * @returns {() => T}
 */
function cached(compute, ttl = 1000) {
  let value = null;
  let at = 0;

  return () => {
    const now = performance.now();
    if (value === null || now - at > ttl) {
      value = compute();
      at = now;
    }
    return value;
  };
}

const resourceSummary = cached(() => {
  const resources = performance.getEntriesByType("resource");
  let bytes = 0;
  /** @type {Record<string, { count: number, bytes: number }>} */
  const byType = {};

  for (const entry of resources) {
    const size = entry.transferSize || entry.encodedBodySize || 0;
    bytes += size;
    const kind = entry.initiatorType || "other";
    byType[kind] ??= { count: 0, bytes: 0 };
    byType[kind].count += 1;
    byType[kind].bytes += size;
  }

  return { count: resources.length, bytes, byType };
});

const islandSummary = cached(() => ({
  total: document.querySelectorAll("[data-island]").length,
  ready: document.querySelectorAll("[data-island-ready]").length,
}));

/* --------------------------------------------------------- API çağrıları */

/** @type {{ url: string, ms: number, status: number, bytes: number, initiator: string }[]} */
const clientApi = [];

/**
 * Tarayıcıdaki veri çağrıları. Panelin kendi uçları ve statik varlıklar
 * sayılmaz; amaç sayfanın hangi API'lere kaç ms harcadığını görmek.
 */
function captureFetch() {
  const original = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    if (url.includes(BASE)) return original(input, init);

    const started = performance.now();
    try {
      const response = await original(input, init);
      record(url, performance.now() - started, response.status, response);
      return response;
    } catch (error) {
      record(url, performance.now() - started, 0, null);
      throw error;
    }
  };

  /**
   * @param {string} url
   * @param {number} ms
   * @param {number} status
   * @param {Response | null} response
   */
  function record(url, ms, status, response) {
    clientApi.push({
      url,
      ms: Math.round(ms),
      status,
      bytes: Number(response?.headers.get("content-length") ?? 0),
      initiator: "fetch",
    });
    if (clientApi.length > 100) clientApi.shift();
  }
}

/**
 * Sayfa ölçümlerini rapora gönderir. Sekme kapanırken de gitmesi gerektiği
 * için mümkünse `sendBeacon` kullanılır.
 *
 * @param {boolean} [leaving]
 */
function sendPageReport(leaving = false) {
  const resources = resourceSummary();
  const payload = JSON.stringify({
    url: location.href,
    title: document.title,
    metrics: { ...metrics },
    resources,
    islands: {
      ...islandSummary(),
      names: [
        ...new Set(
          [...document.querySelectorAll("[data-island]")].map(
            (node) => node.dataset.island,
          ),
        ),
      ],
    },
    api: clientApi,
  });

  if (leaving && navigator.sendBeacon) {
    navigator.sendBeacon(
      `${BASE}/vitals`,
      new Blob([payload], { type: "application/json" }),
    );
    return;
  }

  fetch(`${BASE}/vitals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Rapor kaydı en iyi çaba.
  });
}

/* ------------------------------------------------------------------ sunucu */

let restarts = 0;

/* -------------------------------------------------------- canlı yenileme */

/**
 * Sunucu olay akışı. Amaç titremeyi bitirmek: CSS değiştiğinde sayfa
 * yenilenmez, yalnızca stylesheet yeni sürümle takas edilir. Sunucu yeniden
 * başladığında (boot kimliği değişince) tek sefer tam yenileme yapılır;
 * overlay durumu sekme belleğinde durduğu için panel açık kalmaya devam eder.
 */
function connectEvents() {
  const source = new EventSource(`${BASE}/events`);

  source.addEventListener("message", (event) => {
    /** @type {{ type: string, boot?: string, href?: string }} */
    const payload = JSON.parse(event.data);

    if (payload.type === "hello") {
      offline = false;
      const previous = sessionStorage.getItem(BOOT_KEY);
      sessionStorage.setItem(BOOT_KEY, payload.boot);

      if (previous && previous !== payload.boot) {
        restarts += 1;
        location.reload();
        return;
      }

      bootId = payload.boot;
      render();
      return;
    }

    if (payload.type === "css") {
      swapStylesheet(payload.href);
      return;
    }

    if (payload.type === "reload") location.reload();
  });

  source.addEventListener("error", () => {
    // Sunucu yeniden başlarken bağlantı düşer; EventSource kendi kendine
    // yeniden bağlanır, biz yalnızca göstergeyi güncelleriz.
    if (!offline) {
      offline = true;
      render();
    }
  });
}

/**
 * Yeni sheet yüklenmeden eskisi kaldırılmaz; böylece stilsiz bir kare oluşmaz.
 * @param {string} href
 */
function swapStylesheet(href) {
  const current = document.querySelector('link[rel="stylesheet"]');
  if (!current || current.getAttribute("href") === href) return;

  const next = current.cloneNode();
  next.href = href;
  next.addEventListener("load", () => current.remove(), { once: true });
  current.after(next);
}

async function pollServer() {
  try {
    const response = await fetch(`${BASE}/stats`, { cache: "no-store" });
    if (!response.ok) return;

    const stats = await response.json();

    // Süreç kimliği değiştiyse sunucu yeniden başlamıştır. Overlay kapanmaz,
    // yalnızca sayacı artar; günlükler sunucuda kalıcı olduğu için de silinmez.
    if (bootId && stats.boot !== bootId) restarts += 1;
    bootId = stats.boot ?? bootId;

    offline = false;
    serverStats = stats;
    render();

    // Isıtma sürerken sayaç akıcı görünsün diye yoklama sıklaşır.
    if (stats.prewarm?.active) setTimeout(pollServer, 600);
  } catch {
    // Yeniden başlatma penceresi: eldeki veriler korunur, yalnızca durum
    // göstergesi "bağlantı yok"a döner.
    if (!offline) {
      offline = true;
      render();
    }
  }
}

/**
 * Isıtmayı panelden tetikler. Yol listesi verilirse yalnızca onlar denenir.
 * @param {string[]} [paths]
 */
async function startPrewarm(paths) {
  try {
    await fetch(`${BASE}/prewarm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: paths ?? [] }),
    });
  } catch {
    // Sunucu yeniden başlıyor olabilir; sonraki yoklama durumu getirir.
  }
  pollServer();
}

async function clearAll() {
  clientErrors.length = 0;
  try {
    await fetch(`${BASE}/clear`, { method: "POST" });
  } catch {
    // yoksay
  }
  serverStats = null;
  saveState();
  render();
  pollServer();
}

/* ---------------------------------------------------------------- arayüz */

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }

.root {
  --bg: #0c0e12;
  --surface: rgba(255,255,255,.045);
  --surface-hover: rgba(255,255,255,.08);
  --line: rgba(255,255,255,.09);
  --text: #eef1f5;
  --muted: #8b95a3;
  --good: #34d399;
  --mid: #fbbf24;
  --bad: #fb7185;
  position: fixed; inset-block-end: 20px; inset-inline-end: 20px;
  z-index: 2147483647; display: flex; flex-direction: column;
  align-items: flex-end; gap: 10px; color: var(--text);
}

.bubble {
  position: relative; display: grid; place-items: center; cursor: pointer;
  width: 46px; height: 46px; padding: 0; border-radius: 50%;
  border: 1px solid var(--line);
  background: radial-gradient(120% 120% at 30% 0%, #1b2029 0%, #0c0e12 70%);
  box-shadow: 0 10px 30px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);
  transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
}
.bubble:hover { transform: translateY(-2px); border-color: rgba(255,255,255,.28); }
.bubble:active { transform: translateY(0); }
.bubble.bad { border-color: rgba(251,113,133,.55); box-shadow: 0 10px 30px rgba(251,113,133,.22); }
.bubble.warn { border-color: rgba(251,191,36,.5); box-shadow: 0 10px 30px rgba(251,191,36,.18); }
.bubble img { width: 26px; height: 26px; object-fit: contain; display: block; }
.badge {
  position: absolute; inset-block-start: -5px; inset-inline-end: -5px;
  min-width: 19px; height: 19px; padding: 0 5px; border-radius: 999px;
  display: grid; place-items: center; font-size: 11px; font-weight: 700;
  font-variant-numeric: tabular-nums; background: var(--bad); color: #2a0710;
  border: 2px solid var(--bg);
}
.badge.warn { background: var(--mid); color: #2a1d00; }

/* Baloncuğun solunda ısıtma ilerlemesi. */
/* Karartma katmanı tam ekranı kapladığı için ısıtma rozeti onun altında
   kalabiliyordu; dock açıkça üstte tutulur. */
.dock { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; }
.warm {
  display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
  padding: 5px 11px 5px 9px; border-radius: 999px;
  border: 1px solid var(--line); color: #cfd6de;
  background: rgba(12,14,18,.92);
  box-shadow: 0 8px 24px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.05);
  font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums;
  animation: slide .2s ease;
}
@keyframes slide { from { opacity: 0; transform: translateX(8px); } }
.warm .ring {
  width: 11px; height: 11px; border-radius: 50%; flex: none;
  border: 2px solid rgba(255,255,255,.18); border-top-color: var(--good);
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.warm.done { color: #b9f2dc; border-color: rgba(52,211,153,.35); }
.warm.done .ring { border: 0; background: var(--good); animation: none; }
@media (prefers-reduced-motion: reduce) {
  .warm, .warm .ring { animation: none; }
}

/* hidden özniteliği, display tanımlayan sınıflar tarafından eziliyordu:
   panel kapanmıyor, rozet hep görünüyordu. */
[hidden] { display: none !important; }

.backdrop {
  position: fixed; inset: 0; display: grid; place-items: center; padding: 24px;
  background: rgba(6,8,11,.55); backdrop-filter: blur(3px);
  animation: fade .15s ease;
}
@keyframes fade { from { opacity: 0; } }

.panel {
  width: min(1040px, 94vw); height: min(760px, 86vh);
  display: grid; grid-template-columns: 208px 1fr; grid-template-rows: auto 1fr;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(23,27,34,.98) 0%, rgba(12,14,18,.98) 30%);
  border: 1px solid var(--line); border-radius: 18px;
  box-shadow: 0 32px 80px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06);
  animation: rise .18s cubic-bezier(.2,.8,.3,1);
}
@keyframes rise { from { opacity: 0; transform: translateY(10px) scale(.99); } }
@media (prefers-reduced-motion: reduce) {
  .panel, .backdrop { animation: none; }
  .bubble { transition: none; }
}
@media (max-width: 720px) {
  .panel { grid-template-columns: 1fr; grid-template-rows: auto auto 1fr; }
  .rail { flex-direction: row; overflow: auto; }
}

.head {
  grid-column: 1 / -1; display: flex; align-items: center; gap: 12px;
  padding: 14px 18px; border-bottom: 1px solid var(--line);
}
.head img { width: 22px; height: 22px; object-fit: contain; }
.title { font-size: 14px; font-weight: 700; letter-spacing: -.01em; }
.kbd {
  font-size: 10px; color: var(--muted); border: 1px solid var(--line);
  border-radius: 6px; padding: 1px 6px; font-family: ui-monospace, monospace;
}

.rail {
  display: flex; flex-direction: column; gap: 4px; padding: 14px 10px;
  border-inline-end: 1px solid var(--line); background: rgba(0,0,0,.22);
}
.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px;
  border-radius: 999px; font-size: 11px; font-weight: 600; color: var(--muted);
  background: var(--surface); border: 1px solid var(--line);
}
.pill .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--good); }
.pill.bad { color: #ffd7de; } .pill.bad .dot { background: var(--bad); }
.pill.warn { color: #ffeec2; } .pill.warn .dot { background: var(--mid); }
.spacer { flex: 1; }

.tab {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: start;
  background: transparent; border: 0; color: var(--muted); font-size: 12.5px;
  padding: 9px 11px; border-radius: 10px; cursor: pointer; font-weight: 600;
  transition: color .12s ease, background .12s ease;
}
.tab:hover { color: var(--text); background: var(--surface); }
.tab[aria-selected="true"] { background: var(--surface-hover); color: #fff; }
.tab svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.tab .chip { margin-inline-start: auto; background: var(--bad); color: #2a0710; border-radius: 999px; padding: 0 6px; font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
.tab .chip.neutral { background: rgba(255,255,255,.1); color: #dbe2ea; }
.rail-foot { margin-block-start: auto; display: flex; flex-direction: column; gap: 6px; padding: 8px 4px 0; }
.divider { height: 1px; margin: 4px 2px; background: var(--line); }

/* Hakkında sekmesi: iç sekmeler + anlatı metni. */
.subtabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 4px; }
.subtab {
  background: var(--surface); border: 1px solid var(--line); color: var(--muted);
  border-radius: 999px; padding: 5px 13px; font-size: 11.5px; font-weight: 600; cursor: pointer;
  transition: color .12s ease, background .12s ease, border-color .12s ease;
}
.subtab:hover { color: var(--text); background: var(--surface-hover); }
.subtab[aria-selected="true"] { color: #fff; background: var(--surface-hover); border-color: rgba(255,255,255,.24); }

.prose { width: 100%; }
.prose p { margin: 0 0 12px; color: #c6ced9; }
.prose > :last-child { margin-bottom: 0; }
.prose .rows { margin: 0 0 12px; }
.prose .row { grid-template-columns: 110px 1fr; align-items: start; padding: 9px 11px; }
.prose .row .tag { text-transform: none; letter-spacing: 0; font-family: ui-monospace, SFMono-Regular, monospace; text-align: center; }
.prose .row .path { white-space: normal; overflow: visible; text-overflow: clip; font-family: inherit; font-size: 12px; color: #c6ced9; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin: 0 0 12px; }
.card {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 12px; padding: 11px 13px;
}
.card b { display: block; color: #fff; font-size: 12px; margin-bottom: 3px; }
.card span { color: var(--muted); }
.prose p strong { color: #fff; font-weight: 700; }
.prose code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11.5px; background: rgba(0,0,0,.4); border: 1px solid var(--line); border-radius: 6px; padding: 1px 5px; color: #dbe2ea; }
.steps { display: flex; flex-direction: column; gap: 8px; margin: 0 0 12px; }
.step {
  display: grid; grid-template-columns: 26px 1fr; gap: 12px; align-items: start;
  background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 11px 13px;
}
.step .n {
  display: grid; place-items: center; width: 24px; height: 24px; border-radius: 8px;
  background: rgba(255,255,255,.06); border: 1px solid var(--line);
  font-size: 11px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums;
}
.step b { display: block; color: #fff; font-size: 12.5px; }
.step span { color: var(--muted); }

.body { overflow: auto; padding: 16px 20px 20px; font-size: 12.5px; line-height: 1.6; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.18) transparent; }
.body::-webkit-scrollbar { width: 10px; }
.body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 8px; }

h4 { margin: 22px 0 10px; font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
h4:first-child { margin-top: 0; }

/* Sekmenin başındaki tek cümlelik durum özeti. */
.lede {
  display: flex; gap: 12px; align-items: flex-start;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 14px; padding: 14px 16px; font-size: 13px; line-height: 1.55;
}
.lede .mark { font-size: 18px; line-height: 1.2; }
.lede strong { color: #fff; font-weight: 700; }
.lede.good .mark { color: var(--good); }
.lede.mid .mark { color: var(--mid); }
.lede.bad .mark { color: var(--bad); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.metric {
  position: relative; overflow: hidden; background: var(--surface);
  border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px 14px;
}
.metric .label { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
.metric .value { font-size: 22px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.value.good { color: var(--good); } .value.mid { color: var(--mid); } .value.bad { color: var(--bad); }
.metric .bar { margin-top: 7px; height: 3px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; }
.metric .bar span { display: block; height: 100%; border-radius: 999px; background: var(--muted); }
.metric .bar span.good { background: var(--good); }
.metric .bar span.mid { background: var(--mid); }
.metric .bar span.bad { background: var(--bad); }

.item {
  background: var(--surface); border: 1px solid var(--line);
  border-inline-start: 2px solid var(--bad); border-radius: 4px 12px 12px 4px;
  padding: 9px 11px; margin-bottom: 8px;
}
.item.warn { border-inline-start-color: var(--mid); }
.item .meta { color: var(--muted); font-size: 10.5px; display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.tag { border: 1px solid var(--line); border-radius: 999px; padding: 0 7px; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; font-size: 9.5px; }
.msg { word-break: break-word; color: var(--text); }
.item pre { margin: 8px 0 0; padding: 8px 10px; background: rgba(0,0,0,.4); border-radius: 8px; white-space: pre-wrap; word-break: break-word; color: #b8c0cb; font-size: 11px; font-family: ui-monospace, SFMono-Regular, monospace; max-height: 150px; overflow: auto; }
.link { background: none; border: 0; padding: 0; margin-top: 6px; color: var(--muted); font-size: 11px; font-weight: 600; cursor: pointer; }
.link:hover { color: var(--text); }

.copy {
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
  background: transparent; border: 1px solid transparent; border-radius: 7px;
  padding: 2px 5px; color: var(--muted); font-size: 10.5px; font-weight: 600;
  transition: color .15s ease, background .15s ease, border-color .15s ease;
}
.copy:hover { color: var(--text); background: var(--surface-hover); border-color: var(--line); }
.copy.done { color: var(--good); }
.copy svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
h4 .head-action { float: inline-end; text-transform: none; letter-spacing: 0; }

.empty { color: #5f6874; padding: 14px; text-align: center; background: var(--surface); border: 1px dashed var(--line); border-radius: 12px; }

.rows { display: flex; flex-direction: column; gap: 4px; }
.row {
  display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: 10px; background: var(--surface);
  border: 1px solid transparent; font-variant-numeric: tabular-nums;
}
.row:hover { border-color: var(--line); }
.row .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cfd6de; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; }
.path a { color: inherit; text-decoration: none; border-bottom: 1px solid transparent; }
.path a:hover { color: #fff; border-bottom-color: rgba(255,255,255,.35); }
.status { font-size: 10px; font-weight: 700; border-radius: 6px; padding: 1px 6px; background: rgba(52,211,153,.14); color: var(--good); }
.status.warn { background: rgba(251,191,36,.14); color: var(--mid); }
.status.bad { background: rgba(251,113,133,.14); color: var(--bad); }
.hint { color: var(--muted); font-size: 10.5px; }
.row .good { color: var(--good); } .row .mid { color: var(--mid); } .row .bad { color: var(--bad); }

.btn {
  background: var(--surface); border: 1px solid var(--line); color: var(--text);
  border-radius: 9px; padding: 5px 10px; font-size: 11px; font-weight: 600; cursor: pointer;
  transition: background .15s ease;
}
.btn:hover { background: var(--surface-hover); }
.btn.icon { padding: 5px 8px; line-height: 1; }
.btn.wide {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; font-size: 12px; text-decoration: none;
}
.btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.btn.mini { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; font-size: 11px; }
.btn.mini svg { width: 12px; height: 12px; }
.btn[disabled] { opacity: .5; cursor: default; }
.toolbar { display: flex; justify-content: flex-end; margin-bottom: 10px; }
.btn.danger { color: #ffc9d2; border-color: rgba(251,113,133,.28); background: rgba(251,113,133,.1); }
.btn.danger:hover { color: #fff; border-color: rgba(251,113,133,.55); background: rgba(251,113,133,.22); }
`;

let shadow = null;

/**
 * İskelet bir kez kurulur. Her yoklamada tüm ağacı yeniden yazmak logoyu ve
 * paneli titretiyordu; artık yalnızca değişen metin/sınıf güncelleniyor,
 * gövde HTML'i de içerik gerçekten değiştiyse yenileniyor.
 */
const TAB_ICONS = {
  errors: `<svg viewBox="0 0 16 16"><path d="M8 5.5v4M8 11.5h.01M8 1.8 1.8 13.2h12.4L8 1.8Z"/></svg>`,
  perf: `<svg viewBox="0 0 16 16"><path d="M2 13V8m4 5V3m4 10V6m4 7v-3"/></svg>`,
  server: `<svg viewBox="0 0 16 16"><path d="M2.5 3.5h11v3h-11zM2.5 9.5h11v3h-11zM5 5h.01M5 11h.01"/></svg>`,
  warm: `<svg viewBox="0 0 16 16"><path d="M8 14c2.5 0 4.2-1.7 4.2-3.9C12.2 6.5 8 2 8 2S3.8 6.5 3.8 10.1C3.8 12.3 5.5 14 8 14Z"/></svg>`,
  about: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4M8 4.9h.01"/></svg>`,
};

const REFRESH_ICON = `<svg viewBox="0 0 16 16"><path d="M13.5 8a5.5 5.5 0 1 1-1.9-4.16M13.5 2v3.5H10"/></svg>`;
const SCOPE_ICON = `<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14M7 4.9v4.2M4.9 7h4.2"/></svg>`;
const TRASH_ICON = `<svg viewBox="0 0 16 16"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8l.7-8.2M6.5 7v4M9.5 7v4"/></svg>`;

const SKELETON = `
  <div class="root">
    <div class="backdrop" data-action="backdrop" hidden>
      <div class="panel" role="dialog" aria-label="JSkelet dev araçları">
        <div class="head">
          <img src="${BASE}/logo.png" alt="">
          <span class="title">JSkelet Dev</span>
          <span class="pill"><span class="dot"></span><span data-part="pill"></span></span>
          <span class="spacer"></span>
          <span class="kbd">Alt+D</span>
          <button class="btn icon" data-action="toggle" title="Kapat (Esc)">✕</button>
        </div>
        <div class="rail">
          <button class="tab" data-tab="errors">${TAB_ICONS.errors} Hatalar<span class="chip" data-part="chip" hidden></span></button>
          <button class="tab" data-tab="perf">${TAB_ICONS.perf} Performans</button>
          <button class="tab" data-tab="server">${TAB_ICONS.server} Sunucu</button>
          <button class="tab" data-tab="warm">${TAB_ICONS.warm} Prewarming<span class="chip neutral" data-part="warm-chip" hidden></span></button>
          <div class="rail-foot">
            <button class="tab" data-tab="about">${TAB_ICONS.about} Hakkında</button>
            <div class="divider"></div>
            <button class="btn wide" data-action="reload">${REFRESH_ICON} Sayfayı yenile</button>
            <a class="btn wide" href="${BASE}/report" target="_blank" rel="noreferrer">${SCOPE_ICON} Detaylı İncele</a>
            <button class="btn wide danger" data-action="clear">${TRASH_ICON} Kayıtları temizle</button>
          </div>
        </div>
        <div class="body"></div>
      </div>
    </div>
    <div class="dock">
      <span class="warm" data-part="warm" hidden>
        <span class="ring"></span>
        <span data-part="warm-text"></span>
      </span>
      <button class="bubble" data-action="toggle">
        <img src="${BASE}/logo.png" alt="JSkelet dev araçları">
        <span class="badge" hidden></span>
      </button>
    </div>
  </div>
`;

function ensureRoot() {
  if (shadow) return shadow;

  const host = document.createElement("div");
  host.id = "jskelet-devtools";
  document.body.append(host);

  shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const root = document.createElement("div");
  root.innerHTML = SKELETON;
  shadow.append(style, root);

  return shadow;
}

/**
 * @param {number | null} value
 * @param {[number, number]} thresholds iyi/orta sınırları
 */
function grade(value, [good, mid]) {
  if (value == null) return "";
  if (value <= good) return "good";
  if (value <= mid) return "mid";
  return "bad";
}

/**
 * @param {number | null} value
 * @param {string} [unit]
 */
function ms(value, unit = "ms") {
  return value == null ? "—" : `${Math.round(value)} ${unit}`;
}

/** @param {number} bytes */
function kb(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Panel içindeki yolları tıklanabilir yapar; sayfa yeni sekmede açılır ki
 * incelenen oturum ve panel durumu bozulmasın. Yol gerçek bir URL değilse
 * (ör. boş) düz metin döner.
 *
 * @param {string} value
 * @returns {string}
 */
function pathLink(value) {
  const text = escapeHtml(value);
  if (!value?.startsWith("/")) return text;

  return `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer" title="Yeni sekmede aç: ${text}">${text}</a>`;
}

/** @param {string} value */
function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
  );
}

/**
 * Ölçüm kartı. `ratio` verilirse eşiklere göre dolan ince bir çubuk çizilir.
 * @param {{ label: string, value: string, tone?: string, ratio?: number | null }[]} items
 */
function metricGrid(items) {
  return `<div class="grid">${items
    .map((item) => {
      const width = Math.round(Math.min(1, Math.max(0.04, item.ratio ?? 0)) * 100);
      return `<div class="metric">
        <div class="label">${escapeHtml(item.label)}</div>
        <div class="value ${item.tone ?? ""}">${escapeHtml(item.value)}</div>
        ${
          item.ratio == null
            ? ""
            : `<div class="bar"><span class="${item.tone ?? ""}" style="width:${width}%"></span></div>`
        }
      </div>`;
    })
    .join("")}</div>`;
}

/**
 * @param {number | null} value
 * @param {number} ceiling
 * @returns {number | null}
 */
function ratio(value, ceiling) {
  return value == null ? null : value / ceiling;
}

/**
 * Kopyalanacak metinler HTML'e gömülmez; anahtarla burada tutulur.
 * @type {Map<string, string>}
 */
const clipboard = new Map();

/** Kısa süreli "kopyalandı" geri bildirimi için. */
let copiedKey = null;

/**
 * @param {{ level: string, message: string, stack?: string | null, source?: string, at: number }} item
 * @returns {string}
 */
function asText(item) {
  const time = new Date(item.at).toISOString();
  return [
    `[${item.level}] ${item.source ?? "server"} · ${time}`,
    item.message,
    item.stack ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** @param {{ id?: number, level: string, message: string, stack?: string | null, source?: string, at: number }[]} list */
function errorList(list, scope) {
  if (!list.length) return `<div class="empty">Kayıt yok.</div>`;
  return list
    .map((item) => {
      const key = `${scope}:${item.id ?? item.at}`;
      const shown = expanded.has(key);
      clipboard.set(key, asText(item));

      return `<div class="item ${item.level === "warn" ? "warn" : ""}">
        <div class="meta">
          <span class="tag">${escapeHtml(item.source ?? "server")}</span>
          <span>${new Date(item.at).toLocaleTimeString("tr-TR")}</span>
          <span class="spacer"></span>
          ${copyButton(key)}
        </div>
        <div class="msg">${escapeHtml(item.message)}</div>
        ${
          item.stack
            ? `<button class="link" data-action="stack" data-key="${escapeHtml(key)}">${shown ? "▾ yığını gizle" : "▸ yığını göster"}</button>
               ${shown ? `<pre>${escapeHtml(item.stack)}</pre>` : ""}`
            : ""
        }
      </div>`;
    })
    .join("");
}

const COPY_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"/></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.5 3.5L13 5"/></svg>`;

/**
 * @param {string} key
 * @param {string} [label]
 */
function copyButton(key, label = "") {
  const done = copiedKey === key;
  return `<button class="copy ${done ? "done" : ""}" data-action="copy" data-key="${escapeHtml(key)}"
    title="${done ? "Kopyalandı" : "Kopyala"}">${done ? CHECK_ICON : COPY_ICON}${
      label ? `<span>${escapeHtml(label)}</span>` : ""
    }</button>`;
}

/**
 * Sekmenin başındaki tek cümlelik anlatı.
 * @param {"good" | "mid" | "bad"} tone
 * @param {string} html
 */
function lede(tone, html) {
  const mark = tone === "good" ? "✓" : tone === "mid" ? "⚠" : "✕";
  return `<div class="lede ${tone}"><span class="mark">${mark}</span><span>${html}</span></div>`;
}

function errorsTab() {
  const server = serverStats?.errors ?? [];

  clipboard.set(
    "all",
    [...clientErrors, ...server.map((item) => ({ ...item, source: "server" }))]
      .map(asText)
      .join("\n\n"),
  );

  const total = clientErrors.length + server.length;
  const errorCount = [...clientErrors, ...server].filter(
    (item) => item.level === "error",
  ).length;

  return `
    ${lede(
      errorCount ? "bad" : total ? "mid" : "good",
      errorCount
        ? `<strong>${errorCount} hata</strong> yakalandı${total - errorCount ? `, yanında ${total - errorCount} uyarı var` : ""}. En yenisi üstte; yığın izini açıp kaydı tek tıkla kopyalayabilirsin.`
        : total
          ? `Hata yok, <strong>${total} uyarı</strong> var. Uyarılar genelde eksik veri ya da port edilmemiş island'lardan gelir.`
          : "Bu oturumda tarayıcı ya da sunucu tarafında hiç hata görülmedi.",
    )}
    <h4>Tarayıcı · ${clientErrors.length}${
      total ? `<span class="head-action">${copyButton("all", "tümünü kopyala")}</span>` : ""
    }</h4>
    ${errorList(clientErrors, "client")}
    <h4>Sunucu · ${server.length}</h4>
    ${errorList(
      server.map((item) => ({ ...item, source: "server" })),
      "server",
    )}
  `;
}

function perfTab() {
  const resources = resourceSummary();
  const islands = islandSummary();
  const memory = performance.memory?.usedJSHeapSize;

  const types = Object.entries(resources.byType)
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 6);

  const heaviest = types[0]?.[1].bytes ?? 1;

  clipboard.set(
    "perf",
    [
      `URL: ${location.href}`,
      `LCP: ${ms(metrics.lcp)}  CLS: ${metrics.cls.toFixed(3)}  INP: ${ms(metrics.inp)}`,
      `FCP: ${ms(metrics.fcp)}  TTFB: ${ms(metrics.ttfb)}`,
      `Long task: ${metrics.longTasks}  Blocking: ${ms(metrics.blocking)}`,
      `İstek: ${resources.count}  Transfer: ${kb(resources.bytes)}`,
      `Island: ${islands.ready}/${islands.total}`,
    ].join("\n"),
  );

  const vitals = [
    grade(metrics.lcp, [2500, 4000]),
    grade(metrics.cls * 1000, [100, 250]),
    grade(metrics.inp, [200, 500]),
  ];
  const tone = vitals.includes("bad") ? "bad" : vitals.includes("mid") ? "mid" : "good";

  return `
    ${lede(
      tone,
      `Sayfa <strong>${ms(metrics.lcp)}</strong>'de en büyük içeriği boyadı, düzen kayması <strong>${metrics.cls.toFixed(3)}</strong>. ` +
        `Ana iş parçacığı ${metrics.longTasks} uzun görevle <strong>${ms(metrics.blocking)}</strong> bloke oldu; ` +
        `${resources.count} istekte <strong>${kb(resources.bytes)}</strong> indirildi ve ${islands.total} island'ın ${islands.ready}'i bağlandı.`,
    )}
    <h4>Core Web Vitals<span class="head-action">${copyButton("perf", "özeti kopyala")}</span></h4>
    ${metricGrid([
      { label: "LCP", value: ms(metrics.lcp), tone: grade(metrics.lcp, [2500, 4000]), ratio: ratio(metrics.lcp, 4000) },
      { label: "CLS", value: metrics.cls.toFixed(3), tone: grade(metrics.cls * 1000, [100, 250]), ratio: metrics.cls / 0.25 },
      { label: "INP", value: ms(metrics.inp), tone: grade(metrics.inp, [200, 500]), ratio: ratio(metrics.inp, 500) },
      { label: "FCP", value: ms(metrics.fcp), tone: grade(metrics.fcp, [1800, 3000]), ratio: ratio(metrics.fcp, 3000) },
      { label: "TTFB", value: ms(metrics.ttfb), tone: grade(metrics.ttfb, [800, 1800]), ratio: ratio(metrics.ttfb, 1800) },
    ])}
    <h4>Yükleme</h4>
    ${metricGrid([
      { label: "DOMContentLoaded", value: ms(metrics.dcl) },
      { label: "Load", value: ms(metrics.load) },
      { label: "Long task", value: String(metrics.longTasks), tone: grade(metrics.longTasks, [2, 6]), ratio: metrics.longTasks / 6 },
      { label: "Blocking", value: ms(metrics.blocking), tone: grade(metrics.blocking, [200, 600]), ratio: metrics.blocking / 600 },
      ...(memory ? [{ label: "JS heap", value: kb(memory) }] : []),
    ])}
    <h4>Kaynaklar</h4>
    ${metricGrid([
      { label: "İstek", value: String(resources.count) },
      { label: "Transfer", value: kb(resources.bytes) },
      { label: "Island", value: `${islands.ready}/${islands.total}`, ratio: islands.total ? islands.ready / islands.total : null, tone: "good" },
    ])}
    <div class="rows" style="margin-top:8px">
      ${types
        .map(
          ([kind, info]) => `<div class="row">
            <span class="tag">${escapeHtml(kind)}</span>
            <span class="path">${info.count} istek</span>
            <span class="hint">${Math.round((info.bytes / heaviest) * 100)}%</span>
            <span>${kb(info.bytes)}</span>
          </div>`,
        )
        .join("")}
    </div>
  `;
}

function serverTab() {
  if (!serverStats) return `<div class="empty">Sunucu istatistikleri bekleniyor…</div>`;

  const requests = serverStats.requests ?? [];
  const slowest = requests.reduce((max, item) => Math.max(max, item.ms), 0);
  const average = requests.length
    ? requests.reduce((sum, item) => sum + item.ms, 0) / requests.length
    : null;

  clipboard.set(
    "requests",
    requests
      .map(
        (item) =>
          `${new Date(item.at).toISOString()} ${item.method} ${item.url} ${item.status} ${Math.round(item.ms)}ms${
            item.cache ? ` ${item.cache}` : ""
          }`,
      )
      .join("\n"),
  );

  return `
    ${lede(
      offline ? "mid" : grade(average, [150, 500]) || "good",
      offline
        ? "Sunucuya şu an ulaşılamıyor; yeniden başlatılmayı bekliyoruz. Eldeki kayıtlar korunuyor."
        : `Sunucu <strong>${Math.round(serverStats.uptime ?? 0)} sn</strong> ayakta, ` +
          `son ${requests.length} isteği ortalama <strong>${ms(average)}</strong> ile yanıtladı ` +
          `(en yavaş ${ms(slowest)}). Süreç ${kb(serverStats.memory?.rss ?? 0)} bellek kullanıyor` +
          `${restarts ? ` ve bu oturumda ${restarts} kez yeniden başladı` : ""}.`,
    )}
    <h4>Süreç${
      requests.length
        ? `<span class="head-action">${copyButton("requests", "istekleri kopyala")}</span>`
        : ""
    }</h4>
    ${metricGrid([
      { label: "Node", value: serverStats.node ?? "—" },
      { label: "Uptime", value: `${Math.round(serverStats.uptime ?? 0)} sn` },
      { label: "RSS", value: kb(serverStats.memory?.rss ?? 0) },
      { label: "Heap", value: kb(serverStats.memory?.heapUsed ?? 0) },
      { label: "Ort. render", value: ms(average), tone: grade(average, [150, 500]) },
      { label: "En yavaş", value: ms(slowest), tone: grade(slowest, [300, 1000]) },
      { label: "Restart", value: String(restarts), tone: offline ? "mid" : "" },
      ...(serverStats.prewarm?.total
        ? [
            {
              label: "Prewarm",
              value: `${serverStats.prewarm.ok}/${serverStats.prewarm.total}`,
              tone: serverStats.prewarm.failed ? "mid" : "good",
              ratio: serverStats.prewarm.done / serverStats.prewarm.total,
            },
          ]
        : []),
    ])}
    <h4>Son istekler</h4>
    ${
      requests.length
        ? `<div class="rows">${requests
            .map(
              (item) => `<div class="row">
                <span class="status ${item.status >= 500 ? "bad" : item.status >= 400 ? "warn" : ""}">${item.status}</span>
                <span class="path">${pathLink(item.url)}</span>
                <span class="hint">${escapeHtml(item.cache ?? "—")}</span>
                <span class="${grade(item.ms, [150, 500])}">${Math.round(item.ms)} ms</span>
              </div>`,
            )
            .join("")}</div>`
        : `<div class="empty">Henüz istek yok.</div>`
    }
  `;
}

function warmTab() {
  const warm = serverStats?.prewarm;

  if (!warm?.total) {
    return `
      ${warmToolbar(false)}
      <div class="empty">Önbellek ısıtması henüz başlamadı. Dev'de sunucu bir süre sakin kalınca tetiklenir; <code>PREWARM=0</code> ile kapatılabilir.</div>
    `;
  }

  const entries = warm.entries ?? [];
  const failures = entries.filter((item) => item.error);
  const bytes = entries.reduce((sum, item) => sum + item.bytes, 0);
  const slowest = entries.reduce(
    (max, item) => (item.ms > (max?.ms ?? -1) ? item : max),
    null,
  );
  const average = entries.length
    ? entries.reduce((sum, item) => sum + item.ms, 0) / entries.length
    : null;
  const elapsed = warm.finishedAt
    ? warm.finishedAt - warm.startedAt
    : Date.now() - warm.startedAt;
  const cached = entries.filter((item) => item.cache && item.cache !== "MISS").length;

  clipboard.set(
    "warm",
    [
      `Prewarm ${warm.ok}/${warm.total} · ${warm.failed} hata · ${(elapsed / 1000).toFixed(1)}s · ${kb(bytes)}`,
      ...entries.map(
        (item) =>
          `${String(item.status).padStart(3)} ${String(item.ms).padStart(5)}ms ${String(
            Math.round(item.bytes / 1024),
          ).padStart(5)}KB ${item.path}${item.error ? ` — ${item.error}` : ""}`,
      ),
    ].join("\n"),
  );

  return `
    ${warmToolbar(warm.active)}
    ${lede(
      warm.active ? "mid" : warm.failed ? "bad" : "good",
      warm.active
        ? `Isıtma sürüyor: <strong>${warm.done}/${warm.total}</strong> sayfa denendi, şu ana kadar ${kb(bytes)} render edildi.`
        : warm.failed
          ? `<strong>${warm.ok}/${warm.total}</strong> sayfa ısındı, <strong>${warm.failed} sayfa hata verdi</strong>. Hatalı yollar aşağıda en üstte listeli.`
          : `Tüm <strong>${warm.total}</strong> sayfa ${(elapsed / 1000).toFixed(1)} saniyede ısıtıldı, toplam <strong>${kb(bytes)}</strong> HTML üretildi. İlk ziyaretçi soğuk render beklemeyecek.`,
    )}
    <h4>Özet<span class="head-action">${copyButton("warm", "listeyi kopyala")}</span></h4>
    ${metricGrid([
      { label: "Denenen", value: `${warm.done}/${warm.total}`, ratio: warm.done / warm.total, tone: "good" },
      { label: "Başarılı", value: String(warm.ok), tone: "good" },
      { label: "Hata", value: String(warm.failed), tone: warm.failed ? "bad" : "" },
      { label: "Süre", value: `${(elapsed / 1000).toFixed(1)} sn` },
      { label: "Toplam HTML", value: kb(bytes) },
      { label: "Ort. render", value: ms(average), tone: grade(average, [150, 500]) },
      { label: "En yavaş", value: ms(slowest?.ms ?? null), tone: grade(slowest?.ms ?? null, [300, 1000]) },
      { label: "Cache'ten", value: `${cached}/${entries.length}` },
    ])}
    ${
      failures.length
        ? `<h4>Hatalar · ${failures.length}<span class="head-action">
             <button class="btn mini" data-action="warm-retry" ${warm.active ? "disabled" : ""}>${REFRESH_ICON} Tekrar dene</button>
           </span></h4>
           <div class="rows">${failures.map(warmRow).join("")}</div>`
        : ""
    }
    <h4>Denenen sayfalar · ${entries.length}</h4>
    ${
      entries.length
        ? `<div class="rows">${[...entries]
            .sort((a, b) => b.ms - a.ms)
            .map(warmRow)
            .join("")}</div>`
        : `<div class="empty">Henüz sonuç yok.</div>`
    }
  `;
}

/**
 * Sayfanın en üstündeki eylem şeridi.
 * @param {boolean} active ısıtma sürüyor mu
 */
function warmToolbar(active) {
  return `<div class="toolbar">
    <button class="btn mini" data-action="warm-run" ${active ? "disabled" : ""}>
      ${REFRESH_ICON} ${active ? "Isıtma sürüyor…" : "Baştan prewarm başlat"}
    </button>
  </div>`;
}

/**
 * @param {{ path: string, status: number, ms: number, bytes: number, cache: string | null, error: string | null }} item
 */
function warmRow(item) {
  return `<div class="row">
    <span class="status ${item.error ? "bad" : item.status >= 400 ? "warn" : ""}">${item.status || "—"}</span>
    <span class="path">${pathLink(item.path)}${
      item.error ? ` <span class="hint">${escapeHtml(item.error)}</span>` : ""
    }</span>
    <span class="hint">${item.bytes ? kb(item.bytes) : "—"}</span>
    <span class="${grade(item.ms, [300, 1000])}">${item.ms} ms</span>
  </div>`;
}

/**
 * Panel içindeki mini dokümantasyon. Anahtar sırası aynı zamanda alt sekme
 * sırasıdır; değer `{ label, html }`.
 */
const ABOUT = {
  framework: {
    label: "Framework",
    html: `
    <p><strong>JSkelet</strong>, hazır bir meta-framework kullanmadan yazılmış
    ince bir katman: Express üstünde EJS ile sunucu tarafı render, esbuild ile island
    tabanlı istemci kodu ve token'lara bağlı bir tema sistemi.</p>
    <div class="steps">
      <div class="step"><span class="n">1</span><span><b>Sunucu render</b><span>Express + EJS sayfayı tamamen sunucuda üretir; sonuç HTML önbelleğinde tutulur, tekrar eden istekler milisaniyenin altında döner.</span></span></div>
      <div class="step"><span class="n">2</span><span><b>Island'lar</b><span>Etkileşimli her parça <code>data-island</code> ile işaretlenir, modülü görünüm alanına girince yüklenir. Sayfanın tamamı hidrate edilmez.</span></span></div>
      <div class="step"><span class="n">3</span><span><b>Build hattı</b><span>esbuild JS'i, Tailwind + LightningCSS stilleri, sharp görselleri, Phosphor ikonları derler; çıktı hash'lenip <code>manifest.json</code>'a yazılır.</span></span></div>
      <div class="step"><span class="n">4</span><span><b>Dev döngüsü</b><span>Kaynaklar izlenir: CSS değişince stylesheet takas edilir, JS veya sunucu değişince tek seferlik tam yenileme yapılır.</span></span></div>
      <div class="step"><span class="n">5</span><span><b>Gözlemlenebilirlik</b><span>Bu panel hataları, Web Vitals ölçümlerini ve sunucu isteklerini toplar; kayıtlar sunucu yeniden başlasa da korunur.</span></span></div>
    </div>
    <div class="cards">
      <div class="card"><b>Çalışma zamanı</b><span>Node + Express 5, ESM. Sayfa şablonları EJS, veri katmanı <code>lib/</code> altındaki servisler.</span></div>
      <div class="card"><b>Hedef tarayıcılar</b><span>Chrome/Edge/Firefox 111+, Safari 16.4+. Modern CSS ve ESM doğrudan kullanılır, transpile yükü yok.</span></div>
      <div class="card"><b>Bu panel</b><span>Yalnızca <code>npm run dev</code>'de yüklenir; layout script etiketini sadece development'ta basar, prod çıktısına girmez.</span></div>
    </div>
  `,
  },
  request: {
    label: "İstek akışı",
    html: `
    <p>Bir sayfa isteğinin sunucuda izlediği yol. Her adım <code>server/</code> altında
    ayrı bir dosyada durur; hiçbiri diğerinin içine gömülü değildir.</p>
    <div class="steps">
      <div class="step"><span class="n">1</span><span><b>Route</b><span><code>server/routes/</code> URL'i eşler ve isteği ilgili controller'a verir.</span></span></div>
      <div class="step"><span class="n">2</span><span><b>Controller</b><span><code>server/controllers/</code> gerekli veriyi <code>lib/</code> servislerinden toplar, şablona geçecek modeli hazırlar.</span></span></div>
      <div class="step"><span class="n">3</span><span><b>Render</b><span><code>server/render.js</code> EJS şablonunu çalıştırır, layout'a manifest girdilerini ve head ipuçlarını basar.</span></span></div>
      <div class="step"><span class="n">4</span><span><b>HTML önbelleği</b><span><code>server/html-cache.js</code> çıktıyı saklar; aynı URL tekrar istenirse şablon hiç çalıştırılmaz. Sunucu sekmesindeki <code>cached</code> etiketi bunu gösterir.</span></span></div>
      <div class="step"><span class="n">5</span><span><b>Yanıt</b><span>Sıkıştırma ve önbellek başlıkları <code>server/middleware/</code> içinde belirlenir; olay akışı gibi yanıtlar sıkıştırmadan geçer.</span></span></div>
    </div>
    <p><strong>Ön ısıtma:</strong> <code>server/prewarm.js</code> açılışta sık gezilen
    rotaları kendi kendine ziyaret eder, böylece ilk gerçek ziyaretçi sıcak önbelleğe düşer.
    Aynı işi elle yapmak için <code>npm run warm</code>.</p>
  `,
  },
  islands: {
    label: "Island'lar",
    html: `
    <p>İstemci kodu sayfa başına tek bir dev bundle değil; parça parça yüklenen
    <strong>island</strong>'lardan oluşur. Şablon parçası HTML'i basar, island yalnızca
    davranışı ekler.</p>
    <div class="steps">
      <div class="step"><span class="n">1</span><span><b>İşaretleme</b><span>EJS partial'ı kök elemana <code>data-island="ad"</code> koyar.</span></span></div>
      <div class="step"><span class="n">2</span><span><b>Modül</b><span><code>client/islands/</code> altında aynı adla bir dosya bulunur ve mount fonksiyonunu dışa verir.</span></span></div>
      <div class="step"><span class="n">3</span><span><b>Yükleme</b><span><code>client/core/registry.js</code> IntersectionObserver ile eleman görünüm alanına yaklaşınca modülü dinamik import eder.</span></span></div>
      <div class="step"><span class="n">4</span><span><b>Bağlanma</b><span>Mount başarılıysa elemana <code>data-island-ready</code> yazılır. Performans sekmesindeki <b>Island</b> kartı bu oranı gösterir.</span></span></div>
    </div>
    <div class="cards">
      <div class="card"><b>Neden</b><span>Ekranın altındaki grafik, harita veya yorum bloğu için JS indirmeye ilk boyamada gerek yok.</span></div>
      <div class="card"><b>Hata izi</b><span>Bir island patlarsa hata bu panelin <b>Hatalar</b> sekmesine <code>client</code> kaynağıyla düşer, sayfanın kalanı çalışmaya devam eder.</span></div>
      <div class="card"><b>Stub'lar</b><span><code>build/tasks/island-stubs.mjs</code> eksik island dosyalarını yakalar; isim uyuşmazlıkları build'de görünür.</span></div>
    </div>
  `,
  },
  build: {
    label: "Build",
    html: `
    <p><code>npm run build</code> tüm varlıkları <code>build/generated/</code> altına
    üretir ve hash'li dosya adlarını <code>manifest.json</code>'a yazar. Şablonlar dosya
    adını asla elle yazmaz, hep manifest üzerinden okur.</p>
    <div class="rows">
      <div class="row"><span class="tag">client</span><span class="path">esbuild ile island'lar ve çekirdek JS; watch modunda artımlı yeniden paketleme.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">css</span><span class="path">Tailwind + PostCSS derlemesi, ardından LightningCSS ile küçültme ve tarayıcı hedefine indirme.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">icons</span><span class="path">Phosphor setinden yalnızca kullanılan ikonlar toplanır, tek sprite'a yazılır.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">fonts</span><span class="path">Font dosyaları alt kümelenip kopyalanır, preload ipuçları üretilir.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">images</span><span class="path">sharp ile boyut varyantları ve modern formatlar.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">precompress</span><span class="path">Statik çıktının gzip/brotli sürümleri önceden hazırlanır; sunucu istek anında sıkıştırmaz.</span><span class="hint"></span><span></span></div>
    </div>
    <p><code>npm start</code> öncesinde <code>build/ensure-build.mjs</code> çalışır: çıktı
    eksikse build kendiliğinden tetiklenir, yani derlenmemiş bir sunucu ayağa kalkmaz.</p>
  `,
  },
  dev: {
    label: "Dev akışı",
    html: `
    <p><code>npm run dev</code> tek bir süreç değil: <code>scripts/dev.mjs</code> build'i
    watch modunda başlatır, sunucuyu ayağa kaldırır ve ikisinin çıktısını tek bir
    okunur akışta birleştirir.</p>
    <div class="steps">
      <div class="step"><span class="n">1</span><span><b>İzleme</b><span>Yalnızca <code>server/</code>, <code>lib/</code> ve <code>views/</code> izlenir. Build çıktısı izlenmediği için kendi kendini tetikleyen restart döngüsü oluşmaz.</span></span></div>
      <div class="step"><span class="n">2</span><span><b>CSS takası</b><span>Stil değişince sayfa yenilenmez; yeni stylesheet yüklenip eskisi kaldırılır, kaydırma konumu ve açık paneller korunur.</span></span></div>
      <div class="step"><span class="n">3</span><span><b>Tam yenileme</b><span>JS veya sunucu kodu değişince tek seferlik reload yapılır. Sunucu süreç kimliği değiştiğinde de aynı yol izlenir.</span></span></div>
      <div class="step"><span class="n">4</span><span><b>Durum korunması</b><span>Panelin açık/kapalı durumu ve sekmesi sekme belleğinde; sunucu günlükleri ise süreç dışında saklanır. Restart panelin içeriğini silmez.</span></span></div>
    </div>
    <div class="cards">
      <div class="card"><b>Alt+D</b><span>Paneli açar/kapatır. <code>Esc</code> kapatır, karartma alanına tıklamak da kapatır.</span></div>
      <div class="card"><b>Sayfayı yenile</b><span>Panel açıkken yenileme yapar; yenileme sonrası panel aynı sekmeyle geri gelir.</span></div>
      <div class="card"><b>Kayıtları temizle</b><span>Tarayıcı ve sunucu taraflı hata/istek günlüklerini sıfırlar, paneli kapatmaz.</span></div>
    </div>
  `,
  },
  theme: {
    label: "Tema & UI",
    html: `
    <p>Stil kararları tek kaynaktan gelir. Renk, boşluk, radius ve tipografi
    token'ları <code>styles/theme.css</code> içindeki <code>:root</code> değişkenlerinde
    tanımlıdır; Tailwind sınıfları <code>styles/JSkelet.css</code> içindeki
    <code>@theme inline</code> bloğuyla bu token'lara bağlanır.</p>
    <div class="rows">
      <div class="row"><span class="tag">theme.css</span><span class="path">Token'lar ve <code>.wrapper</code>, <code>.clamp-2</code> gibi hazır sınıflar.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">JSkelet.css</span><span class="path">Tailwind utility eşlemeleri ve <code>.JSkelet-type-*</code> gibi bileşik sınıflar.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">components/ui</span><span class="path">Buton, kart, modal gibi yeniden kullanılabilir parçaların tek adresi.</span><span class="hint"></span><span></span></div>
    </div>
    <p><strong>Kural:</strong> yeni bir renk ya da ölçü gerektiğinde hex/pixel
    hardcode edilmez; önce token eklenir, gerekiyorsa Tailwind tarafına eşlenir,
    sonra bileşende kullanılır. Yeni genel amaçlı bir UI parçası da
    <code>views/components/ui/</code> dışına çıkmaz.</p>
  `,
  },
  commands: {
    label: "Komutlar",
    html: `
    <p>Sık kullanılan npm script'leri. Doğrulama script'leri belirli sayfaların
    beklenen parçaları içerip içermediğini gerçek çıktı üzerinden kontrol eder.</p>
    <div class="rows">
      <div class="row"><span class="tag">dev</span><span class="path">Build watch + sunucu, bu panelle birlikte.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">build</span><span class="path">Üretim çıktısı: JS, CSS, ikon, font, görsel, ön sıkıştırma.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">start</span><span class="path">Üretim sunucusu; öncesinde build eksikse tamamlanır.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">lint</span><span class="path">ESLint. Değişiklik sonrası varsayılan doğrulama yolu budur, tam build şart değil.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">warm</span><span class="path">Önbelleği elle ısıtır.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">perf</span><span class="path">Performans denetimi raporu üretir.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">verify:*</span><span class="path">Rota dumanı, head etiketleri, grafik, yorumlar, hisse sekmeleri, haber akışı ve ana sayfa widget'ları için hedefli kontroller.</span><span class="hint"></span><span></span></div>
    </div>
  `,
  },
  layout: {
    label: "Klasörler",
    html: `
    <p>Bir şeyi nerede arayacağını bilmek için kısa harita.</p>
    <div class="rows">
      <div class="row"><span class="tag">server/</span><span class="path">Express uygulaması: rotalar, controller'lar, middleware, render ve önbellek.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">views/</span><span class="path">EJS layout'u, sayfalar ve partial'lar. HTML'in tek kaynağı.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">client/</span><span class="path">Tarayıcı kodu: <code>core/</code> island altyapısı, <code>islands/</code> davranışlar, <code>devtools/</code> bu panel.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">lib/</span><span class="path">Veri servisleri ve alan mantığı; API çağrıları, dönüşümler, formatlayıcılar.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">app/</span><span class="path">Tema dosyaları ve paylaşılan UI bileşenleri.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">build/</span><span class="path">Derleme script'leri (<code>tasks/</code>) ve üretilen çıktı (<code>generated/</code>).</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">framework/</span><span class="path">Build ve dev süreçlerinin paylaştığı yardımcılar, terminal günlüğü dahil.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">scripts/</span><span class="path">Dev orkestrasyonu ve doğrulama/bakım araçları.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">public/</span><span class="path">Doğrudan servis edilen statik dosyalar.</span><span class="hint"></span><span></span></div>
      <div class="row"><span class="tag">docs/</span><span class="path">Uzun biçimli notlar ve karar kayıtları.</span><span class="hint"></span><span></span></div>
    </div>
  `,
  },
};

let aboutSection = "framework";

function aboutTab() {
  const section = ABOUT[aboutSection] ?? ABOUT.framework;

  return `
    ${lede(
      "good",
      `JSkelet ön yüzü kendi ince framework'ü üstünde çalışıyor: <strong>sunucuda HTML</strong>, ` +
        `tarayıcıda yalnızca gerekli <strong>island'lar</strong>. Bu sekme panelin içindeki kısa dokümantasyon.`,
    )}
    <div class="subtabs">
      ${Object.entries(ABOUT)
        .map(
          ([key, item]) =>
            `<button class="subtab" data-about="${key}" aria-selected="${aboutSection === key}">${escapeHtml(item.label)}</button>`,
        )
        .join("")}
    </div>
    <h4>${escapeHtml(section.label)}</h4>
    <div class="prose">${section.html}</div>
  `;
}

/** Gövde HTML'i yalnızca gerçekten değiştiyse yazılır (titreme + reflow). */
let lastBody = "";

/** @type {number | null} */
let frame = null;

/**
 * Ölçüm gözlemcileri ve yoklama aynı karede birçok kez tetikleniyordu; çizim
 * tek bir kareye toplanır.
 */
function render() {
  if (frame != null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    paint();
  });
}

/** Bitiş rozeti bu süre kadar daha görünür kalır. */
const WARM_LINGER_MS = 6000;

/**
 * Isıtma sürüyorsa ilerleme, bittikten kısa süre sonra da sonuç gösterilir;
 * ardından rozet kendiliğinden kaybolur.
 *
 * @param {ShadowRoot} root
 */
function paintPrewarm(root) {
  const chip = root.querySelector("[data-part='warm']");
  const warm = serverStats?.prewarm;

  if (!warm?.total) {
    chip.hidden = true;
    return;
  }

  const finished = !warm.active && warm.finishedAt;
  const lingering = finished && Date.now() - warm.finishedAt < WARM_LINGER_MS;

  if (!warm.active && !lingering) {
    chip.hidden = true;
    return;
  }

  chip.hidden = false;
  chip.className = `warm ${warm.active ? "" : "done"}`;
  chip.title = `Önbellek ısıtması: ${warm.ok} başarılı${
    warm.failed ? `, ${warm.failed} hata` : ""
  } / ${warm.total} sayfa`;
  chip.querySelector("[data-part='warm-text']").textContent = warm.active
    ? `${warm.done}/${warm.total} prewarmed`
    : `${warm.ok}/${warm.total} prewarmed`;

  // Bitiş rozetinin süresi dolduğunda kendiliğinden kaybolması için.
  if (!warm.active) setTimeout(render, WARM_LINGER_MS);
}

function paint() {
  const root = ensureRoot();

  const errorCount =
    clientErrors.filter((item) => item.level === "error").length +
    (serverStats?.errors ?? []).filter((item) => item.level === "error").length;
  const warnCount =
    clientErrors.length + (serverStats?.errors ?? []).length - errorCount;

  const tone = errorCount ? "bad" : warnCount ? "warn" : "";
  const badgeCount = errorCount || warnCount;
  const lcpLabel = metrics.lcp ? `${Math.round(metrics.lcp)} ms` : "ölçülüyor";

  const bubble = root.querySelector(".bubble");
  bubble.className = `bubble ${tone}`;
  bubble.title = `JSkelet dev araçları — LCP ${lcpLabel}${
    badgeCount ? `, ${errorCount} hata, ${warnCount} uyarı` : ""
  }`;

  const badge = root.querySelector(".badge");
  badge.hidden = !badgeCount;
  badge.className = `badge ${errorCount ? "" : "warn"}`;
  badge.textContent = badgeCount > 99 ? "99+" : String(badgeCount);

  paintPrewarm(root);

  const backdrop = root.querySelector(".backdrop");
  backdrop.hidden = !open;
  if (!open) return;

  const pill = root.querySelector(".pill");
  pill.className = `pill ${offline ? "warn" : tone}`;
  pill.querySelector("[data-part='pill']").textContent = offline
    ? "sunucu yeniden başlıyor…"
    : errorCount || warnCount
      ? `${errorCount} hata · ${warnCount} uyarı`
      : "sorun yok";

  const chip = root.querySelector("[data-part='chip']");
  chip.hidden = !errorCount;
  chip.textContent = String(errorCount);

  const warm = serverStats?.prewarm;
  const warmChip = root.querySelector("[data-part='warm-chip']");
  warmChip.hidden = !warm?.total;
  if (warm?.total) {
    warmChip.className = `chip ${warm.failed ? "" : "neutral"}`;
    warmChip.textContent = warm.active
      ? `${warm.done}/${warm.total}`
      : warm.failed
        ? String(warm.failed)
        : String(warm.ok);
  }

  for (const tab of root.querySelectorAll(".tab")) {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === activeTab));
  }

  const html =
    activeTab === "errors"
      ? errorsTab()
      : activeTab === "perf"
        ? perfTab()
        : activeTab === "about"
          ? aboutTab()
          : activeTab === "warm"
            ? warmTab()
            : serverTab();

  if (html !== lastBody) {
    const body = root.querySelector(".body");
    const scrollTop = body.scrollTop;
    body.innerHTML = html;
    body.scrollTop = scrollTop;
    lastBody = html;
  }
}

/**
 * Kaydı panoya alır ve butonu kısa süre onay durumuna geçirir.
 * @param {string} key
 */
async function copy(key) {
  const text = clipboard.get(key);
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // İzin verilmemiş olabilir (odak dışı sekme vb.); eski yönteme düş.
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }

  copiedKey = key;
  // İkon değişimi görünsün diye gövde yeniden çizilir.
  lastBody = "";
  render();

  setTimeout(() => {
    if (copiedKey !== key) return;
    copiedKey = null;
    lastBody = "";
    render();
  }, 1400);
}

/** @param {boolean} value */
function setOpen(value) {
  open = value;
  saveState();
  render();
  if (open) pollServer();
}

/** @param {ShadowRoot} root */
function bind(root) {
  root.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target).closest(
      "[data-action], [data-tab], [data-about]",
    );
    if (!target) return;

    if (target.dataset.about) {
      aboutSection = target.dataset.about;
      saveState();
      render();
      return;
    }

    if (target.dataset.tab) {
      activeTab = target.dataset.tab;
      saveState();
      render();
      return;
    }

    if (target.dataset.action === "stack") {
      const key = target.dataset.key;
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      saveState();
      render();
      return;
    }

    if (target.dataset.action === "toggle") {
      setOpen(!open);
      return;
    }

    // Panel dışına (karartma alanına) tıklamak kapatır.
    if (target.dataset.action === "backdrop" && event.target === target) {
      setOpen(false);
      return;
    }

    if (target.dataset.action === "reload") {
      // Panelin açık kalması durumun sekme belleğine yazılmasına bağlı.
      saveState();
      location.reload();
      return;
    }

    if (target.dataset.action === "warm-run") {
      startPrewarm();
      return;
    }

    if (target.dataset.action === "warm-retry") {
      startPrewarm(
        (serverStats?.prewarm?.entries ?? [])
          .filter((item) => item.error)
          .map((item) => item.path),
      );
      return;
    }

    if (target.dataset.action === "copy") {
      copy(target.dataset.key);
      return;
    }

    if (target.dataset.action === "clear") clearAll();
  });
}

function start() {
  loadState();
  captureErrors();
  captureMetrics();
  captureFetch();
  bind(ensureRoot());
  render();

  connectEvents();

  setInterval(() => {
    // Panel kapalıyken de rozet güncel kalsın diye sunucu yine yoklanır.
    pollServer();
  }, POLL_MS);
  pollServer();

  // Ölçümler oturmadan gönderilmesin; sonra sekmeden ayrılırken güncellenir.
  setTimeout(() => sendPageReport(), 3000);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sendPageReport(true);
  });
  window.addEventListener("pagehide", () => sendPageReport(true));

  window.addEventListener("keydown", (event) => {
    if (event.altKey && event.code === "KeyD") {
      setOpen(!open);
      return;
    }

    if (event.key === "Escape" && open) setOpen(false);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}
