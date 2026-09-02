import { attrs, cn, esc } from "jskelet/html";

/**
 * Ana sayfadaki Redis / admin / Cloudflare görsel hikâyesi.
 * Metin `t.home.ops` sözlüğünden gelir; diyagramlar HTML — görsel ürün
 * anlatımı için SVG/foto yerine etkileşimli sahne tercih edildi.
 */

/**
 * @param {{ label: string, value: string }} fact
 * @returns {string}
 */
function factChip({ label, value }) {
  return `<div class="rounded-xl border border-slate-200/80 bg-white/70 px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
    <p class="m-0 text-[10px] font-bold tracking-[0.16em] text-slate-500 uppercase dark:text-slate-400">${esc(label)}</p>
    <p class="mt-1 mb-0 font-mono text-sm font-semibold text-slate-900 dark:text-white">${esc(value)}</p>
  </div>`;
}

/**
 * L1 → Redis → Cloudflare katman diyagramı.
 * @param {{ facts: { label: string, value: string }[] }} story
 * @returns {string}
 */
function redisScene(story) {
  const tiers = [
    {
      key: "l1",
      title: "L1",
      subtitle: "process memory",
      tone: "from-cyan-400/30 to-cyan-500/5 border-cyan-400/40",
    },
    {
      key: "redis",
      title: "Redis",
      subtitle: "shared HTML · data",
      tone: "from-rose-400/25 to-amber-400/5 border-rose-400/35",
    },
    {
      key: "edge",
      title: "Edge",
      subtitle: "Cloudflare",
      tone: "from-sky-400/25 to-indigo-400/5 border-sky-400/35",
    },
  ];

  return `<div class="ops-scene" data-ops-scene="redis">
    <div class="ops-tiers" aria-hidden="true">
      ${tiers
        .map(
          (tier, index) => `
        <div class="ops-tier bg-gradient-to-br ${tier.tone}" data-ops-tier="${esc(tier.key)}" style="--i:${index}">
          <span class="ops-tier-title">${esc(tier.title)}</span>
          <span class="ops-tier-sub">${esc(tier.subtitle)}</span>
        </div>
        ${
          index < tiers.length - 1
            ? `<div class="ops-pipe" data-ops-pipe style="--i:${index}">
                <span class="ops-packet" data-ops-packet></span>
              </div>`
            : ""
        }`,
        )
        .join("")}
    </div>
    <div class="mt-5 grid gap-2 sm:grid-cols-3">
      ${story.facts.map(factChip).join("")}
    </div>
  </div>`;
}

/**
 * Yönetim paneli maketi.
 * @param {Record<string, unknown>} story
 * @returns {string}
 */
function adminScene(story) {
  const nav = /** @type {string[]} */ (story.nav ?? []);
  const cards = /** @type {{ label: string, value: string, note: string }[]} */ (
    story.cards ?? []
  );
  const logLines = /** @type {{ method: string, path: string, cache: string, ms: string }[]} */ (
    story.logLines ?? []
  );

  return `<div class="ops-scene" data-ops-scene="admin">
    <div class="ops-panel" data-ops-panel aria-hidden="true">
      <div class="ops-panel-bar">
        <span class="ops-dot bg-rose-400"></span>
        <span class="ops-dot bg-amber-300"></span>
        <span class="ops-dot bg-emerald-400"></span>
        <span class="ml-auto font-mono text-[10px] tracking-wide text-slate-500">/_jskelet/admin</span>
      </div>
      <div class="ops-panel-body">
        <nav class="ops-panel-nav">
          ${nav
            .map(
              (item, index) =>
                `<span class="${cn("ops-panel-link", index === 0 && "is-active")}" data-ops-nav-item style="--i:${index}">${esc(item)}</span>`,
            )
            .join("")}
        </nav>
        <div class="ops-panel-main">
          <div class="ops-panel-cards">
            ${cards
              .map(
                (card, index) => `
              <div class="ops-stat" data-ops-stat style="--i:${index}">
                <p class="m-0 text-[10px] font-bold tracking-[0.14em] text-slate-500 uppercase">${esc(card.label)}</p>
                <p class="mt-1 mb-0 font-mono text-xl font-semibold text-white">${esc(card.value)}</p>
                <p class="mt-1 mb-0 text-[11px] text-slate-400">${esc(card.note)}</p>
              </div>`,
              )
              .join("")}
          </div>
          <div class="ops-log" data-ops-log>
            ${logLines
              .map(
                (line, index) => `
              <div class="ops-log-row" data-ops-log-row style="--i:${index}">
                <span class="text-cyan-300">${esc(line.method)}</span>
                <span class="truncate text-slate-300">${esc(line.path)}</span>
                <span class="${line.cache === "HIT" ? "text-emerald-300" : line.cache === "STALE" ? "text-amber-300" : "text-sky-300"}">${esc(line.cache)}</span>
                <span class="text-slate-500">${esc(line.ms)}ms</span>
              </div>`,
              )
              .join("")}
          </div>
        </div>
      </div>
    </div>
    <div class="mt-5 grid gap-2 sm:grid-cols-3">
      ${/** @type {{ label: string, value: string }[]} */ (story.facts).map(factChip).join("")}
    </div>
  </div>`;
}

