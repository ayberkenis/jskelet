/**
 * "Inspect in detail" sayfasının arayüzü.
 *
 * Overlay ile aynı mantık: build'e girmez, dev sunucusu bu dosyayı ham olarak
 * servis eder. Tüm veri tek bir uçtan gelir (`/__jskelet/dev/report/data`),
 * sayfa yalnızca onu görselleştirir.
 */

const BASE = "/__jskelet/dev";

/** @type {any} */
let data = null;
let activeTab = "overview";
let auto = false;
/** @type {number | null} */
let timer = null;

/** Tablo sıralamaları: tabloId → { key, dir }. */
const sorting = new Map();

/** Arama kutuları: tabloId → metin. */
const filters = new Map();

/** Chunk analizinde seçili çıktı. */
let selectedChunk = null;

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "pages", label: "Pages" },
  { id: "chunks", label: "Chunk analysis" },
  { id: "assets", label: "Assets" },
  { id: "ssr", label: "SSR & CSR" },
  { id: "api", label: "API requests" },
  { id: "errors", label: "Errors" },
];

/* ------------------------------------------------------------- yardımcılar */

/** @param {number | null | undefined} bytes */
function size(bytes) {
  if (bytes == null) return "—";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** @param {number | null | undefined} value */
function ms(value) {
  return value == null ? "—" : `${Math.round(value)} ms`;
}

/**
 * @param {number | null | undefined} value
 * @param {[number, number]} bounds iyi/orta sınırı
 */
function tone(value, [good, mid]) {
  if (value == null) return "";
  if (value <= good) return "good";
  if (value <= mid) return "mid";
  return "bad";
}

/** @param {string} value */
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
  );
}

/** @param {string} url */
function link(url) {
  const text = escapeHtml(url);
  if (!url?.startsWith("/")) return text;
  return `<a href="${text}" target="_blank" rel="noreferrer">${text}</a>`;
}

/**
 * @param {{ label: string, value: string, sub?: string, tone?: string, ratio?: number | null }[]} items
 */
function metrics(items) {
  return `<div class="grid">${items
    .map((item) => {
      const width = Math.round(Math.min(1, Math.max(0.03, item.ratio ?? 0)) * 100);
      return `<div class="metric">
        <div class="label">${escapeHtml(item.label)}</div>
        <div class="value ${item.tone ?? ""}">${escapeHtml(item.value)}</div>
        ${item.sub ? `<div class="sub">${item.sub}</div>` : ""}
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
 * Sıralanabilir, aranabilir tablo.
 *
 * @param {string} id
 * @param {{ key: string, label: string, value?: (row: any) => any, render?: (row: any) => string }[]} columns
 * @param {any[]} rows
 * @param {{ search?: boolean, rowAttrs?: (row: any) => string }} [options]
 */
function table(id, columns, rows, options = {}) {
  const sort = sorting.get(id) ?? { key: columns[0].key, dir: "desc" };
  const query = (filters.get(id) ?? "").trim().toLowerCase();

  const valueOf = (row, column) =>
    column.value ? column.value(row) : row[column.key];

  let visible = rows;
  if (query) {
    visible = rows.filter((row) =>
      columns.some((column) =>
        String(valueOf(row, column) ?? "")
          .toLowerCase()
          .includes(query),
      ),
    );
  }

  const column = columns.find((item) => item.key === sort.key) ?? columns[0];
  visible = [...visible].sort((a, b) => {
    const left = valueOf(a, column);
    const right = valueOf(b, column);
    const compare =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left ?? "").localeCompare(String(right ?? ""));
    return sort.dir === "asc" ? compare : -compare;
  });

  const search = options.search
    ? `<div class="toolbar">
         <input type="search" data-filter="${id}" value="${escapeHtml(filters.get(id) ?? "")}"
           placeholder="Filter — ${visible.length}/${rows.length} rows" />
       </div>`
    : "";

  if (!rows.length) {
    return `${search}<div class="empty">No records.</div>`;
  }

  return `${search}
    <div class="table-wrap">
      <table data-table="${id}">
        <thead><tr>${columns
          .map(
            (item) =>
              `<th data-sort="${item.key}" ${
                item.key === sort.key ? `data-dir="${sort.dir}"` : ""
              }>${escapeHtml(item.label)}</th>`,
          )
          .join("")}</tr></thead>
        <tbody>${visible
          .map(
            (row) =>
              `<tr ${options.rowAttrs?.(row) ?? ""}>${columns
                .map(
                  (item) =>
                    `<td class="${item.key === columns[0].key ? "path" : ""}">${
                      item.render ? item.render(row) : escapeHtml(valueOf(row, item) ?? "—")
                    }</td>`,
                )
                .join("")}</tr>`,
          )
          .join("")}</tbody>
      </table>
    </div>`;
}

