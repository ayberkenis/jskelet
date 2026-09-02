/**
 * `jskelet init` — bulunduğun dizine çalışan bir minimum iskelet kurar.
 *
 * Var olan dosyaların üzerine yazmaz: komutu ikinci kez çalıştırmak yalnızca
 * eksikleri tamamlar. Amaç, "kurulum yaptım ama hiçbir şey çalışmıyor"
 * aşamasını tamamen atlamak — `jskelet dev` hemen ardından çalışır.
 */
import fs from "node:fs";
import path from "node:path";
import * as log from "./log.mjs";

/** @type {Record<string, string>} */
const FILES = {
  "jskelet.config.mjs": `/**
 * JSkelet configuration. Every field is optional; the app still runs on
 * defaults if you delete this file.
 *
 * Details: node_modules/jskelet/docs/en/07-configuration.md
 */
export default {
  brand: { lang: "en" },

  /** Third-party origins; emitted as preconnect in \`<head>\`. */
  preconnect: [],

  async cache() {
    return {
      /** How long a page's HTML stays in the cache (seconds). */
      html: { "/": 60 },
    };
  },

  hooks: {
    /** Metadata defaults for every page. */
    metadata() {
      return {
        titleTemplate: "%s | JSkelet",
        description: "A site built with JSkelet.",
      };
    },

    /** Locals added to the layout on every render. */
    layoutContext() {
      return { bodyClass: "min-h-full" };
    },

    /** 404 page. */
    notFound() {
      return {
        view: "pages/not-found",
        metadata: { title: "Page not found", robots: { index: false } },
      };
    },
  },
};
`,

  "routes/10-pages.mjs": `/**
 * Route module. The default export receives \`(app, api)\`; \`api.route()\` wraps
 * the controller with the HTML cache, the notFound/redirect flow and
 * compression.
 *
 * The numeric prefix in the file name sets load order: catch-all routes
 * (like "/:slug") belong to a higher number.
 */
export default function register(app, { route }) {
  app.get(
    "/",
    route(
      async () => ({
        view: "pages/home",
        metadata: { title: "Home" },
        data: { message: "JSkelet is running." },
      }),
      { revalidate: 60 },
    ),
  );
}
`,

  "views/pages/home.jsk": `<section class="wrapper">
  <h1>{{ metadata.title }}</h1>
  <p>{{ message }}</p>
  <div data-island="counter" data-island-props='{"start":0}'></div>
</section>
`,

  "views/pages/not-found.jsk": `<section class="wrapper">
  <h1>404</h1>
  <p>The page you are looking for was not found.</p>
  <p><Link href="/" text="Back to home" /></p>
</section>
`,

  "views/components/button.js": `import { attrs, esc } from "jskelet/html";

/**
 * Every named export under \`views/components/**\` is usable directly in
 * templates: \`<Button text="Save" />\` in \`.jsk\` or \`<%- button({ text }) %>\` in EJS.
 *
 * @param {{ text: string, href?: string, class?: string }} props
 * @returns {string}
 */
export function button({ text, href, class: className }) {
  const tag = href ? "a" : "button";
  return \`<\${tag}\${attrs({ href, class: className })}>\${esc(text)}</\${tag}>\`;
}
`,

  "client/entries/main.js": `import { registerAll, start } from "jskelet/client";

/**
 * Island registry. Values are dynamic imports: a module is downloaded only if
 * that island is actually on the page and becomes visible.
 */
registerAll({
  counter: () => import("../islands/counter.js"),
});

start();
`,

  "client/islands/counter.js": `/**
 * Island contract: a named export called \`mount(element, props)\`.
 * The returned function, if any, is reserved for cleanup.
 *
 * @param {HTMLElement} element
 * @param {{ start?: number }} props
 */
export function mount(element, props) {
  let value = props.start ?? 0;

  const button = document.createElement("button");
  button.type = "button";

  const paint = () => {
    button.textContent = \`Clicks: \${value}\`;
  };

  button.addEventListener("click", () => {
    value += 1;
    paint();
  });

  paint();
  element.append(button);
}
`,

  "styles/globals.css": `@import "tailwindcss" source(none);

/**
 * Tailwind's class scanning depends on these directives. Automatic detection
 * only scans the directory holding this file; variants used in templates
 * (like data-[active=false]:…) would otherwise be dropped silently.
 */
@source "../views";
@source "../client";
@source "../routes";
@source "../features";
@source "../shared";

body {
  margin: 0;
  font-family: system-ui, sans-serif;
}

.wrapper {
  max-width: 64rem;
  margin-inline: auto;
  padding: 2rem 1rem;
}
`,

  "jsconfig.json": `{
  "compilerOptions": {
    "checkJs": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2022",
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "exclude": ["node_modules", "public/assets"]
}
`,

  ".gitignore": `node_modules/
.jskelet/
public/assets/
.env
`,
};

/**
 * @param {string} root
 * @returns {Promise<void>}
 */
export async function init(root) {
  log.section("init");

  const created = [];
  const skipped = [];

  for (const [relative, contents] of Object.entries(FILES)) {
    const target = path.join(root, relative);

    if (fs.existsSync(target)) {
      skipped.push(relative);
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    created.push(relative);
  }

  for (const file of created) log.line(`+ ${file}`);
  if (skipped.length) log.warn(`${skipped.length} files already existed, skipped`);

  log.line("");
  log.line("next step:  npx jskelet dev");
}
