/**
 * İngilizce içerik sözlüğü — sitenin varsayılan dili.
 *
 * Şablonlar dil bilmez: controller çözümlenmiş sözlüğü `t` olarak geçer ve
 * her metin oradan okunur. İki dosya arasında aynı anahtar kümesini korumak
 * bu yüzden önemli; eksik bir anahtar şablonda `undefined` basar.
 *
 * Not: buradaki hiçbir performans sayısı elle yazılmıyor. Ölçülen değerler
 * `lib/payload.js` (build çıktısı) ve `lib/release.js` (paket künyesi)
 * üzerinden geliyor; kıyaslama tablosu ise mimari farkları anlatır, hız
 * iddiası taşımaz.
 */

export default {
  locale: "en",
  htmlLang: "en",
  ogLocale: "en_US",
  label: "English",
  short: "EN",

  meta: {
    titleTemplate: "%s · JSkelet",
    description:
      "A lean Node.js framework for content sites: complete HTML from the server, islands for interaction, and an in-memory HTML cache with stale-while-revalidate.",
  },

  nav: [
    { key: "howItWorks", label: "How it works" },
    { key: "compare", label: "Compare" },
    { key: "migrate", label: "Migrate" },
    { key: "docs", label: "Docs" },
    { key: "changelog", label: "Changelog" },
  ],

  ui: {
    skipToContent: "Skip to content",
    mainMenu: "Main menu",
    mobileMenu: "Mobile menu",
    toggleTheme: "Toggle theme",
    openMenu: "Open menu",
    github: "View on GitHub",
    githubShort: "GitHub",
    download: "Download",
    downloadVersion: "Get v%s",
    copy: "copy",
    copied: "copied",
    copyFailed: "failed",
    language: "Language",
    languageSwitch: "Switch language",
    releaseLabel: "Latest release",
    sitemap: "Sitemap",
    license: "%s licensed",
    nodeRequirement: "Node.js %s",
    activeDevelopment: "Actively developed",
    footerTagline:
      "Render content on the server. Wake JavaScript only where it earns its weight.",
    footerNote:
      "This site is the marketing example in the repository, and every byte figure on it is measured from its own build output.",
    exploreHint: "Learn more",
  },

  pages: {
    home: {
      title: "The skeleton of the web, nothing more",
      description:
        "Complete HTML from the server, islands for interaction, and an in-memory HTML cache. No React runtime, no hydration waterfall.",
    },
    howItWorks: {
      title: "The journey of a request",
      description:
        "Five clear stops from request to screen: Express, the HTML cache, the controller, EJS, and islands that wake only when needed.",
    },
    compare: {
      title: "Pick the right tool for your project",
      description:
        "Architectural trade-offs between JSkelet, Next.js App Router, Astro and hand-written Express + EJS — including the rows JSkelet loses.",
    },
    migrate: {
      title: "Move over from Next.js, one page at a time",
      description:
        "A mapping table and a safe order: route tables instead of the app router, islands instead of client components, HTML TTL instead of ISR.",
    },
    docs: {
      title: "Documentation",
      description:
        "A small API surface with eleven chapters that explain not just how each decision works, but why it was made.",
    },
    changelog: {
      title: "Changelog",
      description:
        "Every release with the features added, the behaviour changed and the bugs fixed.",
    },
    download: {
      title: "Download and install",
      description:
        "Version details, requirements, dependencies and the four commands you need to go from empty folder to running site.",
    },
  },

  home: {
    badge: "Open source · Node.js %s · %s",
    headline: "The skeleton of the web.",
    headlineAccent: "Nothing more.",
    lead: "Complete HTML arrives from the server. JavaScript wakes up only where you touch it. The cache has the page ready before your visitor asks for it.",
    ctaPrimary: "Explore the flow",
    ctaSecondary: "Download v%s",
    chips: ["Express 5", "EJS + Islands", "HTML TTL Cache"],
    marquee: [
      "Complete HTML",
      "Just enough JavaScript",
      "Stale-while-revalidate",
      "Zero React runtime",
    ],
    hero: {
      diagramLabel: "The JSkelet request flow",
      logoAlt: "JSkelet logo",
      responseLabel: "Response",
      responseValue: "200 · HTML ready",
      clientLabel: "Client",
      clientValue: "island.mount()",
      terminalLabel: "terminal",
      terminalLines: ["route ready", "island ready"],
    },
    pillars: {
      eyebrow: "Lean architecture",
      title: "Three layers. One fast experience.",
      lead: "The server prepares the content, the cache removes the waiting, and islands add only the behaviour a page actually needs.",
    },
    payload: {
      eyebrow: "Transparent performance",
      title: "We don't claim lightweight. We show it.",
      lead: "These numbers are read from the real build output and reflect the weight after gzip. Working code, not a marketing promise.",
      totalLabel: "Everything included (gzip)",
      totalNote:
        "Stylesheet, entry, sprite and every island on the site combined. No single page downloads all of it.",
      fontsValue: "0",
      fontsLabel: "Web font requests",
      fontsNote: "A system font stack. No FOUT and no font-driven layout shift.",
      blockingValue: "1",
      blockingLabel: "Render-blocking request",
      blockingNote:
        "One stylesheet. The client entry is a module, so it is deferred.",
      eagerValue: "2",
      eagerLabel: "Islands loaded immediately",
      eagerNote:
        "Theme and mobile menu. Every other island waits until it scrolls into view.",
      footnote:
        "If you want a comparable number, measure your own project the same way: a claim of being lightweight only means something once it is measured on your page.",
    },
    cache: {
      eyebrow: "Uninterrupted flow",
      title: "The old page ships instantly. The new one is built behind it.",
      lead: "Stale-while-revalidate keeps visitors out of the render queue. One route, one TTL, predictable behaviour.",
      points: [
        {
          tone: "good",
          text: "The cache key is the path and query; on a hit the controller never runs.",
        },
        {
          tone: "good",
          text: "Prewarm renders your pages at boot, so the first visitor never lands on a cold cache.",
        },
        {
          tone: "good",
          text: "Every response carries its own cache status header, so measuring needs no extra tooling.",
        },
        {
          tone: "bad",
          text: "There is no targeted invalidation: you get TTLs and a full flush.",
        },
      ],
      codeLabel: "routes/10-pages.mjs",
    },
    fit: {
      eyebrow: "The right match",
      title: "It doesn't try to do everything.",
      lead: "JSkelet is built for content and discoverability. For state-heavy applications, another tool is often the better answer.",
    },
    faq: {
      eyebrow: "FAQ",
      title: "Frequently asked",
      more: "More questions and the full mapping table live on the %s.",
      moreLink: "migration page",
    },
    finalCta: {
      title: "Your first page is ready in five minutes.",
      body: "One command scaffolds a working skeleton with a route, a component and an island.",
      primary: "Download",
      secondary: "Read the docs",
    },
  },

  /**
   * `lib/payload.js` yalnızca ölçüm yapar ve satırları anahtarla döndürür;
   * görünen adlar burada, çünkü ölçüm dilden bağımsız, etiket değil.
   */
  payloadLabels: {
    "app.css": "Stylesheet (Tailwind v4 output)",
    "main.js": "Client entry (island loader)",
    "sprite.svg": "Icon sprite",
    islands: "Every island (on demand, separate chunks)",
    total: "Total — if every island loads",
    caption:
      "This page's own build output, read from disk and measured as the request came in. The right column is after gzip. Island chunks download only when their element scrolls into view; a first load never fetches all of them.",
    missing:
      "No build output was found, so there is nothing to measure. Once the build command runs, this table fills with the site's real asset sizes. The page itself keeps working without a build: with no manifest, the layout simply prints no stylesheet tag.",
    bytesColumn: "Raw",
    gzipColumn: "gzip",
  },

  pillars: [
    {
      icon: "FileHtml",
      title: "Content arrives ready",
      body: "The browser never receives an empty shell. People and crawlers see the same complete HTML without waiting for JavaScript.",
    },
    {
      icon: "Island",
      title: "Behaviour wakes in place",
      body: "A menu, a counter or a chart lives in its own island. Its module downloads only when it becomes visible; the rest of the page stays quiet.",
    },
    {
      icon: "Lightning",
      title: "Waiting leaves the path",
      body: "HTML is kept warm in memory. An expired page is served immediately while the fresh one is built behind it, so nobody queues for a render.",
    },
  ],

  pipeline: [
    {
      step: "1",
      title: "The request comes in",
      body: "Express 5 handles security headers, redirects and static files in a fixed order. The flow is visible and documented — there is no hidden magic.",
    },
    {
      step: "2",
      title: "Warm HTML is looked up",
      body: "On a hit the ready page returns instantly. If the TTL has expired the visitor still waits for nothing: the current HTML ships and the refresh starts behind it.",
    },
    {
      step: "3",
      title: "Data is gathered in one place",
      body: "A plain async controller returns the view, the data and the metadata. Easy to read, with none of the framework ceremony.",
    },
    {
      step: "4",
      title: "The page is assembled",
      body: "EJS turns the body and the layout into complete HTML. Small function components can be reused on pages and inside fragments alike.",
    },
    {
      step: "5",
      title: "Only the needed part comes alive",
      body: "The browser downloads the module for the visible island and attaches its behaviour. Even if JavaScript never arrives, the content stays readable.",
    },
  ],

  howItWorks: {
    hero: {
      eyebrow: "The journey of a request",
      title: "From the server to the screen, five clear stops.",
      lead: "No black box. Every step is readable, replaceable and understandable on its own.",
    },
  },

  islandContract: {
    eyebrow: "The island contract",
    title: "Bring the piece that needs it to life, not the whole page.",
    lead: "The server completes the view. An island adds a small layer of behaviour. Even on a broken connection, the content stays in place.",
    points: [
      "The default strategy is visibility: the observer starts loading 200px early.",
      "One attribute makes an island eager for global behaviour, another defers it until the browser is idle.",
      "Props travel as JSON in the markup, so server data is never fetched twice.",
      "A mount function may return a cleanup function.",
    ],
    payoff: {
      eyebrow: "The payoff",
      title: "What these three decisions buy you",
    },
    ctaPrimary: "Compare and measure",
    ctaSecondary: "Read the docs",
  },

  comparison: {
    columns: [
      "JSkelet",
      "Next.js (App Router)",
      "Astro + adapter",
      "Express + EJS (by hand)",
    ],
    legend: {
      good: "an advantage of this approach",
      bad: "a deliberate or structural gap",
      neutral: "neutral, simply different",
    },
    rows: [
      {
        label: "Client JS on an empty page",
        values: [
          { text: "One entry; nothing else without islands", tone: "good" },
          { text: "React plus runtime, even on a static page", tone: "bad" },
          { text: "None, unless you pick a UI framework", tone: "good" },
          { text: "None (and no interaction either)", tone: "good" },
        ],
      },
      {
        label: "Interaction model",
        values: [
          { text: "Vanilla islands with a mount function", tone: "good" },
          { text: "Component tree with a server/client boundary", tone: "neutral" },
          { text: "Islands in the UI framework of your choice", tone: "good" },
          { text: "Script tags you wire up yourself", tone: "neutral" },
        ],
      },
      {
        label: "HTML caching",
        values: [
          { text: "In-process TTL with stale-while-revalidate", tone: "good" },
          { text: "ISR, tied to the platform and its storage", tone: "neutral" },
          { text: "Static build or the adapter's CDN", tone: "neutral" },
          { text: "None; you build it yourself", tone: "bad" },
        ],
      },
      {
        label: "Targeted invalidation",
        values: [
          { text: "Missing — TTLs and a full flush only", tone: "bad" },
          { text: "Supported by tag and by path", tone: "good" },
          { text: "A rebuild, or whatever the adapter offers", tone: "neutral" },
          { text: "None", tone: "bad" },
        ],
      },
      {
        label: "Routing",
        values: [
          { text: "An explicit table; paths are written down", tone: "neutral" },
          { text: "File system", tone: "neutral" },
          { text: "File system", tone: "neutral" },
          { text: "An explicit table", tone: "neutral" },
        ],
      },
      {
        label: "Streaming and partial render",
        values: [
          { text: "Missing; slow sections move to fragments", tone: "bad" },
          { text: "Supported through streaming boundaries", tone: "good" },
          { text: "Server islands and deferred content", tone: "neutral" },
          { text: "By hand", tone: "neutral" },
        ],
      },
      {
        label: "Build chain",
        values: [
          { text: "esbuild and Tailwind v4; optional steps skip themselves", tone: "good" },
          { text: "A powerful bundler with a wide config surface", tone: "neutral" },
          { text: "Vite", tone: "good" },
          { text: "Whatever you assemble", tone: "neutral" },
        ],
      },
      {
        label: "Types",
        values: [
          { text: "Plain JS with JSDoc; no compile step", tone: "neutral" },
          { text: "TypeScript as a first-class citizen", tone: "good" },
          { text: "TypeScript as a first-class citizen", tone: "good" },
          { text: "Up to you", tone: "neutral" },
        ],
      },
      {
        label: "Per-session page HTML",
        values: [
          { text: "Not cacheable; move it to a fragment", tone: "bad" },
          { text: "Supported", tone: "good" },
          { text: "Supported in SSR mode", tone: "good" },
          { text: "Supported", tone: "good" },
        ],
      },
    ],
  },

  compare: {
    hero: {
      eyebrow: "Choose deliberately",
      title: "There is no winner. There is a fit.",
      lead: "See the strengths and the gaps of four approaches on the same ground. We are not hiding the rows JSkelet loses.",
    },
    live: {
      eyebrow: "Right now, in this browser",
      title: "Watch the cache difference live.",
      lead: "Two requests, the same server and the same network. The only difference: one is served ready, the other is rendered from scratch every time.",
      cachedLabel: "Served from cache",
      cachedBadge: "live",
      cachedNote: "Served from memory; the controller never runs.",
      freshLabel: "Rendered every time",
      freshBadge: "every request",
      freshNote: "Marked no-store, so the template engine runs each time.",
      measuring: "measuring…",
      status:
        "This section measures nothing when JavaScript is disabled; the rest of the page is unaffected.",
      statusDone: "%s requests, median. Measured in this browser, on this network.",
      statusFailed: "Measurement failed.",
      footnote:
        "Locally both numbers land in the low milliseconds and the gap looks small. What matters is that the cached side is independent of your data source: if the controller calls an API or a database, that cost lands on a miss and never on a hit.",
    },
    weight: {
      eyebrow: "Measured weight",
      title: "This site's own build output",
      lead: "What the 'client JS on an empty page' row above actually looks like in this project.",
    },
    apply: {
      eyebrow: "Decide",
      title: "Apply the table to your own project",
      lead: "Most rows are neutral. The decision usually comes down to the last two.",
      ctaPrimary: "Migrate from Next.js",
      ctaSecondary: "How it works",
    },
  },

  fit: {
    title: { good: "Good fit", bad: "Wrong choice" },
    good: [
      "Content sites, blogs and documentation",
      "Marketing and campaign pages",
      "Product listings, catalogues and classifieds",
      "Any page where SEO is a revenue line",
    ],
    bad: [
      "Dashboards and admin panels",
      "Editor-like, state-heavy interfaces",
      "Pages that change with every signed-in user",
      "Real-time screens that update every second",
    ],
  },

  docs: {
    hero: {
      eyebrow: "Take the map",
      title: "Small surface. Deep documentation.",
      lead: "From installation to deployment, read not just how each decision is used but why it exists.",
    },
    examples: {
      label: "run the examples",
      title: "Three examples in the repository",
      body: "The minimal example is the smallest thing that runs, the blog example touches every surface of the framework, and the marketing example is the page you are reading.",
      note: "With the server running, the smoke script verifies that every endpoint answers as expected.",
    },
    openLabel: "Open chapter",
    items: [
      {
        file: "01-baslangic",
        title: "Getting started",
        body: "Installation, your first route, your first island, the directory layout and the CLI.",
      },
      {
        file: "02-mimari",
        title: "Architecture",
        body: "The decisions, their reasoning, and the middleware order that is treated as a contract.",
      },
      {
        file: "03-routing",
        title: "Routing",
        body: "Route modules, the controller contract and how load order is decided.",
      },
      {
        file: "04-render-ve-sablonlar",
        title: "Rendering and templates",
        body: "Layout, components, helpers and the metadata schema.",
      },
      {
        file: "05-islands",
        title: "Islands",
        body: "The island contract, hydration strategies, shared state and DOM helpers.",
      },
      {
        file: "06-cache",
        title: "Cache",
        body: "TTLs, stale-while-revalidate, cache keys and prewarming.",
      },
      {
        file: "07-yapilandirma",
        title: "Configuration",
        body: "The complete configuration reference, field by field.",
      },
      {
        file: "08-build",
        title: "Build",
        body: "The build pipeline, the manifest, Tailwind sources and the icon sprite.",
      },
      {
        file: "09-dev-araclari",
        title: "Dev tools",
        body: "The development flow, the overlay, the report page and the dev gate.",
      },
      {
        file: "10-dagitim",
        title: "Deployment",
        body: "Production, Docker, reverse proxies and health checks.",
      },
      {
        file: "11-tasima",
        title: "Migration",
        body: "Moving from Next.js: the mapping table and a staged plan.",
      },
    ],
  },

  migrate: {
    hero: {
      eyebrow: "A staged move",
      title: "Don't throw away what you know about Next.js.",
      lead: "Most of the concepts you already use have a smaller counterpart here. Move pages one at a time while traffic keeps flowing.",
      chips: [
        "page.tsx → EJS",
        "Client Component → Island",
        "ISR → HTML TTL",
      ],
    },
    table: {
      from: "Next.js",
      to: "JSkelet",
      note: "The full plan and the reasoning behind it live in the migration chapter of the docs.",
    },
    order: {
      eyebrow: "A safe route",
      title: "Move the easiest win first.",
      lead: "Two applications can live side by side behind a reverse proxy. Keep the risk small, measure, then take the next page.",
      steps: [
        {
          tone: "good",
          text: "Start with your highest-traffic, least interactive page — usually a list or a detail view.",
        },
        {
          tone: "good",
          text: "Move the layout and your metadata defaults into hooks.",
        },
        {
          tone: "good",
          text: "Reduce client components to islands: most become a button and a fetch.",
        },
        {
          tone: "good",
          text: "Split per-user sections into fragment endpoints and mark them no-store.",
        },
        {
          tone: "good",
          text: "Measure your TTLs: the cache header and the dev overlay are enough.",
        },
        {
          tone: "bad",
          text: "Leave the dashboard where it is. This is not the right tool for those pages.",
        },
      ],
      configLabel: "jskelet.config.mjs",
      configNote:
        "A broken config never takes the site down: a failing hook or header rule logs a warning and falls back to the default.",
    },
    faq: { eyebrow: "FAQ", title: "Asked most often while migrating" },
    items: [
      { from: "app/page.tsx", to: "A route entry plus an EJS page template" },
      { from: "generateMetadata()", to: "The metadata field your controller returns" },
      { from: "layout.tsx", to: "The layout template plus a layout context hook" },
      { from: "not-found.tsx", to: "A not-found hook in the config" },
      { from: "redirect() / notFound()", to: "The same names, imported from jskelet" },
      {
        from: "next.config redirects/rewrites/headers",
        to: "The same syntax inside jskelet.config.mjs",
      },
      { from: "export const revalidate = 60", to: "A revalidate option on the route" },
      { from: "React client component", to: "An island element plus a mount function" },
      { from: "Suspense-deferred section", to: "A fragment endpoint rendered on demand" },
      { from: "next/image, next/link", to: "The image() and link() helpers" },
      { from: "React Context / zustand", to: "createStore() for small cross-island state" },
    ],
  },

  faq: [
    {
      q: "Why is there no React?",
      a: "Most pages are not interactive. React's cost is fixed: the runtime downloads, a tree is built, hydration runs — and the result is the same HTML the server already produced. JSkelet removes that fixed cost and gives interaction only to the elements that need it.",
    },
    {
      q: "Can I use TypeScript?",
      a: "The framework itself is plain JavaScript with JSDoc and has no compile step. On the application side you can enable checked JavaScript and keep most of the same type safety without a build; for .ts files you would add a step to the pipeline yourself.",
    },
    {
      q: "The cache lives in process memory. What happens with multiple instances?",
      a: "Each instance keeps its own cache, so the initial warm-up happens once per instance and TTL boundaries can drift apart. Prewarming closes most of that gap at boot. If you need targeted invalidation, this model is not enough.",
    },
    {
      q: "Does it run without a build?",
      a: "Yes. Without a manifest the asset helper falls back to unhashed paths and the layout simply prints no stylesheet tag. Forgetting the build step gives you an unstyled but working page, not an error.",
    },
    {
      q: "Are Tailwind, sharp and the icon set required?",
      a: "None of them. They are optional peer dependencies: if a package is missing, its build step is skipped silently. A broken config behaves the same way — it warns and falls back instead of taking the site down.",
    },
    {
      q: "How does theming work if the HTML is identical for everyone?",
      a: "It is never decided on the server. Because cached HTML goes out identically to every visitor, per-person choices like theme and language are made in the browser; the theme button on this page is an eager island.",
    },
  ],

  changelog: {
    hero: {
      eyebrow: "Release history",
      title: "What changed, and when.",
      lead: "Every release with the features added, the behaviour changed and the bugs fixed. The version at the top is the one you install today.",
    },
    currentLabel: "Current release",
    currentNote: "This is the version the install command resolves to right now.",
    dateLabel: "Released",
    types: {
      added: "Added",
      changed: "Changed",
      fixed: "Fixed",
      removed: "Removed",
    },
    statuses: {
      current: "current",
      previous: "previous",
    },
    cta: {
      title: "Install this release",
      body: "One command from npm, and the version above is the one you get.",
      primary: "Download page",
      secondary: "Documentation",
    },
    /**
     * Örnek verisi: depoda henüz bir CHANGELOG.md yok, bu liste sürüm
     * sayfasının nasıl kurulduğunu göstermek için burada duruyor. Gerçek bir
     * projede aynı dizi CHANGELOG.md'den ya da GitHub Releases'ten beslenir;
     * sayfanın geri kalanı hiç değişmez.
     */
    entries: [
      {
        version: "0.1.1",
        date: "2026-08-30",
        status: "current",
        summary:
          "Navigation became configurable and the export surface was pinned down.",
        groups: [
          {
            type: "added",
            items: [
              "A navigation section that turns speculation rules and view transitions on per site, with conservative and moderate levels.",
              "An explicit export map: the server, client, HTML and tag helpers each have a named entry point.",
              "A bilingual marketing example with download and changelog pages that read their version from the installed package.",
            ],
          },
          {
            type: "changed",
            items: [
              "Documentation covers the navigation section and deploying from a repository subdirectory.",
            ],
          },
          {
            type: "fixed",
            items: [
              "No more white flash between pages: the page background moved onto the root element, so it applies before the body paints.",
              "Reduced-motion preferences now switch off the decorative animations as well, not just page transitions.",
            ],
          },
        ],
      },
      {
        version: "0.1.0",
        date: "2026-08-24",
        status: "previous",
        summary:
          "The first public alpha. The full surface is in place: routing, rendering, islands, the HTML cache, the build pipeline and the dev tooling.",
        groups: [
          {
            type: "added",
            items: [
              "A safe-image helper that swaps failed images for a placeholder while preserving their dimensions.",
              "Health check and Docker recipes for production deployment.",
            ],
          },
          {
            type: "changed",
            items: [
              "Documentation now explains the reasoning behind each decision, not only its usage.",
              "The middleware order is documented as a contract at the top of the app factory.",
            ],
          },
          {
            type: "fixed",
            items: [
              "On Windows the dev server no longer restarts on neighbouring files, because watch events are filtered by modification time.",
            ],
          },
        ],
      },
      {
        version: "0.0.6",
        date: "2026-07-12",
        status: "previous",
        summary:
          "The cache grew up: stale-while-revalidate and prewarming landed together.",
        groups: [
          {
            type: "added",
            items: [
              "Stale-while-revalidate: an expired page ships immediately and refreshes in the background.",
              "Prewarming that renders a configurable list of paths at boot, with concurrency and interval settings.",
              "A cache status response header so hits, stale hits and misses can be measured without extra tooling.",
            ],
          },
          {
            type: "changed",
            items: [
              "Cache TTLs can now be declared centrally in the config and override a route's own value.",
            ],
          },
        ],
      },
      {
        version: "0.0.5",
        date: "2026-06-08",
        status: "previous",
        summary:
          "Hydration became a deliberate choice instead of a default.",
        groups: [
          {
            type: "added",
            items: [
              "Three hydration strategies: visibility-based by default, eager for global behaviour, idle for heavy extras.",
              "A mutation observer that hydrates islands added to the DOM after the initial render.",
              "createStore() for sharing small pieces of state between islands.",
            ],
          },
          {
            type: "fixed",
            items: [
              "Hidden elements now hydrate too: they have no layout box, so the observer would never report them.",
            ],
          },
        ],
      },
      {
        version: "0.0.4",
        date: "2026-05-04",
        status: "previous",
        summary:
          "The build pipeline learned to skip whatever is not installed.",
        groups: [
          {
            type: "added",
            items: [
              "A hashed asset manifest, with helpers that fall back to unhashed paths when it is missing.",
              "Optional build steps for Tailwind, the icon sprite, self-hosted fonts and image variants.",
              "Code splitting, so entries share common chunks instead of downloading them twice.",
            ],
          },
          {
            type: "changed",
            items: [
              "Optional peer dependencies are resolved from the application's own modules rather than the framework's.",
            ],
          },
        ],
      },
      {
        version: "0.0.3",
        date: "2026-03-22",
        status: "previous",
        summary:
          "Configuration and the dev experience caught up with the runtime.",
        groups: [
          {
            type: "added",
            items: [
              "Redirects, rewrites and header rules with a familiar path pattern syntax.",
              "A development overlay and a report page for inspecting routes, islands and cache entries.",
              "A dev gate that hides an unreleased site behind a token.",
            ],
          },
          {
            type: "changed",
            items: [
              "A broken config no longer stops the server: the failing section is ignored with a warning.",
            ],
          },
        ],
      },
    ],
  },

  download: {
    hero: {
      eyebrow: "Install",
      title: "From an empty folder to a running site.",
      lead: "The package is published on npm. Four commands and you are serving pages.",
      versionLabel: "Version",
      licenseLabel: "License",
      nodeLabel: "Requires",
      unmeasured:
        "The installed package could not be read, so the details below fall back to known defaults.",
    },
    steps: {
      eyebrow: "Four commands",
      title: "The whole setup",
      lead: "Each command is copyable. The scaffold gives you a route, a component and an island that already work together.",
      serveLabel: "5 · Serve in production",
      serveNote:
        "Serves the built output, warms the cache at boot and reports its status on every response.",
      items: [
        {
          label: "1 · Install the package",
          command: "install",
          note: "Pulls the framework and its four runtime dependencies from npm.",
        },
        {
          label: "2 · Scaffold the skeleton",
          command: "init",
          note: "Creates the directory layout, a first route, a component and an island.",
        },
        {
          label: "3 · Start developing",
          command: "dev",
          note: "Watches your files, rebuilds assets and serves the site with the dev overlay.",
        },
        {
          label: "4 · Build and serve",
          command: "build",
          note: "Produces hashed assets; the start command then serves the production site.",
        },
      ],
    },
    requirements: {
      eyebrow: "Requirements",
      title: "What you need",
      items: [
        {
          // İkon adları sözlükte: sprite taraması `icon: "..."` kalıbını
          // statik olarak arıyor, şablonda dizinden seçilen bir ad görünmez.
          icon: "HardDrives",
          title: "Node.js %s",
          body: "The runtime target is modern on purpose: no transpiling down to older engines.",
        },
        {
          icon: "Database",
          title: "No database",
          body: "Nothing is required to boot. Bring your own data source whenever you need one.",
        },
        {
          icon: "PuzzlePiece",
          title: "Optional extras",
          body: "Tailwind, the icon set and the image encoder are optional. Skip one and its build step skips itself.",
        },
      ],
    },
    dependencies: {
      eyebrow: "What comes with it",
      title: "Dependencies, in full",
      lead: "Runtime dependencies install with the package. Optional peers are only needed for the build steps you actually use.",
      runtimeTitle: "Runtime",
      optionalTitle: "Optional",
      nameColumn: "Package",
      versionColumn: "Range",
    },
    next: {
      eyebrow: "Next",
      title: "Where to go from here",
      body: "The getting-started chapter walks through the same steps with explanations, and the changelog tells you what landed in this version.",
      primary: "Read the docs",
      secondary: "See the changelog",
    },
  },

  notFound: {
    title: "Page not found",
    code: "404",
    heading: "That piece isn't in the skeleton.",
    body: "The path you asked for is not in the route table. Head back home and pick the flow up again.",
    primary: "Home",
    secondary: "Documentation",
  },
};
