/**
 * Admin panelinin istemci tarafı.
 *
 * Build hattından geçmez, doğrudan diskten servis edilir: panelin açık olduğu
 * bir kurulumda `jskelet build` hiç koşmamış olabilir ve panel yine çalışmalı.
 * Bu yüzden burada import edilen bir framework modülü yok.
 *
 * Yenileme WebSocket değil, kısa aralıklı `fetch` ile: panel nadiren ve kısa
 * süre açık kalıyor, kalıcı bir kanal açmanın karşılığı yok. Log sayfası
 * ayrıca SSE kullanır.
 *
 * Bütün görünen metin `i18n.js` üzerinden geçiyor; sunucudan gelen cevaplar da
 * metin değil `code` taşıyor, yani dil değişimi tek yerden hallediliyor.
 */
import { applyTranslations, languageSelect, t } from "./i18n.js";

const REFRESH_MS = 3000;
const PAGES = new Set(["overview", "cache", "routes", "views", "logs", "system"]);

const $ = (/** @type {string} */ id) => document.getElementById(id);

/** @type {"html" | "data"} */
let tab = "html";
let query = "";
/** @type {any} */
let latest = null;
/** @type {number | null} */
let timer = null;
let busy = false;
/** @type {string} */
let page = "overview";
/** @type {any} */
let routesPayload = null;
/** @type {any} */
let viewsPayload = null;
/** @type {any[]} */
let logBuffer = [];
/** @type {EventSource | null} */
let logSource = null;
let logsPaused = false;

/* ------------------------------------------------------------ biçimlendirme */

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** power;
  return `${value >= 100 || power === 0 ? Math.round(value) : value.toFixed(1)} ${units[power]}`;
}

/**
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const [s, m, h, d] = [t("unit.second"), t("unit.minute"), t("unit.hour"), t("unit.day")];

  if (total < 60) return `${total}${s}`;
  if (total < 3600) return `${Math.floor(total / 60)}${m} ${total % 60}${s}`;
  if (total < 86_400) {
    return `${Math.floor(total / 3600)}${h} ${Math.floor((total % 3600) / 60)}${m}`;
  }
  return `${Math.floor(total / 86_400)}${d} ${Math.floor((total % 86_400) / 3600)}${h}`;
}

/**
 * @param {string} message
 * @param {boolean} [ok]
 */
function toast(message, ok = true) {
  const node = document.createElement("div");
  node.className = ok ? "toast" : "toast bad";
  node.textContent = message;
  $("toast").append(node);

  setTimeout(() => node.remove(), 5000);
}

/* -------------------------------------------------------------------- veri */

/**
 * Sunucu yetkisiz isteklere 404 dönüyor (panelin varlığını doğrulamamak
 * için). Oturum düştüyse sayfa yeniden yüklenir ve giriş formuna dönülür;
 * arka planda dönmeye devam eden bir yoklama, IP'yi kendi kendine
 * yasaklatırdı.
 *
 * @param {Response} response
 * @returns {boolean} İstek işlenebilir mi.
 */
function alive(response) {
  if (response.status !== 404) return true;

  stopPolling();
  location.reload();
  return false;
}

