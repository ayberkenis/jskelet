/**
 * Önbellek panelinin istemci tarafı.
 *
 * Build hattından geçmez, doğrudan diskten servis edilir: panelin açık olduğu
 * bir kurulumda `jskelet build` hiç koşmamış olabilir ve panel yine çalışmalı.
 * Bu yüzden burada import edilen bir framework modülü yok.
 *
 * Yenileme WebSocket değil, kısa aralıklı `fetch` ile: panel nadiren ve kısa
 * süre açık kalıyor, kalıcı bir kanal açmanın karşılığı yok.
 */

const REFRESH_MS = 3000;

const $ = (/** @type {string} */ id) => document.getElementById(id);

/** @type {"html" | "data"} */
let tab = "html";
let query = "";
/** @type {any} */
let latest = null;
/** @type {number | null} */
let timer = null;
let busy = false;

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
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  if (total < 86_400) return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
  return `${Math.floor(total / 86_400)}d ${Math.floor((total % 86_400) / 3600)}h`;
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
      "X-JSkelet-Cache-Panel": "1",
    },
    body: JSON.stringify(body),
  });

  if (!alive(response)) return;

  const result = await response.json().catch(() => ({ ok: false, message: "Failed" }));
  toast(result.message ?? (result.ok ? "Done" : "Failed"), result.ok !== false);
  await load();

  // Cloudflare ayarları değişmiş olabilir; genel bakış önbelleği atlanır.
  if (String(body.type ?? "").startsWith("cf:")) await loadCloudflare(true);
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
  $("uptime").textContent = `up ${formatDuration(proc.uptime)}`;
  $("memory").textContent = `rss ${formatBytes(proc.memory.rss)}`;

  $("html-size").textContent = html.size.toLocaleString();
  $("html-sub").textContent = `limit ${html.maxEntries.toLocaleString()}`;
  $("html-bytes").textContent = formatBytes(html.bytes);
  $("html-stale").textContent = `${html.stale} stale`;

  $("data-size").textContent = data.size.toLocaleString();
  $("data-sub").textContent = `${data.stale} stale · limit ${data.maxEntries.toLocaleString()}`;

  const redisState = !redis.enabled
    ? "off"
    : redis.bypassed
      ? "bypassed"
      : redis.connected
        ? "connected"
        : "disconnected";

  $("redis-state").textContent = redisState;
  $("redis-sub").textContent = redis.enabled
    ? `${redis.address} · ${redis.errors} errors`
    : "cache.redis.enabled is false";

  renderRedis(redis, redisState);
  renderHost(host, proc, redis);

  const done = prewarm.done ?? 0;
  const total = prewarm.total ?? 0;
  $("prewarm-state").textContent = prewarm.active ? `${done}/${total}` : "idle";
  $("prewarm-sub").textContent = prewarm.active
    ? "round in progress"
    : total
      ? `last round: ${done}/${total}`
      : "no round yet";

  renderTable();
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
    ? [zone?.name, zone?.plan].filter(Boolean).join(" · ") || "connected"
    : status.configured
      ? `error: ${cloudflare.error}`
      : "not connected";

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
    ["Zone", `${zone?.name ?? "—"} (${status.zoneId ?? "?"})`],
    ["Plan", zone?.plan ?? "—"],
    ["Token", status.tokenSource === "env" ? "from environment" : "from config", "on"],
    [
      "Development mode",
      development
        ? `on · ${formatDuration(settings.developmentModeRemaining)} left`
        : "off",
      development ? "bad" : "on",
    ],
    ["Cache level", String(settings.cacheLevel ?? "—")],
    ["Browser cache TTL", ttl(settings.browserCacheTtl)],
    ["Edge cache TTL", ttl(settings.edgeCacheTtl)],
    ["Query string sorting", String(settings.sortQueryString ?? "—")],
    ["Always Online", String(settings.alwaysOnline ?? "—")],
    ...feature("Tiered Cache", settings.tieredCaching),
    ...feature("Regional Tiered Cache", settings.regionalTieredCache),
    ...feature("Cache Reserve", settings.cacheReserve),
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
    return [[label, "unavailable on this plan", "off"]];
  }
  return [[label, value, value === "on" ? "on" : "off"]];
}

/**
 * @param {unknown} seconds
 * @returns {string}
 */
function ttl(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return "—";
  // Cloudflare 0'ı "Respect Existing Headers" olarak kullanıyor.
  if (value === 0) return "respect origin headers";
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
  target.textContent = "Querying Cloudflare…";

  const response = await fetch("cloudflare/analytics", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-JSkelet-Cache-Panel": "1",
    },
    body: JSON.stringify({ path }),
  });

  if (!alive(response)) return;

  const result = await response.json().catch(() => null);

  if (!result?.ok) {
    target.textContent = `Cloudflare: ${result?.error ?? "query failed"}`;
    return;
  }

  target.replaceChildren(
    result.colos ? edgeTable(result) : statusTable(result),
    note(
      result.colos
        ? `${result.colos.length} colos served \`${result.path}\` in the last ` +
            `${result.hours}h — ${result.hits} from cache, ${result.misses} not. ` +
            "Edges that received no request do not appear, even if they hold a copy."
        : `Zone-wide cache status over the last ${result.hours}h. ` +
            "Numbers come from Cloudflare's sampled dataset: ratios are reliable, " +
            "absolute counts are estimates.",
    ),
  );
}

/**
 * @param {any} result
 * @returns {HTMLTableElement}
 */