/* ------------------------------------------------------------- sekmeler */

function overview() {
  const pages = data.pages ?? [];
  const measured = pages.filter((page) => page.metrics?.lcp != null);
  const lcps = measured.map((page) => page.metrics.lcp);
  const worst = [...measured].sort((a, b) => b.metrics.lcp - a.metrics.lcp).slice(0, 8);

  const average = lcps.length ? lcps.reduce((sum, value) => sum + value, 0) / lcps.length : null;
  const js = (data.build?.outputs ?? []).filter((item) => item.file.endsWith(".js"));
  const jsBytes = js.reduce((sum, item) => sum + item.bytes, 0);
  const css = (data.build?.assets ?? []).filter((item) => item.kind === "css");
  const cssBytes = css.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  const ssrBytes = pages.reduce((sum, page) => sum + (page.html?.bytes ?? 0), 0);
  const apiErrors = (data.serverApi ?? []).filter((call) => call.error).length;
  const islandTotal = pages.reduce((sum, page) => sum + (page.islands?.total ?? 0), 0);
  const islandReady = pages.reduce((sum, page) => sum + (page.islands?.ready ?? 0), 0);

  return `
    <h2>Site wide<span class="note">${pages.length} pages known, ${measured.length} of them measured in the browser</span></h2>
    ${metrics([
      {
        label: "Average LCP",
        value: ms(average),
        tone: tone(average, [2500, 4000]),
        ratio: average == null ? null : average / 4000,
        sub: `worst ${ms(worst[0]?.metrics?.lcp)}`,
      },
      {
        label: "Measured pages",
        value: `${measured.length}/${pages.length}`,
        ratio: pages.length ? measured.length / pages.length : null,
        tone: "good",
        sub: "browse to measure",
      },
      { label: "JS output", value: size(jsBytes), sub: `${js.length} files` },
      { label: "CSS output", value: size(cssBytes), sub: `${css.length} files` },
      { label: "SSR HTML", value: size(ssrBytes), sub: "total of known pages" },
      {
        label: "Island (CSR)",
        value: `${islandReady}/${islandTotal}`,
        ratio: islandTotal ? islandReady / islandTotal : null,
        tone: "good",
        sub: "mounted / marked",
      },
      {
        label: "HTML cache",
        value: String(data.cache?.size ?? 0),
        sub: `${size((data.cache?.entries ?? []).reduce((sum, item) => sum + item.bytes, 0))} in memory`,
      },
      {
        label: "Server API calls",
        value: String((data.serverApi ?? []).length),
        tone: apiErrors ? "bad" : "good",
        sub: apiErrors ? `${apiErrors} errors` : "no errors",
      },
      // Upstream kotasının nasıl harcandığı: okumaların kaçı önbellekten
      // döndü. Oran düşükse `withDataCache` TTL'i kısa demektir.
      {
        label: "Data cache",
        value: data.cache?.dataStats?.reads
          ? `${Math.round(data.cache.dataStats.hitRatio * 100)}%`
          : "—",
        ratio: data.cache?.dataStats?.hitRatio ?? null,
        tone: "good",
        sub: data.cache?.dataStats?.reads
          ? `${data.cache.dataStats.produced} upstream / ${data.cache.dataStats.reads} reads`
          : "no reads yet",
      },
      {
        label: "Prewarm",
        value: data.prewarm?.total
          ? `${data.prewarm.ok}/${data.prewarm.total}`
          : "—",
        ratio: data.prewarm?.total ? data.prewarm.done / data.prewarm.total : null,
        tone: data.prewarm?.failed ? "mid" : "good",
      },
      {
        label: "Process",
        value: size(data.process?.memory?.rss),
        sub: `${data.process?.node} · ${Math.round(data.process?.uptime ?? 0)} s`,
      },
    ])}

    <h2>Slowest pages<span class="note">by LCP</span></h2>
    ${
      worst.length
        ? table(
            "worst",
            [
              { key: "url", label: "Page", render: (row) => link(row.url) },
              { key: "lcp", label: "LCP", value: (row) => row.metrics.lcp, render: (row) => `<span class="${tone(row.metrics.lcp, [2500, 4000])}">${ms(row.metrics.lcp)}</span>` },
              { key: "cls", label: "CLS", value: (row) => row.metrics.cls ?? 0, render: (row) => (row.metrics.cls ?? 0).toFixed(3) },
              { key: "inp", label: "INP", value: (row) => row.metrics.inp ?? 0, render: (row) => ms(row.metrics.inp) },
              { key: "transfer", label: "Transfer", value: (row) => row.resources?.bytes ?? 0, render: (row) => size(row.resources?.bytes) },
              { key: "html", label: "SSR HTML", value: (row) => row.html?.bytes ?? 0, render: (row) => size(row.html?.bytes) },
            ],
            worst,
          )
        : `<div class="empty">No browser measurements yet. Pages land here as you browse the site.</div>`
    }

    <h2>Web Vitals distribution</h2>
    <div class="card">
      ${["lcp", "fcp", "ttfb", "inp"]
        .map((key) => {
          const values = measured
            .map((page) => page.metrics[key])
            .filter((value) => value != null)
            .sort((a, b) => a - b);
          if (!values.length) return "";
          const p = (ratio) => values[Math.min(values.length - 1, Math.floor(values.length * ratio))];
          const bounds = { lcp: [2500, 4000], fcp: [1800, 3000], ttfb: [800, 1800], inp: [200, 500] }[key];
          return `<div class="barrow">
            <span class="name">${key.toUpperCase()} — median ${ms(p(0.5))}, p75 ${ms(p(0.75))}, p95 ${ms(p(0.95))}</span>
            <span class="size ${tone(p(0.75), bounds)}">${ms(p(0.75))}</span>
            <span class="track"><span class="${tone(p(0.75), bounds)}" style="width:${Math.min(100, (p(0.75) / (bounds[1] * 1.5)) * 100)}%"></span></span>
          </div>`;
        })
        .join("")}
    </div>
  `;
}