async function load() {
  if (busy) return;
  busy = true;

  try {
    const response = await fetch(`data?q=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
    });
    if (!alive(response)) return;
    if (!response.ok) return;

    latest = await response.json();
    render();
  } catch {
    // Sunucu yeniden başlıyor olabilir; bir sonraki tur dener.
  } finally {
    busy = false;
  }
}

/**
 * @param {Record<string, unknown>} body
 * @returns {Promise<void>}
 */
async function act(body) {
  const response = await fetch("action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Panelin CSRF freni: çapraz siteden gönderilemeyen bir başlık.
      "X-JSkelet-Admin": "1",
    },
    body: JSON.stringify(body),
  });

  if (!alive(response)) return;

  const result = await response.json().catch(() => null);
  toast(describe(result), result?.ok !== false);
  await load();

  // Cloudflare ayarları değişmiş olabilir; genel bakış önbelleği atlanır.
  if (String(body.type ?? "").startsWith("cf:")) await loadCloudflare(true);
}

/**
 * Sunucu cevabını metne çevirir.
 *
 * `/action` dil taşımıyor: `{ ok, code, params }` dönüyor ve cümle burada
 * kuruluyor. Redis sayımı gibi parçalı cevaplar `parts` ile geliyor, çünkü
 * "veritabanında kaç anahtar var" bilgisi her zaman okunamıyor ve eksik parçayı
 * cümleden düşürmek tek düzgün yol.
 *
 * @param {any} result
 * @returns {string}
 */
function describe(result) {
  if (!result) return t("toast.failed");

  if (Array.isArray(result.parts)) {
    const parts = result.parts
      .map((/** @type {any} */ part) => t(`msg.${part.code}`, part.params))
      .filter(Boolean);
    if (parts.length) return parts.join(" · ");
  }

  if (result.code) return t(`msg.${result.code}`, result.params);
  return t(result.ok ? "toast.done" : "toast.failed");
}

/* ------------------------------------------------------------------- çizim */

function render() {
  if (!latest) return;

  const { process: proc, release, host, html, data, redis, prewarm } = latest;

  $("version").textContent = `v${release.version}`;
  $("foot-release").textContent = [
    `v${release.version}`,
    release.license,
    release.node ? `Node ${release.node}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (release.homepage) $("foot-repo").href = release.homepage;

  $("env").textContent = proc.env;
  $("pid").textContent = `pid ${proc.pid}`;
  $("uptime").textContent = t("chip.up", { value: formatDuration(proc.uptime) });
  $("memory").textContent = `rss ${formatBytes(proc.memory.rss)}`;

  $("html-size").textContent = html.size.toLocaleString();
  $("html-sub").textContent = t("card.limit", { count: html.maxEntries.toLocaleString() });
  $("html-bytes").textContent = formatBytes(html.bytes);
  $("html-stale").textContent = t("card.stale", { count: html.stale });

  $("data-size").textContent = data.size.toLocaleString();
  $("data-sub").textContent = t("card.staleAndLimit", {
    stale: data.stale,
    limit: data.maxEntries.toLocaleString(),
  });

  const redisState = !redis.enabled
    ? "off"
    : redis.bypassed
      ? "bypassed"
      : redis.connected
        ? "connected"
        : "disconnected";

  $("redis-state").textContent = t(`state.${redisState}`);
  $("redis-sub").textContent = redis.enabled
    ? t("redis.sub", { address: redis.address, errors: redis.errors })
    : t("redis.disabled");

  renderRedis(redis, redisState);
  renderHost(host, proc, redis);
  renderUpstream(latest.upstream);

  const done = prewarm.done ?? 0;
  const total = prewarm.total ?? 0;
  $("prewarm-state").textContent = prewarm.active ? `${done}/${total}` : t("state.idle");
  $("prewarm-sub").textContent = prewarm.active
    ? t("prewarm.inProgress")
    : total
      ? t("prewarm.lastRound", { done, total })
      : t("prewarm.never");

  renderTable();
}

/**
 * @param {any} upstream
 */
function renderUpstream(upstream) {
  const tbody = $("upstream-tbody");
  const empty = $("upstream-empty");
  const heading = $("upstream-heading");
  if (!tbody || !empty || !heading) return;

  const hosts = Array.isArray(upstream) ? upstream : [];
  heading.textContent = String(hosts.length);
  tbody.replaceChildren();

  if (!hosts.length) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  for (const info of hosts) {
    const row = document.createElement("tr");
    const state = info?.bypassed
      ? "bypassed"
      : info?.blockedMs > 0
        ? "blocked"
        : `${info?.active ?? 0} active`;
    row.innerHTML = `<td class="mono">${escapeHtml(String(info.host ?? ""))}</td><td class="mono">${escapeHtml(String(info.rate ?? "—"))}</td><td class="mono">${escapeHtml(String(state))}</td>`;
    tbody.append(row);
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ------------------------------------------------------------- cloudflare */

/** @type {any} */
let cloudflare = null;

/**
 * Cloudflare genel bakışı ayrı bir uçtan gelir: zone bilgisi ve ayarlar ağa
 * çıkıyor, döküm turu ise saniyeler mertebesinde yenileniyor. Bu yüzden
 * yalnızca açılışta ve bir işlemden sonra istenir.
 *
 * @param {boolean} [force]
 */
async function loadCloudflare(force = false) {
  const response = await fetch(`cloudflare${force ? "?force=1" : ""}`);
  if (!alive(response)) return;

  cloudflare = await response.json().catch(() => null);
  renderCloudflare();
}

function renderCloudflare() {
  if (!cloudflare) return;

  const ok = cloudflare.ok === true;
  const status = cloudflare.status ?? {};
  const settings = cloudflare.settings ?? {};
  const zone = cloudflare.zone ?? null;

  $("cf-heading").textContent = ok
    ? [zone?.name, zone?.plan].filter(Boolean).join(" · ") || t("state.connected")
    : status.configured
      ? t("cf.error", { error: cloudflare.error })
      : t("cf.notConnected");

  $("cf-tools").hidden = !ok;
  $("cf-suggest").hidden = ok || status.configured;
  $("cf-refresh").hidden = !status.configured;

  if (!ok) {
    $("cf-kv").replaceChildren();
    return;
  }

  const development = settings.developmentMode === "on";
  $("cf-dev").checked = development;

  /** @type {[string, string, string?][]} */
  const rows = [
    [t("cf.zone"), `${zone?.name ?? "—"} (${status.zoneId ?? "?"})`],
    [t("cf.plan"), zone?.plan ?? "—"],
    [
      t("cf.token"),
      status.tokenSource === "env" ? t("cf.token.env") : t("cf.token.config"),
      "on",
    ],
    [
      t("cf.devModeLabel"),
      development
        ? t("cf.devMode.on", { time: formatDuration(settings.developmentModeRemaining) })
        : t("state.off"),
      development ? "bad" : "on",
    ],
    [t("cf.cacheLevel"), String(settings.cacheLevel ?? "—")],
    [t("cf.browserTtl"), ttl(settings.browserCacheTtl)],
    [t("cf.edgeTtl"), ttl(settings.edgeCacheTtl)],
    [t("cf.sortQuery"), String(settings.sortQueryString ?? "—")],
    [t("cf.alwaysOnline"), String(settings.alwaysOnline ?? "—")],
    ...feature(t("cf.tiered"), settings.tieredCaching),
    ...feature(t("cf.regionalTiered"), settings.regionalTieredCache),
    ...feature(t("cf.reserve"), settings.cacheReserve),
  ];

  $("cf-kv").replaceChildren(...rows.map(kvRow));
}

/**
 * Plan dışı kalan bir özellik `null` döner. "off" yazmak yanıltıcı olurdu:
 * kapatılmış değil, o planda hiç yok.
 *
 * @param {string} label
 * @param {string | null} value
 * @returns {[string, string, string?][]}
 */
function feature(label, value) {
  if (value === null || value === undefined) {
    return [[label, t("cf.unavailablePlan"), "off"]];
  }
  const on = value === "on";
  return [[label, on ? t("state.on") : t("state.off"), on ? "on" : "off"]];
}

/**
 * @param {unknown} seconds
 * @returns {string}
 */
function ttl(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return "—";
  // Cloudflare 0'ı "Respect Existing Headers" olarak kullanıyor.
  if (value === 0) return t("cf.respectOrigin");
  return formatDuration(value);
}

/**
 * @param {[string, string, string?]} row
 * @returns {HTMLDivElement}
 */
function kvRow([label, value, tone]) {
  const wrap = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  if (tone) dd.className = tone;
  dd.textContent = value;
  wrap.append(dt, dd);
  return wrap;
}

/**
 * Analitik dökümü. İki soru tek uçtan cevaplanıyor: yol verilirse kolo
 * kırılımı, verilmezse zone genelinde cache durumu dağılımı.
 */
async function loadCloudflareAnalytics() {
  const path = $("cf-path").value.trim();
  const target = $("cf-report");

  target.hidden = false;
  target.textContent = t("cf.querying");

  const response = await fetch("cloudflare/analytics", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-JSkelet-Admin": "1",
    },
    body: JSON.stringify({ path }),
  });

  if (!alive(response)) return;

  const result = await response.json().catch(() => null);

  if (!result?.ok) {
    target.textContent = t("msg.cf.failed", { error: result?.error ?? t("cf.queryFailed") });
    return;
  }

  // Son dökümü dil değişiminde yeniden kurmak için saklanır: tablo ağdan
  // geliyor ve dil değişti diye Cloudflare'e yeniden gitmek gereksiz.
  lastReport = result;
  renderReport();
}

/** @type {any} */
let lastReport = null;

function renderReport() {
  if (!lastReport) return;
  const result = lastReport;

  $("cf-report").replaceChildren(
    result.colos ? edgeTable(result) : statusTable(result),
    note(
      result.colos
        ? t("cf.edgeNote", {
            colos: result.colos.length,
            path: result.path,
            hours: result.hours,
            hits: result.hits,
            misses: result.misses,
          })
        : t("cf.zoneNote", { hours: result.hours }),
    ),
  );
}

/**
 * @param {any} result
 * @returns {HTMLTableElement}
 */
function edgeTable(result) {
  return buildTable(
    [t("cf.colo"), t("cf.fromCache"), t("cf.toOrigin")],
    result.colos.map((/** @type {any} */ row) => [
      row.colo,
      String(row.hits),
      String(row.misses),
    ]),
  );
}

/**
 * @param {any} result
 * @returns {HTMLTableElement}
 */
function statusTable(result) {
  const total = result.rows.reduce((sum, /** @type {any} */ row) => sum + row.requests, 0) || 1;

  return buildTable(
    [t("cf.cacheStatus"), t("cf.requests"), t("cf.share"), t("cf.edgeBytes")],
    result.rows.map((/** @type {any} */ row) => [
      row.status,
      row.requests.toLocaleString(),
      `${Math.round((row.requests / total) * 100)}%`,
      formatBytes(row.bytes),
    ]),
  );
}

/**
 * @param {string[]} headers
 * @param {string[][]} rows
 * @returns {HTMLTableElement}
 */
function buildTable(headers, rows) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  headers.forEach((label, index) => {
    const th = document.createElement("th");
    th.textContent = label;
    if (index > 0) th.className = "num";
    headRow.append(th);
  });

  thead.append(headRow);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    row.forEach((value, index) => tr.append(cell(value, index > 0 ? "num" : undefined)));
    tbody.append(tr);
  }

  table.append(thead, tbody);
  return table;
}

