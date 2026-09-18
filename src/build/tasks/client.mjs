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

  /** @type {esbuild.BuildOptions} */
  const options = {
    entryPoints,
    outdir: outDir,
    absWorkingDir: config.root,
    bundle: true,
    splitting: true,
    format: "esm",
    target: ["chrome111", "edge111", "firefox111", "safari16.4"],
    minify: true,
    // Prod'da map dosyaları `public/assets` altında herkese açık kalırdı.
    sourcemap: process.env.NODE_ENV === "development",
    metafile: true,
    entryNames: "[name].[hash]",
    chunkNames: "chunks/[name].[hash]",
    legalComments: "none",
    plugins: [aliasPlugin(config.root)],
    define: {
      "process.env": JSON.stringify(publicEnv(config.clientEnv)),
    },
  };

  if (watch) {
    const context = await esbuild.context({
      ...options,
      plugins: [...options.plugins, rebuildReporter(config, entryRoot)],
    });
    const result = await context.rebuild();
    await context.watch();
    writeMetafile(result.metafile);
    const manifest = toManifest(result.metafile, config, entryRoot);
    const entries = Object.keys(manifest).length;
    log.detail(`${entries} ${entries === 1 ? "entry" : "entries"}`);
    return manifest;
  }

  const result = await esbuild.build(options);
  writeMetafile(result.metafile);
  const manifest = toManifest(result.metafile, config, entryRoot);
  const bytes = Object.values(result.metafile.outputs).reduce(
    (sum, output) => sum + output.bytes,
    0,
  );
  const entries = Object.keys(manifest).length;
  log.detail(`${entries} ${entries === 1 ? "entry" : "entries"}, ${log.size(bytes)}`);
  return manifest;
}

/**
 * Metafile diske yazılır: dev panelindeki chunk analizi giriş/çıkış
 * kırılımını buradan okur. Çalışma zamanı bu dosyaya bağımlı değildir.
 *
 * @param {esbuild.Metafile} [metafile]
 */
function writeMetafile(metafile) {
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
          writeMetafile(result.metafile);
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
