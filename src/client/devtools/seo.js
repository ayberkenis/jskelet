/**
 * Dev SEO taraması: sayfanın DOM'unu okur, sorun listesi üretir ve isteğe
 * bağlı olarak elemanları kırmızı/sarı dikdörtgenlerle işaretler.
 *
 * Overlay ile aynı şekilde build'e girmez; `/__jskelet/dev/seo.js` altında
 * ham servis edilir. Kurallar bilinçli olarak küçük tutulur — Lighthouse
 * yerine geliştirme sırasında kaçırılan meta/başlık/alt boşluklarını yakalar.
 */

/**
 * @typedef {'error' | 'warn'} SeoSeverity
 *
 * @typedef {{
 *   id: string,
 *   severity: SeoSeverity,
 *   title: string,
 *   detail: string,
 *   category: string,
 *   element?: Element | null,
 * }} SeoIssue
 */

/** @param {string} text */
export function trimText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Başlık uzunluğu. Google genelde ~50–60 karakterde keser.
 * @param {string} title
 * @returns {{ severity: SeoSeverity, title: string, detail: string } | null}
 */
export function gradeTitleLength(title) {
  const value = trimText(title);
  if (!value) {
    return {
      severity: "error",
      title: "Missing document title",
      detail:
        "Every page needs a unique <title>. Search results and browser tabs use it; without one the URL is shown instead.",
    };
  }
  if (value.length < 10) {
    return {
      severity: "warn",
      title: "Title is very short",
      detail: `The title is ${value.length} characters. Aim for roughly 30–60 so the result snippet is informative.`,
    };
  }
  if (value.length > 60) {
    return {
      severity: "warn",
      title: "Title may be truncated",
      detail: `The title is ${value.length} characters. Search engines often cut around 60; put the distinctive words first.`,
    };
  }
  return null;
}

/**
 * @param {string | null | undefined} description
 * @returns {{ severity: SeoSeverity, title: string, detail: string } | null}
 */
export function gradeDescriptionLength(description) {
  const value = trimText(description ?? "");
  if (!value) {
    return {
      severity: "error",
      title: "Missing meta description",
      detail:
        "Add <meta name=\"description\">. It does not rank directly, but it is the default snippet under the title in search results.",
    };
  }
  if (value.length < 50) {
    return {
      severity: "warn",
      title: "Description is short",
      detail: `The description is ${value.length} characters. Around 120–160 characters usually fills the snippet without trailing off.`,
    };
  }
  if (value.length > 160) {
    return {
      severity: "warn",
      title: "Description may be truncated",
      detail: `The description is ${value.length} characters. Keep the important clause in the first ~155 characters.`,
    };
  }
  return null;
}

/**
 * @param {string | null} alt
 * @param {boolean} hasAttr
 * @returns {{ severity: SeoSeverity, title: string, detail: string } | null}
 */
export function gradeImageAlt(alt, hasAttr) {
  if (!hasAttr) {
    return {
      severity: "error",
      title: "Image missing alt",
      detail:
        "Add an alt attribute. Describe the image for screen readers and image search; use alt=\"\" only when the image is purely decorative.",
    };
  }
  const value = trimText(alt ?? "");
  // Boş alt dekoratif kabul edilir; uzun "image of …" gürültüsü uyarıdır.
  if (value.length > 125) {
    return {
      severity: "warn",
      title: "Alt text is very long",
      detail: `Alt is ${value.length} characters. Keep it to a short phrase; the surrounding copy should carry the rest.`,
    };
  }
  return null;
}

/**
 * @param {number[]} levels heading seviyeleri sırayla (1–6)
 * @returns {{ severity: SeoSeverity, title: string, detail: string } | null}
 */
export function gradeHeadingSkip(levels) {
  if (!levels.length) return null;
  let previous = levels[0];
  for (let i = 1; i < levels.length; i++) {
    const level = levels[i];
    if (level > previous + 1) {
      return {
        severity: "warn",
        title: "Heading level skipped",
        detail: `Found an h${level} right after an h${previous}. Keep the outline sequential (h1 → h2 → h3) so assistive tech and outline tools can follow the structure.`,
      };
    }
    previous = level;
  }
  return null;
}

/**
 * @param {Document} doc
 * @param {string} name
 * @returns {string | null}
 */
function metaContent(doc, name) {
  const node = doc.querySelector(`meta[name="${name}" i]`);
  return node?.getAttribute("content") ?? null;
}

/**
 * @param {Document} doc
 * @param {string} property
 * @returns {string | null}
 */
function ogContent(doc, property) {
  const node = doc.querySelector(`meta[property="${property}" i]`);
  return node?.getAttribute("content") ?? null;
}

/**
 * @param {Element | null | undefined} element
 * @returns {string}
 */