/**
 * @param {string} text
 * @returns {HTMLParagraphElement}
 */
function note(text) {
  const paragraph = document.createElement("p");
  paragraph.className = "note m0";
  paragraph.textContent = text;
  return paragraph;
}

/**
 * Paylaşımlı kademenin künyesi.
 *
 * "Bağlı mı" tek başına yetmiyor: yanlış `namespace` ya da beklenmeyen bir
 * `buildId` ile bağlı bir Redis de hiçbir şey paylaşmıyor gibi görünür. Bu
 * yüzden anahtarın **nerede** durduğu ve hangi türlerin paylaşıldığı da
 * yazılır.
 *
 * @param {any} redis
 * @param {string} state
 */
function renderRedis(redis, state) {
  $("redis-heading").textContent = redis.enabled ? t(`state.${state}`) : t("state.notConfigured");
  $("redis-actions").hidden = !redis.enabled;
  $("redis-suggest").hidden = redis.enabled;

  /** @type {[string, string, string?][]} */
  const rows = redis.enabled
    ? [
        [
          t("redis.connection"),
          t(`state.${state}`),
          redis.connected && !redis.bypassed ? "on" : "bad",
        ],
        [t("redis.address"), `${redis.address}${redis.secure ? " (TLS)" : ""}`],
        [t("redis.database"), redis.db ?? t("state.default")],
        [t("redis.keyPrefix"), `${redis.keyPrefix}:${redis.namespace}`],
        [t("redis.buildId"), redis.buildId || "dev"],
        [
          t("redis.sharesHtml"),
          redis.html ? t("state.yes") : t("state.no"),
          redis.html ? "on" : "off",
        ],
        [
          t("redis.sharesData"),
          redis.data ? t("state.yes") : t("state.no"),
          redis.data ? "on" : "off",
        ],
        [
          t("redis.compressed"),
          redis.storeEncoded ? t("redis.compressed.shared") : t("redis.compressed.local"),
          redis.storeEncoded ? "on" : "off",
        ],
        [
          t("redis.broadcast"),
          redis.events
            ? redis.subscribed
              ? t("redis.broadcast.subscribed")
              : t("redis.broadcast.publish")
            : t("state.off"),
          redis.events && redis.subscribed ? "on" : "off",
        ],
        [t("redis.timeout"), `${redis.commandTimeoutMs} ${t("unit.ms")}`],
        [t("redis.errors"), String(redis.errors), redis.errors ? "bad" : "on"],
      ]
    : [
        [t("redis.tier"), t("redis.tier.inProcess")],
        [t("redis.replicas"), t("state.none")],
        [t("redis.broadcast"), t("redis.broadcast.local"), "off"],
      ];

  $("redis-kv").replaceChildren(...rows.map(kvRow));
}