function pagesTab() {
  const rows = data.pages ?? [];

  return `
    <h2>Pages<span class="note">browser measurements build up as you browse; SSR columns come from the prewarm round</span></h2>
    ${table(
      "pages",
      [
        { key: "url", label: "Page", render: (row) => link(row.url) },
        { key: "visits", label: "Visits", value: (row) => row.visits },
        { key: "lcp", label: "LCP", value: (row) => row.metrics?.lcp ?? -1, render: (row) => `<span class="${tone(row.metrics?.lcp, [2500, 4000])}">${ms(row.metrics?.lcp)}</span>` },
        { key: "cls", label: "CLS", value: (row) => row.metrics?.cls ?? -1, render: (row) => (row.metrics?.cls == null ? "—" : `<span class="${tone(row.metrics.cls * 1000, [100, 250])}">${row.metrics.cls.toFixed(3)}</span>`) },
        { key: "inp", label: "INP", value: (row) => row.metrics?.inp ?? -1, render: (row) => `<span class="${tone(row.metrics?.inp, [200, 500])}">${ms(row.metrics?.inp)}</span>` },
        { key: "fcp", label: "FCP", value: (row) => row.metrics?.fcp ?? -1, render: (row) => ms(row.metrics?.fcp) },
        { key: "ttfb", label: "TTFB", value: (row) => row.metrics?.ttfb ?? -1, render: (row) => `<span class="${tone(row.metrics?.ttfb, [800, 1800])}">${ms(row.metrics?.ttfb)}</span>` },
        { key: "blocking", label: "Blocking", value: (row) => row.metrics?.blocking ?? -1, render: (row) => ms(row.metrics?.blocking) },
        { key: "requests", label: "Requests", value: (row) => row.resources?.count ?? 0 },
        { key: "transfer", label: "Transfer", value: (row) => row.resources?.bytes ?? 0, render: (row) => size(row.resources?.bytes) },
        { key: "islands", label: "Island", value: (row) => row.islands?.total ?? 0, render: (row) => (row.islands?.total ? `${row.islands.ready}/${row.islands.total}` : "—") },
        { key: "api", label: "API", value: (row) => row.api?.length ?? 0 },
        { key: "html", label: "SSR HTML", value: (row) => row.html?.bytes ?? 0, render: (row) => size(row.html?.bytes) },
        { key: "render", label: "Render", value: (row) => row.html?.ms ?? -1, render: (row) => ms(row.html?.ms) },
        { key: "cache", label: "Cache", render: (row) => (row.html?.cache ? `<span class="tag">${escapeHtml(row.html.cache)}</span>` : "—") },
      ],
      rows,
      { search: true },
    )}
  `;
}

