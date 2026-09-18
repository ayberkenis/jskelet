import { on, qs, qsa } from "jskelet/client";

const PAGE_SIZE = 8;

/**
 * Changelog arama, sıralama, sayfalama ve çapa açma.
 *
 * Kartlar sunucuda tam basılıyor; island yalnızca görünürlüğü sürüyor.
 * JS inmezse bütün kartlar görünür kalır.
 *
 * @param {HTMLElement} element
 * @param {{ showing?: string, page?: string, empty?: string }} props
 * @returns {() => void}
 */
export function mount(element, props) {
  const search = qs(element, "[data-changelog-search]");
  const countEl = qs(element, "[data-changelog-count]");
  const pageEl = qs(element, "[data-changelog-page]");
  const list = qs(element, "[data-changelog-list]");
  const sortButtons = qsa(element, "[data-changelog-sort]");
  /** @type {HTMLElement[]} */
  const cards = [...qsa(element, "[data-changelog-card]")];

  let sort = "newest";
  let query = "";
  let page = 1;

  const showingTpl = props.showing ?? "Showing %s–%e of %t releases";
  const pageTpl = props.page ?? "Page %s / %t";
  const emptyTpl = props.empty ?? "No releases match.";

  const apply = () => {
    const needle = query.trim().toLowerCase();
    const matched = cards.filter((card) => {
      if (!needle) return true;
      return (card.dataset.search ?? "").includes(needle);
    });

    const ordered = sort === "oldest" ? [...matched].reverse() : matched;
    const totalPages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE) || 1);
    if (page > totalPages) page = totalPages;

    const start = (page - 1) * PAGE_SIZE;
    const slice = ordered.slice(start, start + PAGE_SIZE);
    const visible = new Set(slice);

    for (const card of cards) {
      card.hidden = !visible.has(card);
    }

    if (list) {
      for (const card of ordered) list.append(card);
    }

    if (countEl) {
      if (!ordered.length) {
        countEl.textContent = emptyTpl;
      } else {
        countEl.textContent = showingTpl
          .replace("%s", String(start + 1))
          .replace("%e", String(Math.min(ordered.length, start + PAGE_SIZE)))
          .replace("%t", String(ordered.length));
      }
    }

    if (pageEl) {
      pageEl.textContent = ordered.length
        ? pageTpl.replace("%s", String(page)).replace("%t", String(totalPages))
        : "";
    }

    for (const button of sortButtons) {
      const active = button.dataset.changelogSort === sort;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.className = active
        ? "rounded-xl border border-brand-400/40 bg-brand-400/15 px-3.5 py-2.5 text-sm font-semibold text-cyan-900 dark:border-brand-400/35 dark:bg-brand-400/15 dark:text-brand-300"
        : "rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300 dark:hover:border-white/20";
    }
  };

  const revealHash = (scroll) => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const card = element.querySelector(`[id="${CSS.escape(id)}"]`);
    if (!(card instanceof HTMLElement)) return;

    query = "";
    if (search) search.value = "";
    sort = "newest";

    const index = cards.indexOf(card);
    page = index >= 0 ? Math.floor(index / PAGE_SIZE) + 1 : 1;
    apply();
    card.hidden = false;
    if (scroll) card.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  apply();
  revealHash(false);

  const offs = [
    on(window, "hashchange", () => revealHash(true)),
    on(element, "input", (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      if (!("changelogSearch" in event.target.dataset)) return;
      query = event.target.value;
      page = 1;
      apply();
    }),
    on(element, "click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const sortBtn = target.closest("[data-changelog-sort]");
      if (sortBtn instanceof HTMLElement) {
        sort = sortBtn.dataset.changelogSort === "oldest" ? "oldest" : "newest";
        page = 1;
        apply();
        return;
      }

      const copyBtn = target.closest("[data-changelog-copy]");
      if (copyBtn instanceof HTMLElement) {
        const hash = copyBtn.dataset.changelogCopy ?? "";
        void navigator.clipboard.writeText(
          `${location.origin}${location.pathname}${hash}`,
        );
        return;
      }

      if (target.closest("[data-changelog-prev]")) {
        page = Math.max(1, page - 1);
        apply();
        return;
      }

      if (target.closest("[data-changelog-next]")) {
        page += 1;
        apply();
      }
    }),
  ];

  return () => {
    for (const off of offs) off();
  };
}