/**
 * Makinenin RAM ve disk durumu. Paylaşımlı kademe kapalıyken önbelleğin
 * tamamı bu sürecin belleğinde yaşıyor; `maxEntries` ile RAM arasındaki
 * ilişkiyi görmeden ayar yapmak körlemesine oluyor.
 *
 * @param {any} host
 * @param {any} proc
 * @param {any} redis
 */
function renderHost(host, proc, redis) {
  $("host-heading").textContent = [
    host.platform,
    `${host.cpus} cpu`,
    host.load ? `load ${host.load.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const ramUsed = host.memory.used / host.memory.total;
  $("ram-text").textContent =
    `${formatBytes(host.memory.used)} / ${formatBytes(host.memory.total)}`;
  meter("ram-bar", ramUsed);
  $("ram-note").textContent = redis.connected
    ? t("host.ramShared", { rss: formatBytes(proc.memory.rss) })
    : t("host.ramOnly", {
        rss: formatBytes(proc.memory.rss),
        html: formatBytes(latest.html.bytes),
      });

  if (!host.disk) {
    $("disk-text").textContent = t("state.unavailable");
    meter("disk-bar", 0);
    $("disk-note").textContent = t("host.noStats");
    return;
  }

  const diskUsed = (host.disk.total - host.disk.free) / host.disk.total;
  $("disk-text").textContent =
    `${formatBytes(host.disk.total - host.disk.free)} / ${formatBytes(host.disk.total)}`;
  meter("disk-bar", diskUsed);
  // Önbellek diske yazılmıyor; disk build çıktısı ve log için önemli.
  $("disk-note").textContent = t("host.diskNote", {
    free: formatBytes(host.disk.free),
    path: host.disk.path,
  });
}

/**
 * @param {string} id
 * @param {number} ratio 0–1
 */
function meter(id, ratio) {
  const bar = $(id);
  const percent = Math.max(0, Math.min(100, ratio * 100));
  bar.style.width = `${percent}%`;
  bar.className = percent >= 90 ? "bad" : percent >= 75 ? "warn" : "";
}

function renderTable() {
  const source = tab === "html" ? latest.html : latest.data;
  const thead = $("thead");
  const tbody = $("tbody");

  $("listed").textContent =
    source.matched > source.entries.length
      ? t("entries.shownPartial", { shown: source.entries.length, total: source.matched })
      : t("entries.shown", { total: source.matched });

  const columns =
    tab === "html"
      ? [
          ["entries.key"],
          ["entries.state"],
          ["entries.size", "num"],
          ["entries.status", "num"],
          ["entries.expires", "num"],
          ["entries.deps", "num"],
          ["entries.encodings"],
          [null],
        ]
      : [["entries.key"], ["entries.state"], ["entries.expires", "num"], [null]];

  const headRow = document.createElement("tr");
  for (const [key, className] of columns) {
    const th = document.createElement("th");
    if (className) th.className = className;
    if (key) th.textContent = t(key);
    headRow.append(th);
  }
  thead.replaceChildren(headRow);

  tbody.replaceChildren(
    ...source.entries.map((/** @type {any} */ entry) => row(entry)),
  );

  $("empty").hidden = source.entries.length > 0;
}

/**
 * @param {any} entry
 * @returns {HTMLTableRowElement}
 */
function row(entry) {
  const tr = document.createElement("tr");

  const key = document.createElement("td");
  key.className = "key mono";

  if (tab === "html") {
    // HTML anahtarı gezilebilir bir yol: yeni sekmede açmak, bir sayfanın
    // neden bayat olduğunu anlamanın en kısa yolu. `noreferrer` panelin
    // yolunu `Referer` başlığıyla sızdırmamak için.
    const link = document.createElement("a");
    link.href = entry.url;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = entry.url;
    key.append(link);
  } else {
    // Veri anahtarı bir URL değil; tıklamanın işe yarar karşılığı onu
    // `clearDataCache()` çağrısına yapıştırabilmek.
    const copy = document.createElement("button");
    copy.className = "as-text";
    copy.type = "button";
    copy.title = t("entries.copyKey");
    copy.textContent = entry.key;
    copy.addEventListener("click", () => void copyKey(entry.key));
    key.append(copy);
  }

  tr.append(key);

  const state = document.createElement("td");
  const tag = document.createElement("span");
  tag.className = entry.stale ? "tag stale" : "tag fresh";
  tag.textContent = entry.stale ? t("entries.stale") : t("entries.fresh");
  state.append(tag);
  tr.append(state);

  if (tab === "html") {
    tr.append(
      cell(formatBytes(entry.bytes), "num"),
      cell(String(entry.status), "num"),
      cell(entry.stale ? "—" : formatDuration(entry.expiresIn), "num"),
      cell(String(entry.deps), "num"),
      cell(entry.encodings.length ? entry.encodings.join(", ") : "—"),
    );
  } else {
    tr.append(cell(entry.stale ? "—" : formatDuration(entry.expiresIn), "num"));
  }

  const actions = document.createElement("td");
  actions.className = "actions";

  // Tek satırı hem origin'den hem edge'den düşürmek en sık istenen çift
  // işlem; Cloudflare bağlı değilse düğme hiç çıkmaz.
  if (tab === "html" && cloudflare?.ok) {
    const purge = document.createElement("button");
    purge.className = "tiny";
    purge.textContent = t("cf.rowPurge");
    purge.title = t("cf.rowPurgeTitle");
    purge.addEventListener("click", () => {
      void act({ type: "cf:purge-urls", paths: [entry.url] });
    });
    actions.append(purge);
  }

  const drop = document.createElement("button");
  drop.className = "tiny danger";
  drop.textContent = t("entries.drop");
  drop.addEventListener("click", () => {
    void act({ type: tab === "html" ? "html:drop" : "data:drop", key: entry.key });
  });

  actions.append(drop);
  tr.append(actions);

  return tr;
}

/**
 * Panel `http://localhost` dışında da açılabiliyor ve tarayıcı güvensiz
 * kaynaklarda pano API'sini vermiyor; o durumda anahtar seçili bırakılır.
 *
 * @param {string} key
 */
async function copyKey(key) {
  try {
    await navigator.clipboard.writeText(key);
    toast(t("toast.keyCopied"));
  } catch {
    $("prefix").value = key;
    $("prefix").focus();
    toast(t("toast.clipboard"), false);
  }
}

/**
 * @param {string} text
 * @param {string} [className]
 * @returns {HTMLTableCellElement}
 */
function cell(text, className) {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

/* ------------------------------------------------------------------ olaylar */

function startPolling() {
  stopPolling();
  timer = setInterval(load, REFRESH_MS);
}

function stopPolling() {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

$("auto").addEventListener("change", (event) => {
  if (/** @type {HTMLInputElement} */ (event.target).checked) startPolling();
  else stopPolling();
});

$("refresh").addEventListener("click", () => void load());

$("logout").addEventListener("click", async () => {
  stopPolling();
  await fetch("logout", { method: "POST" });
  location.reload();
});

// Arama her tuşta sunucuya gitmez: on binlerce anahtarlı bir önbellekte
// filtreleme sunucuda yapılıyor.
let searchTimer = 0;
$("search").addEventListener("input", (event) => {
  query = /** @type {HTMLInputElement} */ (event.target).value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 200);
});

for (const name of /** @type {const} */ (["html", "data"])) {
  $(`tab-${name}`).addEventListener("click", () => {
    tab = name;
    $("tab-html").setAttribute("aria-selected", String(name === "html"));
    $("tab-data").setAttribute("aria-selected", String(name === "data"));
    renderTable();
  });
}

$("invalidate").addEventListener("click", () => {
  const target = $("target").value.trim();
  if (!target) {
    toast(t("toast.needTarget"), false);
    return;
  }

  void act({ type: "html:invalidate", target, hard: $("hard").checked });
});

$("clear-html").addEventListener("click", () => {
  if (!confirm(t("confirm.clearHtml"))) return;
  void act({ type: "html:clear" });
});

$("clear-data").addEventListener("click", () => {
  const prefix = $("prefix").value.trim();
  if (!prefix && !confirm(t("confirm.clearData"))) {
    return;
  }

  void act({ type: "data:clear", prefix });
});

$("prewarm").addEventListener("click", () => void act({ type: "prewarm" }));

// Sayım ayrı bir düğme: her döküm turunda tüm keyspace'i taramak Redis'i
// teşhis uğruna yormak olurdu.
$("redis-inspect").addEventListener("click", () => void act({ type: "redis:inspect" }));

$("redis-html").addEventListener("click", () =>
  void act({ type: "redis:drop", kind: "html" }),
);

$("redis-data").addEventListener("click", () =>
  void act({ type: "redis:drop", kind: "data" }),
);

/* ------------------------------------------------- cloudflare kontrolleri */

$("cf-refresh").addEventListener("click", () => void loadCloudflare(true));

$("cf-purge-all").addEventListener("click", () => {
  if (!confirm(t("confirm.purgeAll"))) return;
  void act({ type: "cf:purge-everything" });
});

// Bu kurulumda sıcak olan yollar zaten biliniyor; "her şeyi düşür" yerine
// yalnızca gerçekten servis edilen sayfaları düşürmek edge'i boşa soğutmaz.
$("cf-purge-cached").addEventListener("click", () => {
  const paths = (latest?.html.entries ?? []).map((/** @type {any} */ entry) => entry.url);
  if (!paths.length) {
    toast(t("toast.noCachedPages"), false);
    return;
  }

  if (!confirm(t("confirm.purgeUrls", { count: paths.length }))) return;
  void act({ type: "cf:purge-urls", paths });
});

$("cf-purge-keys").addEventListener("click", () => {
  const values = $("cf-values").value.trim();
  if (!values) {
    toast(t("toast.needValue"), false);
    return;
  }

  void act({ type: "cf:purge-keys", kind: $("cf-kind").value, values });
});

$("cf-dev").addEventListener("change", (event) => {
  const on = /** @type {HTMLInputElement} */ (event.target).checked;
  void act({ type: "cf:setting", id: "development_mode", value: on ? "on" : "off" });
});

$("cf-tiered").addEventListener("click", () => {
  const current = cloudflare?.settings?.tieredCaching;
  void act({ type: "cf:feature", feature: "tiered_caching", value: flip(current) });
});

$("cf-reserve").addEventListener("click", () => {
  const current = cloudflare?.settings?.cacheReserve;
  void act({ type: "cf:feature", feature: "cache_reserve", value: flip(current) });
});

$("cf-reserve-clear").addEventListener("click", () => {
  if (!confirm(t("confirm.clearReserve"))) return;
  void act({ type: "cf:clear-reserve" });
});

$("cf-analytics").addEventListener("click", () => void loadCloudflareAnalytics());

/**
 * @param {string | null | undefined} value
 * @returns {"on" | "off"}
 */
function flip(value) {
  return value === "on" ? "off" : "on";
}

// Sekme arkaya alındığında yoklama durur: panel açık kalmış bir sekmede
// dakikalarca boşa istek atmasın.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPolling();
    stopLogStream();
  } else if ($("auto").checked) {
    void load();
    startPolling();
    if (page === "logs") startLogStream();
  }
});