function chunksTab() {
  const build = data.build ?? {};
  if (!build.available) {
    return `<div class="empty">Chunk analysis needs <code>build/generated/metafile.json</code>. It appears once <code>npm run dev</code> or <code>npm run build</code> has completed a round.</div>`;
  }

  const outputs = build.outputs ?? [];
  const selected =
    outputs.find((item) => item.file === selectedChunk) ?? outputs[0];
  const heaviest = outputs[0]?.bytes ?? 1;
  const totalBytes = outputs.reduce((sum, item) => sum + item.bytes, 0);
  const groupTotal = (build.groups ?? []).reduce((sum, item) => sum + item.bytes, 0) || 1;

  return `
    <h2>Outputs<span class="note">${outputs.length} files · ${size(totalBytes)} raw</span></h2>
    <div class="split">
      <div>
        ${table(
          "chunks",
          [
            {
              key: "file",
              label: "File",
              render: (row) =>
                `${link(row.file)} <span class="tag ${row.isChunk ? "chunk" : "entry"}">${row.isChunk ? "chunk" : "entry"}</span>`,
            },
            { key: "bytes", label: "Raw", value: (row) => row.bytes, render: (row) => size(row.bytes) },
            { key: "gzip", label: "Gzip", value: (row) => row.gzip ?? 0, render: (row) => size(row.gzip) },
            { key: "brotli", label: "Brotli", value: (row) => row.brotli ?? 0, render: (row) => size(row.brotli) },
            { key: "inputCount", label: "Modules", value: (row) => row.inputCount },
            { key: "imports", label: "Imports", value: (row) => row.imports.length },
            {
              key: "share",
              label: "Share",
              value: (row) => row.bytes / heaviest,
              render: (row) => `${Math.round((row.bytes / totalBytes) * 100)}%`,
            },
          ],
          outputs,
          {
            search: true,
            rowAttrs: (row) =>
              `class="clickable ${row.file === selected?.file ? "selected" : ""}" data-chunk="${escapeHtml(row.file)}"`,
          },
        )}
      </div>
      <div>
        <div class="card">
          <h2 style="margin-top:0">Selected output</h2>
          ${
            selected
              ? `<div class="hint" style="margin-bottom:10px">
                   <code>${escapeHtml(selected.file)}</code><br />
                   ${size(selected.bytes)} raw · ${size(selected.gzip)} gzip · ${selected.inputCount} modules
                   ${selected.entry ? `<br />entry: <code>${escapeHtml(selected.entry)}</code>` : ""}
                 </div>
                 <div class="bars">
                   ${selected.inputs
                     .map(
                       (input) => `<div class="barrow">
                         <span class="name" title="${escapeHtml(input.source)}">${escapeHtml(input.source)}</span>
                         <span class="size">${size(input.bytes)}</span>
                         <span class="track"><span style="width:${Math.round((input.bytes / selected.inputs[0].bytes) * 100)}%"></span></span>
                       </div>`,
                     )
                     .join("")}
                 </div>
                 ${
                   selected.imports.length
                     ? `<h2>Chunks it imports</h2>
                        <div class="hint">${selected.imports
                          .map((item) => `<div><code>${escapeHtml(item.path)}</code> <span class="tag">${escapeHtml(item.kind)}</span></div>`)
                          .join("")}</div>`
                     : ""
                 }`
              : `<div class="hint">Pick an output on the left.</div>`
          }
        </div>
      </div>
    </div>

    <h2>Source groups<span class="note">package / folder share across all outputs</span></h2>
    <div class="card bars">
      ${(build.groups ?? [])
        .slice(0, 25)
        .map(
          (group) => `<div class="barrow">
            <span class="name">${escapeHtml(group.name)}</span>
            <span class="size">${size(group.bytes)}</span>
            <span class="track"><span style="width:${Math.round((group.bytes / groupTotal) * 100)}%"></span></span>
          </div>`,
        )
        .join("")}
    </div>
  `;
}