function edgeTable(result) {
  return buildTable(
    ["Colo", "From cache", "To origin"],
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
    ["Cache status", "Requests", "Share", "Edge bytes"],
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
  $("redis-heading").textContent = redis.enabled ? state : "not configured";
  $("redis-actions").hidden = !redis.enabled;
  $("redis-suggest").hidden = redis.enabled;

  /** @type {[string, string, string?][]} */
  const rows = redis.enabled
    ? [
        ["Connection", state, redis.connected && !redis.bypassed ? "on" : "bad"],
        ["Address", `${redis.address}${redis.secure ? " (TLS)" : ""}`],
        ["Database", redis.db ?? "default"],
        ["Key prefix", `${redis.keyPrefix}:${redis.namespace}`],
        ["Build id", redis.buildId || "dev"],
        ["Shares HTML", redis.html ? "yes" : "no", redis.html ? "on" : "off"],
        ["Shares data", redis.data ? "yes" : "no", redis.data ? "on" : "off"],
        [
          "Compressed bodies",
          redis.storeEncoded ? "shared" : "local only",
          redis.storeEncoded ? "on" : "off",
        ],
        [
          "Purge broadcast",
          redis.events ? (redis.subscribed ? "subscribed" : "publish only") : "off",
          redis.events && redis.subscribed ? "on" : "off",
        ],
        ["Command timeout", `${redis.commandTimeoutMs} ms`],
        ["Command errors", String(redis.errors), redis.errors ? "bad" : "on"],
      ]
    : [
        ["Tier", "in-process only"],
        ["Replicas sharing this cache", "none"],
        ["Purge broadcast", "local only", "off"],
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
    ? `This process: ${formatBytes(proc.memory.rss)} RSS.`
    : `This process holds the whole cache: ${formatBytes(proc.memory.rss)} RSS, ` +
      `${formatBytes(latest.html.bytes)} of it HTML.`;

  if (!host.disk) {
    $("disk-text").textContent = "unavailable";
    meter("disk-bar", 0);
    $("disk-note").textContent = "This platform does not report filesystem stats.";
    return;
  }

  const diskUsed = (host.disk.total - host.disk.free) / host.disk.total;
  $("disk-text").textContent =
    `${formatBytes(host.disk.total - host.disk.free)} / ${formatBytes(host.disk.total)}`;
  meter("disk-bar", diskUsed);
  // Önbellek diske yazılmıyor; disk build çıktısı ve log için önemli.
  $("disk-note").textContent =
    `${formatBytes(host.disk.free)} free on ${host.disk.path} — build output and logs live here.`;
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
      ? `${source.entries.length} of ${source.matched} shown`
      : `${source.matched} shown`;

  thead.innerHTML =
    tab === "html"
      ? `<tr><th>Key</th><th>State</th><th class="num">Size</th><th class="num">Status</th><th class="num">Expires</th><th class="num">Deps</th><th>Encodings</th><th></th></tr>`
      : `<tr><th>Key</th><th>State</th><th class="num">Expires</th><th></th></tr>`;

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
    copy.title = "Copy key";
    copy.textContent = entry.key;
    copy.addEventListener("click", () => void copyKey(entry.key));
    key.append(copy);
  }

  tr.append(key);

  const state = document.createElement("td");
  const tag = document.createElement("span");
  tag.className = entry.stale ? "tag stale" : "tag fresh";
  tag.textContent = entry.stale ? "stale" : "fresh";
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
    purge.textContent = "cf purge";
    purge.title = "Purge this URL at Cloudflare";
    purge.addEventListener("click", () => {
      void act({ type: "cf:purge-urls", paths: [entry.url] });
    });
    actions.append(purge);
  }

  const drop = document.createElement("button");
  drop.className = "tiny danger";
  drop.textContent = "drop";
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
    toast("Key copied");
  } catch {
    $("prefix").value = key;
    $("prefix").focus();
    toast("Clipboard is unavailable — key moved to the prefix field", false);
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
    toast("Enter a path or pattern first.", false);
    return;
  }

  void act({ type: "html:invalidate", target, hard: $("hard").checked });
});

$("clear-html").addEventListener("click", () => {
  if (!confirm("Clear the entire HTML cache? Every page goes cold.")) return;
  void act({ type: "html:clear" });
});

$("clear-data").addEventListener("click", () => {
  const prefix = $("prefix").value.trim();
  if (!prefix && !confirm("Clear every data entry? Upstream traffic will spike.")) {
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
  if (!confirm("Purge the entire Cloudflare cache for this zone?")) return;
  void act({ type: "cf:purge-everything" });
});

// Bu kurulumda sıcak olan yollar zaten biliniyor; "her şeyi düşür" yerine
// yalnızca gerçekten servis edilen sayfaları düşürmek edge'i boşa soğutmaz.
$("cf-purge-cached").addEventListener("click", () => {
  const paths = (latest?.html.entries ?? []).map((/** @type {any} */ entry) => entry.url);
  if (!paths.length) {
    toast("No cached pages to purge.", false);
    return;
  }

  if (!confirm(`Purge ${paths.length} URLs at Cloudflare?`)) return;
  void act({ type: "cf:purge-urls", paths });
});

$("cf-purge-keys").addEventListener("click", () => {
  const values = $("cf-values").value.trim();
  if (!values) {
    toast("Enter at least one value.", false);
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
  if (!confirm("Clear Cache Reserve? Cloudflare will refetch everything from the origin.")) {
    return;
  }
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
  if (document.hidden) stopPolling();
  else if ($("auto").checked) {
    void load();
    startPolling();
  }
});

void load();
void loadCloudflare();
startPolling();