/* -------------------------------------------------------------- sayfalar */

/**
 * URL yolunun son segmentinden sayfa adı.
 * @returns {string}
 */
function pageFromLocation() {
  const parts = location.pathname.replace(/\/+$/, "").split("/");
  const last = parts[parts.length - 1] || "";
  if (PAGES.has(last)) return last;
  return "overview";
}

/**
 * @param {string} next
 * @param {{ push?: boolean }} [options]
 */
function showPage(next, options = {}) {
  const name = PAGES.has(next) ? next : "overview";
  page = name;

  for (const node of document.querySelectorAll(".page")) {
    const el = /** @type {HTMLElement} */ (node);
    el.hidden = el.dataset.page !== name;
  }

  for (const link of document.querySelectorAll("#nav a")) {
    const a = /** @type {HTMLAnchorElement} */ (link);
    if (a.dataset.page === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }

  const sse = $("sse-status");
  if (sse) sse.hidden = name !== "logs";

  if (options.push !== false) {
    const target = name === "overview" ? "./" : name;
    history.pushState({ page: name }, "", target);
  }

  if (name === "routes") void loadRoutes();
  if (name === "views") void loadViews();
  if (name === "logs") startLogStream();
  else stopLogStream();
}

async function loadRoutes() {
  const response = await fetch("api/routes");
  if (!alive(response)) return;
  if (!response.ok) return;
  routesPayload = await response.json();
  renderRoutes();
}

async function loadViews() {
  const response = await fetch("api/views");
  if (!alive(response)) return;
  if (!response.ok) return;
  viewsPayload = await response.json();
  renderViews();
}

function renderRoutes() {
  if (!routesPayload) return;

  const routes = routesPayload.routes ?? [];
  const modules = routesPayload.modules ?? [];
  const activity = routesPayload.activity ?? {};

  $("routes-count").textContent = String(routes.length);
  $("modules-count").textContent = String(modules.length);

  const tbody = $("routes-tbody");
  const empty = $("routes-empty");
  tbody.replaceChildren();

  if (!routes.length) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    for (const route of routes) {
      const key = route.path;
      const act = activity[key] ?? null;
      const row = document.createElement("tr");
      row.innerHTML = `
        <td class="mono">${escapeHtml(route.method)}</td>
        <td class="mono"><button type="button" class="linkish" data-path="${escapeHtml(route.path)}">${escapeHtml(route.path)}</button></td>
        <td class="mono">${act ? act.status : "—"}</td>
        <td class="mono">${act ? Math.round(act.ms) : "—"}</td>
        <td class="mono">${act ? act.count : "—"}</td>`;
      tbody.append(row);
    }

    tbody.querySelectorAll("button[data-path]").forEach((button) => {
      button.addEventListener("click", () => {
        const pathFilter = /** @type {HTMLElement} */ (button).dataset.path ?? "";
        $("logs-path").value = pathFilter;
        showPage("logs");
        renderLogs();
      });
    });
  }

  const modulesBody = $("modules-tbody");
  modulesBody.replaceChildren();
  for (const mod of modules) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="mono">${escapeHtml(mod.relative)}</td>`;
    modulesBody.append(row);
  }
}

function renderViews() {
  if (!viewsPayload) return;

  const term = ($("views-search")?.value ?? "").trim().toLowerCase();
  const views = (viewsPayload.views ?? []).filter(
    (/** @type {{ relative: string }} */ view) =>
      !term || view.relative.toLowerCase().includes(term),
  );

  $("views-count").textContent = String(views.length);
  const tbody = $("views-tbody");
  const empty = $("views-empty");
  tbody.replaceChildren();

  if (!views.length) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  for (const view of views) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="mono">${escapeHtml(view.relative)}</td><td>${escapeHtml(view.kind)}</td>`;
    tbody.append(row);
  }
}

