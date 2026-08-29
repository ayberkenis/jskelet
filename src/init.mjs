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
 * JSkelet yapılandırması. Tüm alanlar opsiyoneldir; bu dosyayı silseniz de
 * uygulama varsayılanlarla çalışır.
 *
 * Ayrıntılar: node_modules/jskelet/docs/07-yapilandirma.md
 */
export default {
  brand: { lang: "tr" },

  /** Üçüncü taraf kaynaklar; \`<head>\`e preconnect olarak basılır. */
  preconnect: [],

  async cache() {
    return {
      /** Sayfa HTML'inin önbellekte kalma süresi (saniye). */
      html: { "/": 60 },
    };
  },

  hooks: {
    /** Her sayfanın metadata varsayılanı. */
    metadata() {
      return {
        titleTemplate: "%s | JSkelet",
        description: "JSkelet ile kurulmuş bir site.",
      };
    },

    /** Layout'a her render'da eklenen local'ler. */
    layoutContext() {
      return { bodyClass: "min-h-full" };
    },

    /** 404 sayfası. */
    notFound() {
      return {
        view: "pages/not-found",
        metadata: { title: "Sayfa bulunamadı", robots: { index: false } },
      };
    },
  },
};
`,

  "routes/10-pages.mjs": `/**
 * Route modülü. Default export \`(app, api)\` alır; \`api.route()\` controller'ı
 * HTML cache'i, notFound/redirect akışı ve sıkıştırmayla sarar.
 *
 * Dosya adındaki sayısal önek yükleme sırasını belirler: yakalayıcı
 * ("/:slug" gibi) route'lar daha yüksek numarada olmalı.
 */
export default function register(app, { route }) {
  app.get(
    "/",
    route(
      async () => ({
        view: "pages/home",
        metadata: { title: "Ana sayfa" },
        data: { message: "JSkelet çalışıyor." },
      }),
      { revalidate: 60 },
    ),
  );
}
`,

  "views/pages/home.ejs": `<section class="wrapper">
  <h1><%= metadata.title %></h1>
  <p><%= message %></p>
  <div data-island="counter" data-island-props='{"start":0}'></div>
</section>
`,

  "views/pages/not-found.ejs": `<section class="wrapper">
  <h1>404</h1>
  <p>Aradığınız sayfa bulunamadı.</p>
  <p><a href="/">Ana sayfaya dön</a></p>
</section>
`,

  "views/components/button.js": `import { attrs, esc } from "jskelet/html";

/**
 * \`views/components/**\` altındaki her named export şablonlarda doğrudan
 * kullanılabilir: \`<%- button({ text: "Kaydet" }) %>\`. Import gerekmez.
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
 * Island kaydı. Değerler dinamik import: modül yalnızca sayfada o island
 * gerçekten varsa ve görünür olduğunda indirilir.
 */
registerAll({
  counter: () => import("../islands/counter.js"),
});

start();
`,

  "client/islands/counter.js": `/**
 * Island sözleşmesi: \`mount(element, props)\` adlı named export.
 * Dönen fonksiyon (varsa) temizlik için ayrılmıştır.
 *
 * @param {HTMLElement} element
 * @param {{ start?: number }} props
 */
export function mount(element, props) {
  let value = props.start ?? 0;

  const button = document.createElement("button");
  button.type = "button";

  const paint = () => {
    button.textContent = \`Tıklama: \${value}\`;
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
 * Tailwind'in sınıf taraması bu direktiflere bağlıdır. Otomatik tespit
 * yalnızca bu dosyanın bulunduğu dizini tarar; şablonlarda geçen varyantlar
 * (data-[active=false]:… gibi) aksi hâlde sessizce düşer.
 */
@source "../views";
@source "../client";
@source "../routes";

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
  if (skipped.length) log.warn(`${skipped.length} dosya zaten vardı, atlandı`);

  log.line("");
  log.line("sıradaki adım:  npx jskelet dev");
}