function assetsTab() {
  const assets = data.build?.assets ?? [];
  const total = assets.reduce((sum, item) => sum + (item.bytes ?? 0), 0);

  return `
    <h2>Manifest assets<span class="note">${assets.length} entries · ${size(total)}</span></h2>
    ${table(
      "assets",
      [
        { key: "name", label: "Name" },
        { key: "url", label: "Path", render: (row) => link(row.url) },
        { key: "kind", label: "Kind", render: (row) => `<span class="tag">${escapeHtml(row.kind)}</span>` },
        { key: "bytes", label: "Raw", value: (row) => row.bytes ?? 0, render: (row) => size(row.bytes) },
        { key: "gzip", label: "Gzip", value: (row) => row.gzip ?? 0, render: (row) => size(row.gzip) },
        { key: "brotli", label: "Brotli", value: (row) => row.brotli ?? 0, render: (row) => size(row.brotli) },
        {
          key: "ratio",
          label: "Savings",
          value: (row) => (row.bytes && row.gzip ? 1 - row.gzip / row.bytes : 0),
          render: (row) =>
            row.bytes && row.gzip
              ? `${Math.round((1 - row.gzip / row.bytes) * 100)}%`
              : "—",
        },
      ],
      assets,
      { search: true },
    )}
  `;
}

function ssrTab() {
  const pages = data.pages ?? [];
  const cache = data.cache?.entries ?? [];

  /** @type {Map<string, { name: string, pages: number }>} */
  const islands = new Map();
  for (const page of pages) {
    for (const name of page.islands?.names ?? []) {
      const entry = islands.get(name) ?? { name, pages: 0 };
      entry.pages += 1;
      islands.set(name, entry);
    }
  }

  const csr = pages.filter((page) => (page.islands?.total ?? 0) > 0);
  const partial = csr.filter((page) => page.islands.ready < page.islands.total);

  return `
    <h2>Server render & client hydration</h2>
    ${metrics([
      { label: "SSR pages", value: String(pages.filter((page) => page.html?.bytes).length), sub: "HTML size known" },
      { label: "Pages with islands", value: `${csr.length}/${pages.length}`, ratio: pages.length ? csr.length / pages.length : null, tone: "good" },
      { label: "Partial hydration", value: String(partial.length), tone: partial.length ? "mid" : "good", sub: "some islands did not mount" },
      { label: "Distinct islands", value: String(islands.size) },
      { label: "Cache entries", value: String(data.cache?.size ?? 0) },
      { label: "Cache size", value: size(cache.reduce((sum, item) => sum + item.bytes, 0)) },
    ])}

    <h2>Island inventory<span class="note">islands seen on the pages you browsed</span></h2>
    ${table(
      "islands",
      [
        { key: "name", label: "Island" },
        { key: "pages", label: "Page count", value: (row) => row.pages },
      ],
      [...islands.values()],
      { search: true },
    )}

    <h2>HTML cache<span class="note">entries in memory, with time to stale</span></h2>
    ${table(
      "cache",
      [
        { key: "key", label: "Key" },
        { key: "status", label: "Status", render: (row) => `<span class="status ${row.status >= 400 ? "bad" : ""}">${row.status}</span>` },
        { key: "bytes", label: "HTML", value: (row) => row.bytes, render: (row) => size(row.bytes) },
        { key: "expiresIn", label: "Freshness", value: (row) => row.expiresIn, render: (row) => (row.stale ? `<span class="mid">stale</span>` : `${row.expiresIn} s`) },
        { key: "encodings", label: "Compression", render: (row) => (row.encodings.length ? row.encodings.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join(" ") : "—") },
      ],
      cache,
      { search: true },
    )}
  `;
}

