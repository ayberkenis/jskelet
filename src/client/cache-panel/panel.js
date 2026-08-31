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
}

/* ------------------------------------------------------------------- çizim */

function render() {
  if (!latest) return;

  const { process: proc, html, data, redis, prewarm } = latest;

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
    ? `${redis.errors} errors · ${redis.keyPrefix || "no prefix"}`
    : "cache.redis.enabled is false";

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
  key.textContent = entry.key;
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

$("redis-html").addEventListener("click", () =>
  void act({ type: "redis:drop", kind: "html" }),
);

$("redis-data").addEventListener("click", () =>
  void act({ type: "redis:drop", kind: "data" }),
);

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
startPolling();