function describeElement(element) {
  if (!element) return "document";
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const cls = element.classList?.[0] ? `.${element.classList[0]}` : "";
  return `<${tag}${id}${cls}>`;
}

/**
 * Sayfadaki SEO sorunlarını tarar. `element` referansı highlight katmanı için
 * tutulur; JSON'a serileştirilmez.
 *
 * @param {Document} [doc]
 * @returns {SeoIssue[]}
 */
export function scanSeo(doc = document) {
  /** @type {SeoIssue[]} */
  const issues = [];
  let seq = 0;
  /** @param {Omit<SeoIssue, 'id'>} issue */
  const push = (issue) => {
    issues.push({ ...issue, id: `seo-${++seq}` });
  };

  const titleEl = doc.querySelector("title");
  const titleGrade = gradeTitleLength(titleEl?.textContent ?? "");
  if (titleGrade) {
    push({ ...titleGrade, category: "document", element: titleEl ?? doc.documentElement });
  }

  const descEl = doc.querySelector('meta[name="description" i]');
  const descGrade = gradeDescriptionLength(descEl?.getAttribute("content"));
  if (descGrade) {
    push({
      ...descGrade,
      category: "document",
      element: descEl ?? doc.head ?? doc.documentElement,
    });
  }

  const html = doc.documentElement;
  if (!html?.getAttribute("lang")?.trim()) {
    push({
      severity: "warn",
      title: "Missing html lang",
      detail:
        "Set <html lang=\"…\"> to the page language. Screen readers and translation tools use it; search engines treat it as a language signal.",
      category: "document",
      element: html,
    });
  }

  if (!doc.querySelector('meta[name="viewport" i]')) {
    push({
      severity: "error",
      title: "Missing viewport meta",
      detail:
        "Mobile Googlebot expects a viewport tag. Without it the page may be treated as non-mobile-friendly.",
      category: "document",
      element: doc.head ?? html,
    });
  }

  const canonicals = [...doc.querySelectorAll('link[rel="canonical" i]')];
  if (!canonicals.length) {
    push({
      severity: "warn",
      title: "Missing canonical URL",
      detail:
        "Add <link rel=\"canonical\"> so duplicate URLs (tracking params, trailing slash variants) consolidate to one preferred address.",
      category: "document",
      element: doc.head ?? html,
    });
  } else if (canonicals.length > 1) {
    push({
      severity: "error",
      title: "Multiple canonical links",
      detail: `Found ${canonicals.length} canonical tags. Only one should appear per page; extras confuse crawlers.`,
      category: "document",
      element: canonicals[0],
    });
  } else {
    const href = canonicals[0].getAttribute("href")?.trim() ?? "";
    if (!href) {
      push({
        severity: "error",
        title: "Empty canonical href",
        detail: "The canonical link has no href. Point it at the preferred absolute or site-relative URL for this page.",
        category: "document",
        element: canonicals[0],
      });
    }
  }

  const robots = trimText(metaContent(doc, "robots") ?? "").toLowerCase();
  if (/\bnoindex\b/.test(robots)) {
    push({
      severity: "warn",
      title: "Page is marked noindex",
      detail:
        "robots contains noindex, so search engines should not list this URL. Confirm that is intentional for this environment/page.",
      category: "document",
      element: doc.querySelector('meta[name="robots" i]') ?? doc.head ?? html,
    });
  }

  for (const prop of ["og:title", "og:description", "og:image"]) {
    if (!trimText(ogContent(doc, prop) ?? "")) {
      push({
        severity: "warn",
        title: `Missing ${prop}`,
        detail: `Open Graph ${prop} is empty. Social previews and some crawlers fall back to weaker signals without it.`,
        category: "social",
        element: doc.querySelector(`meta[property="${prop}" i]`) ?? doc.head ?? html,
      });
    }
  }

  if (!trimText(metaContent(doc, "twitter:card") ?? "")) {
    push({
      severity: "warn",
      title: "Missing twitter:card",
      detail:
        "Without twitter:card, X/Twitter may pick a poor preview layout. summary or summary_large_image are the usual choices.",
      category: "social",
      element: doc.head ?? html,
    });
  }

  const headings = [...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter(
    (node) => !node.closest("#jskelet-devtools, #jskelet-seo-layer"),
  );
  const h1s = headings.filter((node) => node.tagName === "H1");
  if (!h1s.length) {
    push({
      severity: "error",
      title: "Missing H1",
      detail:
        "Add a single top-level heading that names the page topic. It anchors the outline and is a strong on-page signal.",
      category: "structure",
      element: doc.body ?? html,
    });
  } else if (h1s.length > 1) {
    push({
      severity: "warn",
      title: "Multiple H1 headings",
      detail: `Found ${h1s.length} H1 elements. Prefer one primary H1; demote section titles to H2+.`,
      category: "structure",
      element: h1s[1],
    });
  }

  const levels = headings.map((node) => Number(node.tagName.slice(1)));
  const skip = gradeHeadingSkip(levels);
  if (skip) {
    const offender = headings.find((node, index) => {
      if (index === 0) return false;
      return Number(node.tagName.slice(1)) > levels[index - 1] + 1;
    });
    push({ ...skip, category: "structure", element: offender ?? headings[0] });
  }

  const images = [...doc.querySelectorAll("img")].filter(
    (node) => !node.closest("#jskelet-devtools, #jskelet-seo-layer"),
  );
  for (const img of images) {
    const grade = gradeImageAlt(img.getAttribute("alt"), img.hasAttribute("alt"));
    if (!grade) continue;
    const src = img.getAttribute("src") || img.getAttribute("data-src") || describeElement(img);
    push({
      ...grade,
      title: grade.title,
      detail: `${grade.detail} (${src})`,
      category: "media",
      element: img,
    });
  }

  const links = [...doc.querySelectorAll("a[href]")].filter(
    (node) => !node.closest("#jskelet-devtools, #jskelet-seo-layer"),
  );
  for (const link of links) {
    const href = (link.getAttribute("href") ?? "").trim();
    if (!href || href === "#") {
      push({
        severity: "warn",
        title: "Empty or placeholder link",
        detail:
          "This anchor has href=\"#\" or an empty href. Give it a real destination, or use a button if it only triggers a script.",
        category: "links",
        element: link,
      });
      continue;
    }

    const name = trimText(
      link.getAttribute("aria-label") ||
        link.getAttribute("title") ||
        link.textContent ||
        "",
    );
    const hasImgAlt = [...link.querySelectorAll("img")].some((img) =>
      trimText(img.getAttribute("alt") ?? ""),
    );
    if (!name && !hasImgAlt) {
      push({
        severity: "warn",
        title: "Link has no accessible name",
        detail:
          "The link has no text, aria-label, title, or image alt. Add a short label so users and crawlers know where it goes.",
        category: "links",
        element: link,
      });
    }
  }

  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = script.textContent?.trim() ?? "";
    if (!raw) {
      push({
        severity: "warn",
        title: "Empty JSON-LD block",
        detail: "A structured-data script is present but empty. Remove it or fill in valid JSON-LD.",
        category: "structured",
        element: script,
      });
      continue;
    }
    try {
      JSON.parse(raw);
    } catch (error) {
      push({
        severity: "error",
        title: "Invalid JSON-LD",
        detail: `Structured data failed to parse: ${error instanceof Error ? error.message : String(error)}`,
        category: "structured",
        element: script,
      });
    }
  }

  const rank = { error: 0, warn: 1 };
  issues.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] || a.category.localeCompare(b.category) || a.title.localeCompare(b.title),
  );
  return issues;
}