function apiTab() {
  const server = data.serverApi ?? [];

  /** @type {Map<string, { key: string, host: string, calls: number, ms: number, errors: number, bytes: number }>} */
  const grouped = new Map();
  for (const call of server) {
    let route = call.url;
    try {
      route = new URL(call.url).pathname;
    } catch {
      // Göreli adres.
    }
    const key = `${call.host}${route}`;
    const entry = grouped.get(key) ?? { key: route, host: call.host, calls: 0, ms: 0, errors: 0, bytes: 0 };
    entry.calls += 1;
    entry.ms += call.ms;
    entry.errors += call.error ? 1 : 0;
    entry.bytes += call.bytes;
    grouped.set(key, entry);
  }

  const client = (data.pages ?? []).flatMap((page) =>
    (page.api ?? []).map((call) => ({ ...call, page: page.url })),
  );

  return `
    <h2>Server side calls<span class="note">outbound requests made during SSR, grouped by path</span></h2>
    ${table(
      "api-groups",
      [
        { key: "key", label: "Path" },
        { key: "host", label: "Host" },
        { key: "calls", label: "Calls", value: (row) => row.calls },
        { key: "avg", label: "Avg. time", value: (row) => row.ms / row.calls, render: (row) => `<span class="${tone(row.ms / row.calls, [200, 800])}">${ms(row.ms / row.calls)}</span>` },
        { key: "total", label: "Total time", value: (row) => row.ms, render: (row) => ms(row.ms) },
        { key: "bytes", label: "Body", value: (row) => row.bytes, render: (row) => size(row.bytes) },
        { key: "errors", label: "Errors", value: (row) => row.errors, render: (row) => (row.errors ? `<span class="bad">${row.errors}</span>` : "0") },
      ],
      [...grouped.values()],
      { search: true },
    )}

    <h2>Recent calls</h2>
    ${table(
      "api-calls",
      [
        { key: "url", label: "URL" },
        { key: "page", label: "Page", render: (row) => (row.page ? link(row.page) : "—") },
        { key: "method", label: "Method" },
        { key: "status", label: "Status", render: (row) => `<span class="status ${row.error ? "bad" : ""}">${row.status || "—"}</span>` },
        { key: "ms", label: "Time", value: (row) => row.ms, render: (row) => `<span class="${tone(row.ms, [200, 800])}">${ms(row.ms)}</span>` },
        { key: "bytes", label: "Body", value: (row) => row.bytes, render: (row) => size(row.bytes) },
        { key: "error", label: "Error", render: (row) => (row.error ? `<span class="bad">${escapeHtml(row.error)}</span>` : "—") },
      ],
      server.slice(0, 200),
      { search: true },
    )}

    <h2>Browser side calls<span class="note">fetch requests made by islands</span></h2>
    ${table(
      "api-client",
      [
        { key: "url", label: "URL" },
        { key: "page", label: "Page", render: (row) => link(row.page) },
        { key: "status", label: "Status", render: (row) => `<span class="status ${row.status >= 400 || !row.status ? "bad" : ""}">${row.status || "—"}</span>` },
        { key: "ms", label: "Time", value: (row) => row.ms, render: (row) => `<span class="${tone(row.ms, [200, 800])}">${ms(row.ms)}</span>` },
        { key: "bytes", label: "Body", value: (row) => row.bytes, render: (row) => size(row.bytes) },
      ],
      client,
      { search: true },
    )}
  `;
}

