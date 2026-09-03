/**
 * Tailwind v4 → global `app.css` + isteğe bağlı sayfa stylesheet'leri.
 *
 * Global sheet her sayfada yüklenir (`paths.styles`). Sayfa sheet'leri
 * `styles/pages/*.css` altındadır ve yalnızca controller `styles: ["home.css"]`
 * bildiren sayfalarda basılır — island `entries` ile aynı sözleşme.
 *
 * Ayrı bir "critical CSS" üretilmez. Ölçümde inline kritik CSS ilk ekranı tam
 * kapsamadığı için sheet gelince sayfa yeniden akıyordu (bir liste sayfasında
 * CLS 0.307) ve aynı ~27 KB her HTML yanıtında tekrar ediyordu. Sıkıştırılmış
 * global sheet'i render-blocking bırakmak hem daha hızlı hem CLS'siz; ikinci
 * ziyarette zaten immutable önbellekten geliyor. Sayfa sheet'leri de
 * render-blocking; yalnızca ilgili sayfada ek maliyet.
 *
 * Tailwind utility'leri global sheet'te kalmalı. Sayfa CSS'inde tam
 * `@import "tailwindcss"` utility çıktısını tekrarlar; sayfaya özel kurallar
 * yeter.
 *
 * Tailwind'in sınıf taraması `globals.css` içindeki `@source` direktiflerine
 * bağlıdır. Otomatik tespit yalnızca stylesheet'in bulunduğu dizini tarar,
 * bu yüzden şablonlarda geçen varyantlar (`data-[active=false]:…`) sessizce
 * düşer. Yeni bir üst dizin eklediğinizde `@source` satırını da ekleyin.
 */
import fs from "node:fs";
import path from "node:path";
import { paths, writeAsset, writeManifest } from "../paths.mjs";
import { importFromApp, tryImportFromApp } from "../resolve-peer.mjs";
import * as log from "../../log.mjs";

/**
 * PostCSS boru hattı bir kez kurulur: Tailwind'in kendi önbelleği plugin-++
 * örneğinde yaşıyor, her derlemede yeniden oluşturmak watch turlarını
 * belirgin şekilde yavaşlatıyor.
 *
 * @param {string} root
 * @returns {Promise<(inputPath: string) => Promise<string>>}
 */
async function createCompiler(root) {
  const [{ default: postcss }, { default: tailwindcss }] = await Promise.all([
    importFromApp(root, "postcss"),
    importFromApp(root, "@tailwindcss/postcss"),
  ]);

  // lightningcss opsiyonel: yoksa Tailwind'in kendi çıktısı kullanılır,
  // yalnızca birkaç kB daha büyük olur.
  const lightning = await tryImportFromApp(root, "lightningcss");
  const processor = postcss([tailwindcss()]);

  return async (inputPath) => {
    const css = fs.readFileSync(inputPath, "utf8");
    const result = await processor.process(css, { from: inputPath, to: inputPath });

    if (!lightning) return result.css;

    const minified = lightning.transform({
      filename: path.basename(inputPath),
      code: Buffer.from(result.css),
      minify: true,
    });

    return minified.code.toString("utf8");
  };
}

/**
 * `paths.styles` dosyasının yanında `pages/` — config'te ayrı alan yok.
 *
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @returns {string}
 */
function pageStylesDir(config) {
  return path.join(path.dirname(config.dirs.styles), "pages");
}

/**
 * @param {string} dir
 * @returns {string[]} Mutlak yollar, dosya adına göre sıralı.
 */
function listPageStyles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".css"))
    .sort()
    .map((name) => path.join(dir, name));
}

/**
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @param {{ watch?: boolean }} [options]
 * @returns {Promise<Record<string, string>>}
 */
