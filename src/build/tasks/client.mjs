/**
 * Island bundle'ı: esbuild, ESM, code splitting.
 *
 * `client/entries/*.{js,ts,mts}` içindeki her dosya bir entry'dir. `main.js`
 * (veya `main.ts`) her sayfada yüklenen ortak island bootstrap'ıdır; ek
 * entry'ler yalnızca onları isteyen sayfalarda
 * (`controller` → `entries: ["chart.js"]`) yüklenir. Manifest anahtarı her
 * zaman `*.js` kalır.
 *
 * Hedef tarayıcılar `package.json` → `browserslist` yerine burada sabit: ESM +
 * dinamik import + `IntersectionObserver` island modelinin zaten alt sınırı,
 * daha eskisine transpile etmek çıktıyı büyütüp hiçbir ziyaretçi kazandırmıyor.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as esbuild from "esbuild";
import { chunkGroupsPlugin } from "../chunk-groups.mjs";
import { paths, patchManifest, pruneAssets } from "../paths.mjs";
import * as log from "../../log.mjs";

/** Client entry ve `@/` alias için kabul edilen kaynak uzantıları. `.tsx` yok. */
const CLIENT_SOURCE_EXTS = [".js", ".ts", ".mts"];

/**
 * `@/` alias'ını proje köküne çözer — Node tarafındaki `alias-hooks.mjs` ile
 * aynı davranış, böylece `lib/` altındaki modüller hem sunucuda hem
 * tarayıcıda aynı import stilini kullanabilir.
 *
 * Not: sunucu runtime `.ts` çözmez; paylaşılan `@/lib` dosyaları `.js`
 * kalmalıdır. `.ts` yalnızca esbuild client hattında anlamlıdır.
 *
 * @param {string} root
 * @returns {esbuild.Plugin}
 */
function aliasPlugin(root) {
  return {
    name: "jskelet-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => ({
        path: resolveWithExtension(path.join(root, args.path.slice(2))),
      }));
    },
  };
}

/**
 * Secret benzeri isimler public bundle'a gömülmemeli. `PUBLIC` / `PUBLISHABLE`
 * içerenler (örn. Stripe publishable key) muaf; diğer `SECRET`, `PASSWORD`,
 * `TOKEN`, `API_KEY`, `PRIVATE` vb. reddedilir.
 */
const SECRETISH_CLIENT_ENV =
  /(?:^|_)(SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|CREDENTIAL|API[_-]?KEY)(?:_|$)|(?:^|_)(SECRET|PASSWORD|TOKEN|PRIVATE|KEY)$/i;

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isSecretLikeClientEnvKey(key) {
  if (/PUBLIC|PUBLISHABLE/i.test(key)) return false;
  return SECRETISH_CLIENT_ENV.test(key);
}

/**
 * Tarayıcıda `process` yoktur; sunucuyla paylaşılan modüller yine de
 * `process.env` okur. `clientEnv` ile bildirilen anahtarlar build zamanında
 * gömülür — Next'teki `NEXT_PUBLIC_*` ile aynı sözleşme, ama hangi anahtarın
 * herkese açık olduğu isimden değil config'ten belli.
 *
 * `process.env`in tamamı tek nesne olarak define edilir: listede olmayan bir
 * anahtar okunduğunda çökme yerine `undefined` döner.
 *
 * @param {string[]} keys
 * @returns {Record<string, string>}
 */
function publicEnv(keys) {
  const secretish = keys.filter((key) => isSecretLikeClientEnvKey(key));
  if (secretish.length) {
    throw new Error(
      `[build] clientEnv must not include secret-like keys: ${secretish.join(", ")}. ` +
        "Only values safe to publish in the browser bundle belong here.",
    );
  }

  /** @type {Record<string, string>} */
  const env = { NODE_ENV: process.env.NODE_ENV ?? "production" };
  for (const key of keys) {
    const value = process.env[key];
    if (value != null) env[key] = value;
  }
  return env;
}

/**
 * @param {string} base
 * @returns {string}
 */