function errorsTab() {
  return `
    <h2>Errors<span class="note">server log</span></h2>
    ${table(
      "errors",
      [
        { key: "message", label: "Message" },
        { key: "page", label: "Page", render: (row) => (row.page ? link(row.page) : "—") },
        {
          key: "details",
          label: "Details",
          render: (row) => {
            if (row.details == null) return "—";
            const text =
              typeof row.details === "string"
                ? row.details
                : (() => {
                    try {
                      return JSON.stringify(row.details);
                    } catch {
                      return String(row.details);
                    }
                  })();
            return `<span class="hint" title="${escapeHtml(text)}">${escapeHtml(text.slice(0, 120))}${text.length > 120 ? "…" : ""}</span>`;
          },
        },
        { key: "level", label: "Level", render: (row) => `<span class="tag">${escapeHtml(row.level)}</span>` },
        { key: "at", label: "Time", value: (row) => row.at, render: (row) => new Date(row.at).toLocaleTimeString() },
      ],
      data.errors ?? [],
      { search: true },
    )}

    <h2>Recent requests</h2>
    ${table(
      "requests",
      [
        { key: "url", label: "URL", render: (row) => link(row.url) },
        { key: "status", label: "Status", render: (row) => `<span class="status ${row.status >= 500 ? "bad" : row.status >= 400 ? "warn" : ""}">${row.status}</span>` },
        { key: "ms", label: "Time", value: (row) => row.ms, render: (row) => `<span class="${tone(row.ms, [150, 500])}">${ms(row.ms)}</span>` },
        { key: "cache", label: "Cache", render: (row) => (row.cache ? `<span class="tag">${escapeHtml(row.cache)}</span>` : "—") },
        { key: "at", label: "Time", value: (row) => row.at, render: (row) => new Date(row.at).toLocaleTimeString() },
      ],
      data.requests ?? [],
      { search: true },
    )}
  `;
}

const RENDERERS = {
  overview,
  pages: pagesTab,
  chunks: chunksTab,
  assets: assetsTab,
  ssr: ssrTab,
  api: apiTab,
  errors: errorsTab,
};

/* ------------------------------------------------------------------ çizim */

function render() {
  const nav = document.querySelector("[data-part='tabs']");
  nav.innerHTML = TABS.map(
    (tab) =>
      `<button data-tab="${tab.id}" aria-selected="${tab.id === activeTab}">${tab.label}</button>`,
  ).join("");

  const main = document.querySelector("[data-part='main']");
  main.innerHTML = data
    ? RENDERERS[activeTab]()
    : `<div class="empty">Loading data…</div>`;

  const status = document.querySelector("[data-part='status']");
  if (data) {
    const time = new Date(data.generatedAt).toLocaleTimeString();
    status.textContent = `${data.pages.length} pages · ${time}`;
  }

  document.querySelector("[data-action='auto']").setAttribute("aria-pressed", String(auto));
}

async function load() {
  try {
    const response = await fetch(`${BASE}/report/data`, { cache: "no-store" });
    data = await response.json();
  } catch {
    document.querySelector("[data-part='status']").textContent = "server unreachable";
    return;
  }
  render();
}

/* ------------------------------------------------------------ etkileşim */

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-tab], [data-sort], [data-chunk], [data-action]");
  if (!target) return;

  if (target.dataset.action === "refresh") {
    load();
    return;
  }

  if (target.dataset.action === "auto") {
    auto = !auto;
    clearInterval(timer);
    if (auto) timer = setInterval(load, 5000);
    render();
    return;
  }

  if (target.dataset.action === "reset") {
    fetch(`${BASE}/report/clear`, { method: "POST" }).finally(load);
    return;
  }

  if (target.dataset.tab) {
    activeTab = target.dataset.tab;
    location.hash = activeTab;
    render();
    return;
  }

  if (target.dataset.sort) {
    const id = target.closest("table").dataset.table;
    const current = sorting.get(id);
    sorting.set(id, {
      key: target.dataset.sort,
      dir: current?.key === target.dataset.sort && current.dir === "desc" ? "asc" : "desc",
    });
    render();
    return;
  }

  if (target.dataset.chunk) {
    selectedChunk = target.dataset.chunk;
    render();
  }
});

document.addEventListener("input", (event) => {
  const field = event.target.closest("[data-filter]");
  if (!field) return;

  filters.set(field.dataset.filter, field.value);
  render();

  // Yeniden çizim odağı düşürür; yazmaya devam edilebilsin.
  const next = document.querySelector(`[data-filter="${field.dataset.filter}"]`);
  next?.focus();
  next?.setSelectionRange(field.value.length, field.value.length);
});

if (TABS.some((tab) => tab.id === location.hash.slice(1))) {
  activeTab = location.hash.slice(1);
}

render();
load();
