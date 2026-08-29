/**
 * Tailwind v4 → tek statik stylesheet.
 *
 * Ayrı bir "critical CSS" üretilmez. Ölçümde inline kritik CSS ilk ekranı tam
 * kapsamadığı için sheet gelince sayfa yeniden akıyordu (bir liste sayfasında
 * CLS 0.307) ve aynı ~27 KB her HTML yanıtında tekrar ediyordu. Sıkıştırılmış
 * tek sheet'i render-blocking bırakmak hem daha hızlı hem CLS'siz; ikinci
 * ziyarette zaten immutable önbellekten geliyor.
 *
 * Tailwind'in sınıf taraması `globals.css` içindeki `@source` direktiflerine
 * bağlıdır. Otomatik tespit yalnızca stylesheet'in bulunduğu dizini tarar,
 * bu yüzden şablonlarda geçen varyantlar (`data-[active=false]:…`) sessizce
 * düşer. Yeni bir üst dizin eklediğinizde `@source` satırını da ekleyin.
 */
import fs from "node:fs";
import path from "node:path";
import { patchManifest, pruneAssets, writeAsset } from "../paths.mjs";
import { importFromApp, tryImportFromApp } from "../resolve-peer.mjs";
import * as log from "../../log.mjs";

/**
 * PostCSS boru hattı bir kez kurulur: Tailwind'in kendi önbelleği plugin
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
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @param {{ watch?: boolean }} [options]
 * @returns {Promise<Record<string, string>>}
 */
export async function buildCss(config, { watch = false } = {}) {
  const input = config.dirs.styles;
  const compile = await createCompiler(config.root);

  const run = async () => {
    const started = Date.now();
    pruneAssets(["app."]);
    const css = await compile(input);
    const url = writeAsset("app.css", css);
    return { url, bytes: Buffer.byteLength(css), elapsed: Date.now() - started };
  };

  const first = await run();
  log.detail(log.size(first.bytes));

  if (watch) {
    watchCssSources(config, async () => {
      try {
        const result = await run();
        // Yeni hash manifest'e yazılmazsa HTML silinmiş dosyayı ister.
        patchManifest("app.css", result.url);
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

  return { "app.css": first.url };
}

/**
 * Şablon ve island dosyaları da izlenir: Tailwind sınıfları oradan geliyor,
 * yalnızca `styles/` izlemek yeni bir utility yazıldığında rebuild etmez.
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