function startLogStream() {
  if (logSource) return;

  const chip = $("sse-status");
  if (chip) {
    chip.hidden = false;
    chip.textContent = t("chip.sse.live");
  }

  logSource = new EventSource("api/logs/stream");
  logSource.onmessage = (event) => {
    try {
      const entry = JSON.parse(event.data);
      if (!logsPaused) {
        logBuffer.push(entry);
        if (logBuffer.length > 1000) logBuffer.shift();
        renderLogs();
      }
    } catch {
      // bozuk çerçeve yok sayılır
    }
  };
  logSource.onerror = () => {
    if (chip) chip.textContent = t("chip.sse.error");
  };
}

function stopLogStream() {
  if (logSource) {
    logSource.close();
    logSource = null;
  }
  const chip = $("sse-status");
  if (chip) {
    chip.textContent = t("chip.sse.off");
    chip.hidden = page !== "logs";
  }
}

function renderLogs() {
  const list = $("logs-list");
  const empty = $("logs-empty");
  const count = $("logs-count");
  if (!list || !empty || !count) return;

  const q = ($("logs-q")?.value ?? "").trim().toLowerCase();
  const kind = $("logs-kind")?.value ?? "";
  const method = $("logs-method")?.value ?? "";
  const statusClass = $("logs-status")?.value ?? "";
  const cache = $("logs-cache")?.value ?? "";
  const pathFilter = ($("logs-path")?.value ?? "").trim().toLowerCase();

  const filtered = logBuffer.filter((entry) => {
    if (kind && entry.kind !== kind) return false;
    if (method && entry.method !== method) return false;
    if (statusClass && entry.status != null) {
      if (String(Math.floor(Number(entry.status) / 100)) !== statusClass) return false;
    }
    if (cache && entry.cache !== cache) return false;
    if (pathFilter) {
      const hay = `${entry.path ?? ""} ${entry.route ?? ""} ${entry.url ?? ""}`.toLowerCase();
      if (!hay.includes(pathFilter)) return false;
    }
    if (q) {
      const hay = `${entry.url ?? ""} ${entry.message ?? ""} ${entry.scope ?? ""} ${entry.path ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  count.textContent = t("logs.shown", { shown: filtered.length, total: logBuffer.length });
  empty.hidden = filtered.length > 0;

  const lines = filtered.slice(-300).map(formatLogLine);
  list.textContent = lines.join("\n");
  list.scrollTop = list.scrollHeight;
}

/**
 * @param {any} entry
 * @returns {string}
 */
function formatLogLine(entry) {
  const time = new Date(entry.at).toISOString().slice(11, 19);
  if (entry.kind === "http") {
    const cache = entry.cache ? ` ${entry.cache}` : "";
    const route = entry.route ? ` [${entry.route}]` : "";
    return `${time}  ${String(entry.method).padEnd(6)} ${entry.status}  ${Math.round(entry.ms)}ms${cache}${route}  ${entry.url}`;
  }
  return `${time}  ${entry.kind.padEnd(6)} ${entry.scope ?? ""}  ${entry.message ?? ""}${entry.note ? `  ${entry.note}` : ""}`;
}

for (const link of document.querySelectorAll("#nav a")) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const next = /** @type {HTMLElement} */ (link).dataset.page ?? "overview";
    showPage(next);
  });
}

window.addEventListener("popstate", () => {
  showPage(pageFromLocation(), { push: false });
});

$("views-search")?.addEventListener("input", () => renderViews());

for (const id of ["logs-q", "logs-kind", "logs-method", "logs-status", "logs-cache", "logs-path"]) {
  $(id)?.addEventListener("input", () => renderLogs());
  $(id)?.addEventListener("change", () => renderLogs());
}

$("logs-pause")?.addEventListener("change", (event) => {
  logsPaused = /** @type {HTMLInputElement} */ (event.target).checked;
});

$("logs-clear")?.addEventListener("click", () => {
  logBuffer = [];
  renderLogs();
});

/* -------------------------------------------------------------------- dil */

// Dil değişimi hiçbir isteğe yol açmaz: statik metinler sözlükten yeniden
// yazılır, dinamik olanlar elde duran son dökümle tekrar çizilir.
$("language").append(
  languageSelect(() => {
    applyTranslations();
    if (latest) render();
    renderCloudflare();
    renderReport();
    renderRoutes();
    renderViews();
    renderLogs();
  }),
);

applyTranslations();

const params = new URLSearchParams(location.search);
if (params.get("path")) $("logs-path").value = params.get("path") ?? "";
if (params.get("route")) $("logs-path").value = params.get("route") ?? "";

showPage(pageFromLocation(), { push: false });
void load();
void loadCloudflare();
startPolling();