export function resolveWithExtension(base) {
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.ts`,
    `${base}.mts`,
    `${base}.json`,
    path.join(base, "index.js"),
    path.join(base, "index.ts"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return base;
}

/**
 * Entry dosya adını manifest anahtarına çevirir (`main.ts` → `main.js`).
 * Layout / `entries: ["chart.js"]` sözleşmesi hash'siz `.js` anahtarları bekler.
 *
 * @param {string} entryPath
 * @returns {string}
 */
export function entryManifestName(entryPath) {
  const base = path.basename(entryPath);
  const ext = path.extname(base);
  const stem = CLIENT_SOURCE_EXTS.includes(ext)
    ? base.slice(0, -ext.length)
    : path.basename(base, ".js");
  return `${stem}.js`;
}

/**
 * `client/entries/` altındaki kaynakları listeler. Aynı stem için birden fazla
 * uzantı (`main.js` + `main.ts`) sessiz tercih yerine hata verir.
 *
 * @param {string} entryDir
 * @returns {string[]}
 */
export function listClientEntries(entryDir) {
  /** @type {Map<string, string>} */
  const byStem = new Map();

  for (const file of fs.readdirSync(entryDir)) {
    const ext = path.extname(file);
    if (!CLIENT_SOURCE_EXTS.includes(ext)) continue;

    const stem = file.slice(0, -ext.length);
    const previous = byStem.get(stem);
    if (previous) {
      throw new Error(
        `[build] conflicting client entries for "${stem}": ${previous} and ${file}. ` +
          "Keep a single extension per entry name.",
      );
    }
    byStem.set(stem, file);
  }

  return [...byStem.values()]
    .sort()
    .map((file) => path.join(entryDir, file));
}

/**
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @param {{ watch?: boolean }} [options]
 * @returns {Promise<Record<string, string>>}
 */
export async function buildClient(config, { watch = false } = {}) {
  const entryDir = path.join(config.dirs.client, "entries");
  const outDir = path.join(paths.assets, "js");

  // Entry'siz turda erken dönülüyor; eski harita silinmiş chunk'ları göstermesin.
  fs.rmSync(path.join(paths.generated, "preload.json"), { force: true });

  if (!fs.existsSync(entryDir)) {
    log.detail("no entries, skipped");
    return {};
  }

  const entryPoints = listClientEntries(entryDir);

  if (!entryPoints.length) {
    log.detail("no entries, skipped");
    return {};
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  pruneAssets(["js/"]);

  const entryRoot = path
    .relative(config.root, entryDir)
    .split(path.sep)
    .join("/");

  const clientBuild = config.build?.client ?? {
    splitting: true,
    groups: {},
    chunkGroup: null,
  };
  const splitting = clientBuild.splitting !== false;
  const groups = splitting ? (clientBuild.groups ?? {}) : {};
  const chunkGroup = splitting ? (clientBuild.chunkGroup ?? null) : null;

  const groupPlugin = splitting
    ? chunkGroupsPlugin({
        root: config.root,
        groups,
        chunkGroup,
      })
    : null;

  /** @type {esbuild.Plugin[]} */
  const plugins = [aliasPlugin(config.root)];
  if (groupPlugin) plugins.push(groupPlugin);

  /** @type {esbuild.BuildOptions} */
  const options = {
    entryPoints,
    outdir: outDir,
    absWorkingDir: config.root,
    bundle: true,
    splitting,
    format: "esm",
    target: ["chrome111", "edge111", "firefox111", "safari16.4"],
    minify: true,
    // Prod'da map dosyaları `public/assets` altında herkese açık kalırdı.
    sourcemap: process.env.NODE_ENV === "development",
    metafile: true,
    entryNames: "[name].[hash]",
    chunkNames: "chunks/[name].[hash]",
    legalComments: "none",
    plugins,
    define: {
      "process.env": JSON.stringify(publicEnv(config.clientEnv)),
    },
    // Grup sarmalayıcısı her üyede `export { default }` yazar; named-only
    // modüllerde bu uyarı gürültü — davranış yine doğru (default undefined).
    ...(groupPlugin
      ? { logOverride: { "import-is-undefined": "silent" } }
      : {}),
  };

  if (watch) {
    const context = await esbuild.context({
      ...options,
      plugins: [...options.plugins, rebuildReporter(config, entryRoot)],
    });
    const result = await context.rebuild();
    await context.watch();
    writeMetafile(result.metafile, config);
    const manifest = toManifest(result.metafile, config, entryRoot);
    log.detail(summarizeClientBuild(manifest, result.metafile));
    return manifest;
  }

  const result = await esbuild.build(options);
  writeMetafile(result.metafile, config);
  const manifest = toManifest(result.metafile, config, entryRoot);
  const bytes = Object.values(result.metafile.outputs).reduce(
    (sum, output) => sum + output.bytes,
    0,
  );
  log.detail(
    `${summarizeClientBuild(manifest, result.metafile)}, ${log.size(bytes)}`,
  );
  return manifest;
}

/**
 * Entry + inject edilen group entry'ler metafile'da durur; teşhis için
 * hem gerçek manifest entry sayısını hem toplam çıktı dosyasını yaz.
 *
 * @param {Record<string, string>} manifest
 * @param {esbuild.Metafile} [metafile]
 * @returns {string}
 */
function summarizeClientBuild(manifest, metafile) {
  const entries = Object.keys(manifest).length;
  const entryLabel = `${entries} ${entries === 1 ? "entry" : "entries"}`;
  if (!metafile) return entryLabel;

  const outputs = Object.keys(metafile.outputs).filter(
    (file) => file.endsWith(".js") || file.endsWith(".mjs"),
  );
  const chunks = outputs.length;
  return `${entryLabel}, ${chunks} ${chunks === 1 ? "file" : "files"}`;
}

/**
 * Metafile diske yazılır: dev panelindeki chunk analizi giriş/çıkış
 * kırılımını buradan okur. Çalışma zamanı bu dosyaya bağımlı değildir;
 * `modulePreload()` için gereken kısım ayrıca `preload.json` olarak yazılır.
 *
 * @param {esbuild.Metafile} [metafile]
 * @param {import('../../config/index.js').ResolvedConfig} config
 */
function writeMetafile(metafile, config) {
  if (!metafile) return;
  try {
    fs.mkdirSync(paths.generated, { recursive: true });
    fs.writeFileSync(
      path.join(paths.generated, "metafile.json"),
      JSON.stringify(metafile),
    );
  } catch {
    // Analiz verisi en iyi çaba; build'i düşürmez.
  }

  try {
    fs.writeFileSync(
      path.join(paths.generated, "preload.json"),
      `${JSON.stringify(toPreloadMap(metafile, config.root, config.dirs.public))}\n`,
    );
  } catch {
    // Harita yoksa `modulePreload()` hiçbir şey basmaz; sayfa yine çalışır.
  }
}

/**
 * esbuild metafile → `{ "client/bundles/chrome.js": ["/assets/js/chunks/chrome.X.js", …] }`
 *
 * Anahtar kaynak yolu (`absWorkingDir`'e göre), değer o modülün chunk'ı ve
 * **static** import kapanışı; ilk eleman modülün kendisi. Runtime'ın metafile
 * grafiğini gezmemesi için kapanış burada hesaplanır. Dinamik import'lar
 * listeye girmez: onları preload etmek, tembel yüklemenin amacını bozar.
 *
 * Entry'ler de (`client/entries/main.js`) anahtar olur; dinamik import edilen
 * her modül esbuild'de kendi `entryPoint`'ini taşıdığı için ayrı bir kayıt
 * gerekmez. Chunk grubu barrel'ları gibi sanal namespace'ler atlanır.
 *
 * Bu haritanın HTML'e gömdüğü chunk URL'leri değişince entry hash'i de
 * değişir (esbuild hash'i import edilen chunk adlarını içerir), yani
 * `buildId` ve HTML cache isim alanı kendiliğinden yenilenir.
 *
 * @param {esbuild.Metafile} metafile
 * @param {string} root Proje kökü (`absWorkingDir`).
 * @param {string} publicDir
 * @returns {Record<string, string[]>}
 */
export function toPreloadMap(metafile, root, publicDir) {
  const toUrl = (/** @type {string} */ outputPath) =>
    `/${path
      .relative(publicDir, path.resolve(root, outputPath))
      .split(path.sep)
      .join("/")}`;

  /** @type {Record<string, string[]>} */
  const map = {};

  for (const [outputPath, output] of Object.entries(metafile.outputs)) {
    const source = output.entryPoint;
    if (!source || !/\.m?js$/.test(outputPath)) continue;
    if (/^[a-z][\w-]*:/i.test(source)) continue;

    /** @type {string[]} */
    const order = [];
    const seen = new Set([outputPath]);
    const queue = [outputPath];
    while (queue.length) {
      const current = /** @type {string} */ (queue.shift());
      order.push(toUrl(current));
      for (const dependency of metafile.outputs[current]?.imports ?? []) {
        if (dependency.kind !== "import-statement" || dependency.external) continue;
        if (seen.has(dependency.path)) continue;
        seen.add(dependency.path);
        queue.push(dependency.path);
      }
    }

    map[source.split(path.sep).join("/")] = order;
  }

  return map;
}

/**
 * Watch turlarını canlı olarak bildirir; ilk build zaten adım satırında görünür.
 *
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @param {string} entryRoot
 * @returns {esbuild.Plugin}
 */
function rebuildReporter(config, entryRoot) {
  // İlk `rebuild()` ve `watch()`'un kendi açılış turu adım satırında zaten
  // görünüyor; canlı bildirim gerçek değişikliklerle başlar.
  let skip = 2;
  let started = 0;

  return {
    name: "jskelet-rebuild-log",
    setup(build) {
      build.onStart(() => {
        started = Date.now();
      });

      build.onEnd((result) => {
        if (result.metafile) {
          writeMetafile(result.metafile, config);
          // Entry adları hash'li: yeni hash manifest'e yazılmazsa HTML eski
          // (artık var olmayan) bundle'ı ister ve island'ların hiçbiri açılmaz.
          for (const [key, url] of Object.entries(
            toManifest(result.metafile, config, entryRoot),
          )) {
            patchManifest(key, url);
          }
        }

        if (skip > 0) {
          skip -= 1;
          return;
        }

        if (result.errors.length) {
          const [first] = result.errors;
          log.errorBox({
            title: "Client Build Error",
            name: "BuildError",
            message: first.text,
            lines: [
              first.location
                ? `${first.location.file}:${first.location.line}:${first.location.column}`
                : "",
              result.errors.length > 1
                ? `+${result.errors.length - 1} more errors`
                : "",
            ].filter(Boolean),
          });
          return;
        }

        log.event({
          scope: "client",
          message: "rebuilt",
          time: Date.now() - started,
        });
      });
    },
  };
}

/**
 * esbuild metafile → { "main.js": "/assets/js/main.abc.js" }
 *
 * Dinamik import'lar da `entryPoint` taşır; yalnızca gerçek entry'ler
 * manifest'e girer, yoksa her island ayrı bir manifest anahtarı olurdu.
 *
 * @param {esbuild.Metafile} metafile
 * @param {import('../../config/index.js').ResolvedConfig} config
 * @param {string} entryRoot
 * @returns {Record<string, string>}
 */
function toManifest(metafile, config, entryRoot) {
  /** @type {Record<string, string>} */
  const manifest = {};

  for (const [outputPath, output] of Object.entries(metafile.outputs)) {
    if (!output.entryPoint?.startsWith(entryRoot)) continue;

    const name = entryManifestName(output.entryPoint);
    const absolute = path.resolve(config.root, outputPath);
    manifest[name] = `/${path
      .relative(config.dirs.public, absolute)
      .split(path.sep)
      .join("/")}`;
  }

  return manifest;
}