/**
 * Cloudflare purge akışı.
 * @param {Record<string, unknown>} story
 * @returns {string}
 */
function cloudflareScene(story) {
  const steps = /** @type {{ label: string, detail: string }[]} */ (story.steps ?? []);

  return `<div class="ops-scene" data-ops-scene="cloudflare">
    <div class="ops-flow" aria-hidden="true">
      ${steps
        .map(
          (step, index) => `
        <div class="ops-flow-step" data-ops-flow-step style="--i:${index}">
          <span class="ops-flow-index">${index + 1}</span>
          <span class="ops-flow-label">${esc(step.label)}</span>
          <span class="ops-flow-detail">${esc(step.detail)}</span>
        </div>
        ${
          index < steps.length - 1
            ? `<div class="ops-flow-arrow" data-ops-flow-arrow style="--i:${index}">›</div>`
            : ""
        }`,
        )
        .join("")}
    </div>
    <div class="ops-purge" data-ops-purge>
      <div class="ops-purge-track">
        <span class="ops-purge-beam" data-ops-beam></span>
      </div>
      <p class="m-0 text-center font-mono text-[11px] text-slate-500 dark:text-slate-400">purgeCloudflare({ prefix: "/news/" })</p>
    </div>
    <div class="mt-5 grid gap-2 sm:grid-cols-3">
      ${/** @type {{ label: string, value: string }[]} */ (story.facts).map(factChip).join("")}
    </div>
  </div>`;
}

/**
 * @param {Record<string, unknown>} story
 * @param {boolean} active
 * @returns {string}
 */
function storyPanel(story, active) {
  const id = String(story.id);
  let visual = "";
  if (id === "redis") visual = redisScene(/** @type {any} */ (story));
  else if (id === "admin") visual = adminScene(story);
  else visual = cloudflareScene(story);

  return `<article
    class="ops-panel-story ${active ? "is-active" : ""}"
    data-ops-panel-story="${esc(id)}"
    ${active ? "" : 'hidden aria-hidden="true"'}
  >
    <p class="m-0 text-[10px] font-bold tracking-[0.2em] text-cyan-700 uppercase dark:text-cyan-300">${esc(String(story.kicker))}</p>
    <h3 class="mt-2 text-2xl font-bold tracking-tight text-balance sm:text-3xl">${esc(String(story.title))}</h3>
    <p class="mt-3 mb-0 max-w-2xl text-sm/6 text-slate-600 sm:text-base/7 dark:text-slate-300">${esc(String(story.body))}</p>
    <div class="mt-8">${visual}</div>
  </article>`;
}

/**
 * @param {{
 *   eyebrow: string,
 *   title: string,
 *   lead: string,
 *   tabsLabel: string,
 *   stories: Record<string, unknown>[],
 * }} ops
 * @returns {string}
 */
export function opsStory(ops) {
  const stories = ops.stories ?? [];
  const tabs = stories
    .map((story, index) => {
      const id = String(story.id);
      const selected = index === 0;
      return `<button
        type="button"
        class="ops-tab ${selected ? "is-active" : ""}"
        data-ops-tab="${esc(id)}"
        aria-pressed="${selected ? "true" : "false"}"
      >${esc(String(story.tab))}</button>`;
    })
    .join("");

  const panels = stories.map((story, index) => storyPanel(story, index === 0)).join("");

  return `<div
    class="ops-story"
    data-island="ops-story"
    data-ops-root
    ${attrs({ "aria-label": ops.tabsLabel })}
  >
    <div class="ops-tabs" role="tablist" aria-label="${esc(ops.tabsLabel)}">
      ${tabs}
    </div>
    <div class="ops-panels mt-8">
      ${panels}
    </div>
  </div>`;
}