export async function buildCss(config, { watch = false } = {}) {
  const input = config.dirs.styles;
  const pagesDir = pageStylesDir(config);
  const compile = await createCompiler(config.root);

  const run = async () => {
    const started = Date.now();
    /** @type {Record<string, string>} */
    const urls = {};
    let bytes = 0;

    const appCss = await compile(input);
    const appUrl = writeAsset("app.css", appCss);
    urls["app.css"] = appUrl;
    bytes += Buffer.byteLength(appCss);

    /** @type {string[]} */
    const keep = [path.basename(appUrl)];

    for (const file of listPageStyles(pagesDir)) {
      const name = path.basename(file);
      const css = await compile(file);
      const url = writeAsset(name, css);
      urls[name] = url;
      bytes += Buffer.byteLength(css);
      keep.push(path.basename(url));
    }

    // Önce yaz, sonra eski hash'leri sil — aynı hash'e düşen içerikte 404
    // penceresi olmasın (CDN immutable zehirlenmesi). Silinen sayfa sheet'leri
    // de burada gider; önek listesi tutmaya gerek yok.
    pruneCssOutputs(keep);

    return { urls, bytes, elapsed: Date.now() - started };
  };

  const first = await run();
  const pageCount = Object.keys(first.urls).length - 1;
  log.detail(
    pageCount > 0
      ? `${log.size(first.bytes)}, ${pageCount} page ${pageCount === 1 ? "sheet" : "sheets"}`
      : log.size(first.bytes),
  );

  if (watch) {
    watchCssSources(config, async () => {
      try {
        const result = await run();
        // Yeni hash manifest'e yazılmazsa HTML silinmiş dosyayı ister.
        // Silinen sayfa sheet anahtarları da düşsün.
        syncCssManifest(result.urls);
        log.event({
          scope: "css",
          message: "rebuilt",
          note: log.size(result.bytes),
          time: result.elapsed,
        });
      } catch (error) {
        log.event({
          symbol: log.symbols.fail,
          scope: "css",
          message: "failed",
          note: error.message,
        });
      }
    });
  }

  return first.urls;
}

/**
 * `public/assets/` kökündeki stylesheet çıktıları. `js/` ve `img/` altındakilere
 * dokunulmaz.
 *
 * @param {string[]} keep Yeni yazılan dosya adları (`app.<hash>.css`, …)
 */
function pruneCssOutputs(keep) {
  if (!fs.existsSync(paths.assets)) return;

  for (const file of fs.readdirSync(paths.assets)) {
    if (!/\.css(?:\.(?:br|gz))?$/i.test(file)) continue;
    if (keep.some((name) => file === name || file.startsWith(`${name}.`))) {
      continue;
    }
    fs.rmSync(path.join(paths.assets, file), { force: true });
  }
}

/**
 * Watch turunda CSS anahtarlarını toplu günceller; artık üretilmeyen sayfa
 * sheet'lerini manifest'ten siler.
 *
 * @param {Record<string, string>} urls
 */
function syncCssManifest(urls) {
  const file = path.join(paths.generated, "manifest.json");
  /** @type {Record<string, string>} */
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // İlk yazımda oluşur.
  }

  /** @type {Record<string, string>} */
  const next = {};
  for (const [key, value] of Object.entries(current)) {
    if (key.endsWith(".css") && !(key in urls)) continue;
    next[key] = value;
  }
  for (const [key, url] of Object.entries(urls)) {
    next[key] = url;
  }

  if (JSON.stringify(current) === JSON.stringify(next)) return;
  writeManifest(next);
}

/**
 * Şablon ve island dosyaları da izlenir: Tailwind sınıfları oradan geliyor,
 * yalnızca `styles/` izlemek yeni bir utility yazıldığında rebuild etmez.
 * `styles/pages` zaten `dirname(styles)` altında.
 *
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @param {() => void} onChange
 */
function watchCssSources(config, onChange) {
  const targets = [
    path.dirname(config.dirs.styles),
    config.dirs.views,
    config.dirs.client,
  ];

  let timer = null;
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    fs.watch(target, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 120);
    });
  }
}