/* -------------------------------------------------------------- highlight */

const LAYER_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
.box {
  position: fixed; pointer-events: none;
  border: 2px solid var(--tone);
  background: color-mix(in srgb, var(--tone) 8%, transparent);
  border-radius: 4px;
}
.box.error { --tone: #fb7185; }
.box.warn { --tone: #fbbf24; }
.box.active {
  background: color-mix(in srgb, var(--tone) 18%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--tone) 55%, transparent);
}
.label {
  position: fixed; pointer-events: auto; cursor: pointer;
  max-width: min(280px, 70vw);
  padding: 3px 8px; border-radius: 4px 4px 0 0;
  font-size: 11px; font-weight: 700; line-height: 1.3;
  color: #1a1010; background: var(--tone);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  box-shadow: 0 4px 14px rgba(0,0,0,.28);
  transform: translateY(-100%);
}
.label.warn { color: #2a1d00; }
.detail {
  position: fixed; pointer-events: auto; z-index: 1;
  width: min(340px, calc(100vw - 24px));
  padding: 12px 14px; border-radius: 10px;
  background: #10131a; color: #eef1f5; border: 1px solid rgba(255,255,255,.12);
  box-shadow: 0 18px 40px rgba(0,0,0,.45);
  font-size: 12.5px; line-height: 1.55;
}
.detail .head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  font-size: 12px; font-weight: 700;
}
.detail .sev {
  font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  border-radius: 999px; padding: 1px 7px;
}
.detail .sev.error { background: rgba(251,113,133,.2); color: #fb7185; }
.detail .sev.warn { background: rgba(251,191,36,.18); color: #fbbf24; }
.detail .cat { color: #8b95a3; font-size: 10.5px; margin-left: auto; text-transform: uppercase; letter-spacing: .05em; }
.detail p { margin: 0; color: #c6ced9; }
.detail .close {
  position: absolute; top: 8px; right: 8px; border: 0; background: transparent;
  color: #8b95a3; cursor: pointer; font-size: 14px; line-height: 1; padding: 4px;
}
.detail .close:hover { color: #fff; }
`;

/**
 * Sayfa üzeri SEO işaretleri. Shadow DOM; sayfa CSS'i karışmaz.
 */
export class SeoHighlighter {
  constructor() {
    /** @type {SeoIssue[]} */
    this.issues = [];
    /** @type {string | null} */
    this.openId = null;
    /** @type {((id: string | null) => void) | null} */
    this.onSelect = null;
    /** @type {HTMLElement | null} */
    this.host = null;
    /** @type {ShadowRoot | null} */
    this.shadow = null;
    /** @type {(() => void) | null} */
    this._onViewport = null;
  }

  /** @returns {boolean} */
  get active() {
    return Boolean(this.host);
  }

  /**
   * @param {SeoIssue[]} issues
   * @param {{ select?: string | null }} [opts]
   */
  show(issues, opts = {}) {
    this.issues = issues.filter((issue) => issue.element);
    if (opts.select !== undefined) this.openId = opts.select;
    this.#ensure();
    this.#paint();
    this.#bindViewport();
  }

  hide() {
    this.#unbindViewport();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.openId = null;
  }

  /** @param {string | null} id */
  select(id) {
    this.openId = id;
    const issue = this.issues.find((item) => item.id === id);
    issue?.element?.scrollIntoView({ block: "center", behavior: "smooth" });
    this.#paint();
    this.onSelect?.(id);
  }

  #ensure() {
    if (this.host) return;
    const host = document.createElement("div");
    host.id = "jskelet-seo-layer";
    host.setAttribute("data-jskelet", "seo-layer");
    document.documentElement.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = LAYER_CSS;
    const root = document.createElement("div");
    root.className = "layer";
    shadow.append(style, root);
    root.addEventListener("click", (event) => {
      const target = /** @type {HTMLElement} */ (event.target).closest("[data-seo-id], [data-action]");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (target.dataset.action === "close") {
        this.openId = null;
        this.#paint();
        this.onSelect?.(null);
        return;
      }
      const id = target.dataset.seoId;
      if (!id) return;
      this.openId = this.openId === id ? null : id;
      this.#paint();
      this.onSelect?.(this.openId);
    });
    this.host = host;
    this.shadow = shadow;
  }

  #bindViewport() {
    if (this._onViewport) return;
    this._onViewport = () => this.#paint();
    window.addEventListener("scroll", this._onViewport, true);
    window.addEventListener("resize", this._onViewport);
  }

  #unbindViewport() {
    if (!this._onViewport) return;
    window.removeEventListener("scroll", this._onViewport, true);
    window.removeEventListener("resize", this._onViewport);
    this._onViewport = null;
  }

  #paint() {
    const root = this.shadow?.querySelector(".layer");
    if (!root) return;

    const parts = [];
    for (const issue of this.issues) {
      const el = issue.element;
      if (!el || !el.isConnected) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) continue;

      const top = Math.max(0, rect.top);
      const left = Math.max(0, rect.left);
      const width = Math.min(rect.width, window.innerWidth - left);
      const height = Math.min(rect.height, window.innerHeight - top);
      if (width < 2 || height < 2) continue;

      const active = this.openId === issue.id ? " active" : "";
      parts.push(`
        <div class="box ${issue.severity}${active}"
          style="top:${top}px;left:${left}px;width:${width}px;height:${height}px"></div>
        <button type="button" class="label ${issue.severity}" data-seo-id="${escapeAttr(issue.id)}"
          style="top:${top}px;left:${left}px" title="${escapeAttr(issue.title)}">${escapeHtml(issue.title)}</button>
      `);
    }

    if (this.openId) {
      const issue = this.issues.find((item) => item.id === this.openId);
      const el = issue?.element;
      if (issue && el?.isConnected) {
        const rect = el.getBoundingClientRect();
        const detailTop = Math.min(window.innerHeight - 160, Math.max(8, rect.bottom + 8));
        const detailLeft = Math.min(window.innerWidth - 360, Math.max(12, rect.left));
        parts.push(`
          <div class="detail" style="top:${detailTop}px;left:${detailLeft}px" role="dialog">
            <button type="button" class="close" data-action="close" aria-label="Close">✕</button>
            <div class="head">
              <span class="sev ${issue.severity}">${issue.severity}</span>
              <span>${escapeHtml(issue.title)}</span>
              <span class="cat">${escapeHtml(issue.category)}</span>
            </div>
            <p>${escapeHtml(issue.detail)}</p>
          </div>
        `);
      }
    }

    root.innerHTML = parts.join("");
  }
}

/** @param {string} value */
function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
  );
}

/** @param {string} value */
function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
