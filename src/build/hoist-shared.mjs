/**
 * `build.client.hoistShared`: ortak modülleri ayrı chunk yerine çatı entry'sine
 * (`main.js`) toplar.
 *
 * esbuild bir modülü, ona erişen entry kümesine göre chunk'a koyar. Dinamik
 * import edilen her island ayrı bir entry sayıldığı için `main.js`'in de
 * kullandığı bir yardımcı, `main` + island kombinasyonu başına küçük bir
 * paylaşılan chunk'a düşer; esbuild island'ın her zaman `main`'den sonra
 * yüklendiğini bilemez. Gruplama (`groups`) bunu yalnızca elle tutulan
 * listelerle çözebiliyor.
 *
 * Burada island'ların ortak modüle grafik üzerinden ulaşması kesilir:
 *
 * 1. Bir analiz turu (yazmadan) import grafiğini çıkarır.
 * 2. Çatının static kapanışı ile `minImporters` kadar kökün (entry veya
 *    dinamik import hedefi) kullandığı modüller "hoisted" kümesidir.
 * 3. İkinci tur, proxy'lenecek modülleri external işaretleyip island'ların
 *    onlardan **hangi adları** kullandığını esbuild çıktısından okur.
 * 4. Çatı entry'sinin sonuna sanal bir register modülü eklenir; bu modül
 *    yalnızca o adları `globalThis.__jskeletHoist` altına koyar.
 * 5. Hoisted kümenin dışından gelen import'lar, değerleri oradan okuyan
 *    küçük bir proxy'ye çözülür. Island grafiğinde ortak modül kalmadığı için
 *    paylaşılan chunk da oluşmaz.
 *
 * Takaslar (belgelerde de yazılı):
 * - Island'ın kullandığı adlar çatıda tutulur, sayfa o island'ı hiç
 *   yüklemese bile. `import * as` / `export *` ile çekilen modül bütünüyle
 *   tutulur. Büyük kütüphaneler `exclude`'a yazılmalı.
 * - Proxy export'ları değerin anlık kopyasıdır; sonradan yeniden atanan
 *   `export let` canlı bağını kaybeder.
 * - CommonJS modüller esbuild'in interop yardımcılarına muhtaç; bunlar çatı
 *   ile island arasında küçük bir runtime chunk'ı oluşturabilir.
 * - Proxy'ler çatı yüklenmeden çalışamaz. Layout `main.js`'i diğer entry'lerden
 *   önce bastığı ve island'lar `main`'den yüklendiği için sıra garanti.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild";
import {
  matchBarePackage,
  matchPathPrefix,
  matcherKind,
  resolveGroupName,
  resolvePathMatcher,
} from "./chunk-groups.mjs";

const REGISTER_SPECIFIER = "jskelet-hoist:register";
const REGISTER_NS = "jskelet-hoist-register";
const PROXY_NS = "jskelet-hoist-proxy";
const GLOBAL_KEY = "__jskeletHoist";
const PROXY_SEP = "::from::";
const USAGE_PREFIX = "jskelet-hoist-usage:";

/** Static bağ: aynı chunk'a girmek zorunda olan kenarlar. */
const STATIC_KINDS = new Set(["import-statement", "require-call"]);

/** Proxy'lenebilen kaynaklar; CSS ve `file`/`text` loader'ları yerinde kalır. */
const HOISTABLE_EXT = /\.(?:[cm]?[jt]s|json)$/i;

/**
 * @typedef {object} HoistOptions
 * @property {string} into Çatı entry'si (`client/entries/main.js` veya `main.js`).
 * @property {number} minImporters
 * @property {string[]} exclude Bare paket veya yol öneki.
 */

/**
 * @typedef {object} HoistPlan
 * @property {string | null} host Çatının metafile yolu; bulunamadıysa `null`.
 * @property {Set<string>} hoisted Çatı grafiğinde kalan modüller.
 * @property {Map<string, number>} registered Proxy üzerinden erişilen modül → kimlik.
 * @property {Map<string, string>} edges `importer\0specifier` → hedef modül.
 * @property {Map<string, "esm" | "cjs">} formats
 */

/**
 * Metafile yolunun bir dosya mı yoksa sanal namespace mi olduğu
 * (`(disabled):fs`, `jskelet-group:x`). Windows sürücü harfi dosya sayılır.
 *
 * @param {string} input
 * @returns {boolean}
 */
function isFileInput(input) {
  if (/^[a-zA-Z]:[\\/]/.test(input)) return true;
  return !/^\(?[a-z][\w-]*\)?:/i.test(input);
}

/**
 * `node_modules/@scope/pkg/dist/x.js` → `@scope/pkg/dist/x.js`.
 *
 * @param {string} input
 * @returns {string | null}
 */
export function packageSubpath(input) {
  const marker = "node_modules/";
  const index = input.lastIndexOf(marker);
  if (index === -1) return null;
  return input.slice(index + marker.length);
}

/**
 * @param {string} input
 * @param {string} root
 * @param {string[]} exclude
 * @param {import('./chunk-groups.mjs').ChunkGroupOptions | null} groupOptions
 * @returns {boolean}
 */
function isPinned(input, root, exclude, groupOptions) {
  if (!HOISTABLE_EXT.test(input)) return true;

  const abs = path.resolve(root, input);
  const pkg = packageSubpath(input);

  for (const matcher of exclude) {
    if (matcherKind(matcher) === "bare") {
      if (pkg && matchBarePackage(matcher, pkg)) return true;
      continue;
    }
    if (matchPathPrefix(resolvePathMatcher(root, matcher), abs)) return true;
  }

  // Bir gruba düşen modül grubun chunk'ında kalmalı; çatıya çekmek grubu böler.
  if (groupOptions && resolveGroupName(pkg ?? input, abs, groupOptions)) return true;
  return false;
}

/**
 * Çatının metafile yolunu bulur. `into` ya proje köküne göre yol
 * (`client/entries/main.js`) ya da manifest adıdır (`main.js`, `main.ts`
 * kaynağı için de `main.js`).
 *
 * @param {string[]} entries Metafile yolları.
 * @param {string} into
 * @returns {string | null}
 */
export function findHostEntry(entries, into) {
  const wanted = into.replace(/\\/g, "/").replace(/^\.\//, "");
  const stem = (/** @type {string} */ file) =>
    path.posix.basename(file).replace(/\.(?:[cm]?[jt]s)$/i, "");

  const exact = entries.find((entry) => entry === wanted);
  if (exact) return exact;

  if (!wanted.includes("/")) {
    return entries.find((entry) => stem(entry) === stem(wanted)) ?? null;
  }
  // `client/entries/main.js` yazılmış ama kaynak `main.ts` olabilir.
  return (
    entries.find(
      (entry) =>
        path.posix.dirname(entry) === path.posix.dirname(wanted) &&
        stem(entry) === stem(wanted),
    ) ?? null
  );
}

/**
 * Analiz metafile'ından hoisting planını çıkarır. Saf fonksiyon; dosya
 * sistemine ve esbuild'e dokunmaz.
 *
 * Kapanış değişmezi: hoisted bir modülün her static bağımlılığı da hoisted
 * olmalı, yoksa o bağımlılık çatı ile island arasında paylaşılan chunk'a
 * düşer. Sayaç kökler üzerinden tutulduğu için bağımlılığın sayacı hiçbir
 * zaman bağımlısınınkinden küçük değildir; sabitlenmiş (`exclude`, grup,
 * CSS) bir modüle ulaşan her şey de aday olmaktan çıkarılır.
 *
 * @param {import('esbuild').Metafile} metafile
 * @param {{
 *   root: string,
 *   entries: string[],
 *   hoist: HoistOptions,
 *   groupOptions?: import('./chunk-groups.mjs').ChunkGroupOptions | null,
 * }} options
 * @returns {HoistPlan}
 */
export function planHoist(metafile, { root, entries, hoist, groupOptions = null }) {
  /** @type {HoistPlan} */
  const plan = {
    host: null,
    hoisted: new Set(),
    registered: new Map(),
    edges: new Map(),
    formats: new Map(),
  };

  const inputs = metafile.inputs ?? {};
  const host = findHostEntry(entries, hoist.into);
  if (!host || !inputs[host]) return plan;
  plan.host = host;

  /** @type {Map<string, string[]>} */
  const staticDeps = new Map();
  /** @type {Map<string, string[]>} */
  const staticImporters = new Map();
  /** @type {Set<string>} */
  const roots = new Set(entries.filter((entry) => inputs[entry]));

  for (const [file, input] of Object.entries(inputs)) {
    if (!isFileInput(file)) continue;
    // JSON'un metafile'da formatı yok ama esbuild onu ESM gibi bağlar.
    plan.formats.set(file, input.format === "esm" || /\.json$/i.test(file) ? "esm" : "cjs");

    /** @type {string[]} */
    const deps = [];
    for (const item of input.imports ?? []) {
      if (item.external || !inputs[item.path] || !isFileInput(item.path)) continue;
      if (item.original) plan.edges.set(`${file}\0${item.original}`, item.path);

      if (item.kind === "dynamic-import") {
        roots.add(item.path);
      } else if (STATIC_KINDS.has(item.kind)) {
        deps.push(item.path);
        const list = staticImporters.get(item.path) ?? [];
        list.push(file);
        staticImporters.set(item.path, list);
      }
    }
    staticDeps.set(file, deps);
  }

  /**
   * @param {Iterable<string>} start
   * @param {Map<string, string[]>} graph
   * @returns {Set<string>}
   */
  const reach = (start, graph) => {
    const seen = new Set(start);
    const queue = [...seen];
    while (queue.length) {
      const current = /** @type {string} */ (queue.pop());
      for (const next of graph.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  };

  const hostClosure = reach([host], staticDeps);

  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const rootFile of roots) {
    if (rootFile === host) continue;
    for (const file of reach([rootFile], staticDeps)) {
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
  }

  const exclude = hoist.exclude ?? [];
  const pinned = [...staticDeps.keys()].filter((file) =>
    isPinned(file, root, exclude, groupOptions),
  );
  const pinnedSet = new Set(pinned);

  // Sabitlenmiş modüllere girmeden köklerden erişilenler. Bir vendor
  // dosyası buraya hiç düşmüyorsa yalnızca o vendor'ın içinden çekiliyordur.
  const free = new Set();
  const queue = [...roots, host].filter((file) => !pinnedSet.has(file));
  for (const file of queue) free.add(file);
  while (queue.length) {
    const current = /** @type {string} */ (queue.pop());
    for (const next of staticDeps.get(current) ?? []) {
      if (free.has(next) || pinnedSet.has(next)) continue;
      free.add(next);
      queue.push(next);
    }
  }

  // `exclude` yalnızca modülün kendisini dışarıda tutar: uygulama dosyası
  // bağımlılıkları (`dates.js`) kendi sayaçlarıyla değerlendirilir ve
  // hariç tutulan modül onlara proxy üzerinden erişir. Vendor'ın yalnızca
  // kendi kullandığı paketler (`lightweight-charts` → `fancy-canvas`)
  // onunla kalır; çatıya çekmek ağır kodu her sayfaya taşırdı.
  const removed = new Set(
    [...reach(pinned, staticDeps)].filter(
      (file) =>
        !hostClosure.has(file) &&
        (pinnedSet.has(file) || (file.includes("node_modules/") && !free.has(file))),
    ),
  );
  const tainted = reach(removed, staticImporters);

  for (const file of hostClosure) plan.hoisted.add(file);
  for (const [file, count] of counts) {
    if (count < hoist.minImporters) continue;
    if (tainted.has(file)) continue;
    plan.hoisted.add(file);
  }

  /** @type {string[]} */
  const needsProxy = [];
  for (const [file, input] of Object.entries(inputs)) {
    if (!isFileInput(file)) continue;
    for (const item of input.imports ?? []) {
      if (item.external || !plan.hoisted.has(item.path)) continue;
      if (item.path === host) continue;
      // Hoisted bir modülü dinamik import etmek onu ayrı bir entry yapar ve
      // esbuild çatıyı paylaşılan chunk'a böler; kimden gelirse gelsin proxy.
      const viaProxy =
        item.kind === "dynamic-import" ||
        (STATIC_KINDS.has(item.kind) && !plan.hoisted.has(file));
      if (viaProxy) needsProxy.push(item.path);
    }
  }

  // Kimlikler sıralı yol listesinden: aynı grafik aynı çıktıyı (ve hash'i) üretir.
  [...new Set(needsProxy)].sort().forEach((file, index) => {
    plan.registered.set(file, index);
  });

  return plan;
}

/**
 * Bir import'un proxy'ye mi gideceği. Asıl build ile kullanım analizi aynı
 * kararı vermeli; yoksa register'daki adlar proxy'lerin beklediğini tutmaz.
 *
 * @param {HoistPlan} plan
 * @param {string} importer Metafile yolu.
 * @param {string} specifier
 * @param {string} kind esbuild `ImportKind`.
 * @returns {string | null} Hedef modülün metafile yolu.
 */
export function proxyTarget(plan, importer, specifier, kind) {
  if (!plan.host || !plan.registered.size) return null;
  const target = plan.edges.get(`${importer}\0${specifier}`);
  if (!target || !plan.registered.has(target)) return null;
  if (kind !== "dynamic-import" && plan.hoisted.has(importer)) return null;
  return target;
}

/**
 * @param {string} clause `{ a, b as c }` gövdesi.
 * @returns {string[]}
 */
function namedClause(clause) {
  return clause
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const name = part.split(/\s+as\s+/)[0].trim();
      return name.startsWith('"') ? JSON.parse(name) : name;
    });
}

/**
 * Kullanım turunun çıktısından modül kimliği başına kullanılan adları okur.
 * Girdi esbuild'in minify'sız ESM çıktısı; external import'ları her zaman
 * `import d, { a, b as c } from "x";` biçiminde yazdığı için düzenli ifade
 * yeterli. Tanınmayan her kullanım (`import()`, `require`, `* as`,
 * `export *`) güvenli tarafta kalıp modülün tamamını ister.
 *
 * @param {string[]} texts
 * @returns {Map<number, Set<string> | null>}
 */
export function parseUsage(texts) {
  /** @type {Map<number, Set<string> | null>} */
  const usage = new Map();
  const want = (/** @type {number} */ id, /** @type {string[] | null} */ names) => {
    if (usage.get(id) === null) return;
    if (names === null) {
      usage.set(id, null);
      return;
    }
    const set = usage.get(id) ?? new Set();
    for (const name of names) set.add(name);
    usage.set(id, set);
  };

  const prefix = USAGE_PREFIX.replace(/[-:]/g, "\\$&");
  const statement = new RegExp(
    `\\b(import|export)\\s*((?:[\\w$\\s,*]|\\{[^}]*\\})*?)\\s*from\\s*"${prefix}(\\d+)"`,
    "g",
  );
  const sideEffect = new RegExp(`\\bimport\\s*"${prefix}(\\d+)"`, "g");
  const any = new RegExp(`"${prefix}(\\d+)"`, "g");

  for (const text of texts) {
    let matched = 0;
    const seen = [...text.matchAll(any)].length;

    for (const match of text.matchAll(sideEffect)) {
      matched += 1;
      want(Number(match[1]), []);
    }

    for (const match of text.matchAll(statement)) {
      matched += 1;
      const id = Number(match[3]);
      const clause = match[2].trim();
      if (clause.includes("*")) {
        want(id, null);
        continue;
      }

      /** @type {string[]} */
      const names = [];
      const braces = clause.match(/\{([^}]*)\}/);
      if (braces) names.push(...namedClause(braces[1]));
      const head = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
      if (head && match[1] === "import") names.push("default");
      want(id, names);
    }

    // Eşleşmeyen geçiş (`import("…")`, `__require("…")`) → modülün tamamı.
    if (seen > matched) {
      for (const match of text.matchAll(any)) {
        const index = /** @type {number} */ (match.index);
        const before = text.slice(Math.max(0, index - 200), index);
        if (/\bfrom\s*$/.test(before) || /\bimport\s*$/.test(before)) continue;
        want(Number(match[1]), null);
      }
    }
  }

  return usage;
}

/**
 * Hoisting analizinin tamamı: grafik → plan → kullanılan adlar → (gerekirse)
 * export listeleri. Turların hiçbiri diske yazmaz. Gruplama plugin'i
 * kullanılmaz; sanal barrel'ları grafiği kirletir.
 *
 * @param {import('esbuild').BuildOptions} options Asıl build'in ayarları.
 * @param {{
 *   root: string,
 *   entries: string[],
 *   hoist: HoistOptions,
 *   groupOptions: import('./chunk-groups.mjs').ChunkGroupOptions | null,
 *   plugins: import('esbuild').Plugin[],
 * }} context
 * @returns {Promise<{ plan: HoistPlan, names: Map<string, string[]> }>}
 */
export async function analyzeHoist(options, { root, entries, hoist, groupOptions, plugins }) {
  /** @type {import('esbuild').BuildOptions} */
  const probe = {
    ...options,
    plugins,
    write: false,
    minify: false,
    sourcemap: false,
    metafile: true,
    logLevel: "silent",
  };
  const toInput = (/** @type {string} */ file) =>
    path.relative(root, file).split(path.sep).join("/");

  const graph = await esbuild.build(probe);
  const plan = planHoist(/** @type {import('esbuild').Metafile} */ (graph.metafile), {
    root,
    entries: entries.map(toInput),
    hoist,
    groupOptions,
  });

  /** @type {Map<string, string[]>} */
  const names = new Map();
  if (!plan.registered.size) return { plan, names };

  /** @type {import('esbuild').Plugin} */
  const marker = {
    name: "jskelet-hoist-usage",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point" || args.namespace !== "file" || !args.importer) {
          return undefined;
        }
        const target = proxyTarget(plan, toInput(args.importer), args.path, args.kind);
        if (!target) return undefined;
        return { path: `${USAGE_PREFIX}${plan.registered.get(target)}`, external: true };
      });
    },
  };

  const used = await esbuild.build({ ...probe, metafile: false, plugins: [marker, ...plugins] });
  const usage = parseUsage((used.outputFiles ?? []).map((file) => file.text));

  /** @type {string[]} */
  const full = [];
  for (const [file, id] of plan.registered) {
    if (plan.formats.get(file) === "cjs") continue;
    const set = usage.get(id);
    if (set === null) full.push(file);
    else names.set(file, [...(set ?? [])].sort());
  }
  if (!full.length) return { plan, names };

  const listed = await esbuild.build({
    ...probe,
    entryPoints: full.map((file) => path.resolve(root, file)),
    // Farklı dizinlerdeki `index.js`'ler aynı çıktı yoluna düşmesin.
    entryNames: "[dir]/[name].[hash]",
  });
  for (const output of Object.values(listed.metafile?.outputs ?? {})) {
    if (output.entryPoint && full.includes(output.entryPoint)) {
      names.set(output.entryPoint, output.exports ?? []);
    }
  }
  return { plan, names };
}

/**
 * @param {string} name
 * @returns {string}
 */
function exportName(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/**
 * Proxy modülü. ESM / JSON hedefte export adları analizden gelir; CJS
 * hedefte `module.exports` aynı nesneye bağlanır ve named import'ları
 * esbuild'in interop'u çözer.
 *
 * @param {number} id
 * @param {"esm" | "cjs"} format
 * @param {string[]} exports
 * @returns {string}
 */
export function proxySource(id, format, exports) {
  const head = `const m = globalThis.${GLOBAL_KEY}[${id}];\n`;
  if (format === "cjs") {
    return `${head}module.exports = m.__esModule ? m : m.default;\n`;
  }
  if (!exports.length) return `${head}export {};\n`;

  const locals = exports.map((name, index) => `_${index} = m[${JSON.stringify(name)}]`);
  const specifiers = exports.map((name, index) => `_${index} as ${exportName(name)}`);
  return `${head}const ${locals.join(", ")};\nexport { ${specifiers.join(", ")} };\n`;
}

/**
 * Register modülü. ESM hedefler adlarıyla import edilir: `import * as`
 * esbuild'in `__export` yardımcısını çatıya koyar ve island'lar da aynı
 * yardımcıyı kullanıyorsa ikisi arasında küçük bir runtime chunk'ı oluşur.
 * CJS hedefler zaten interop yardımcılarına muhtaç; namespace olarak kalır.
 *
 * @param {HoistPlan} plan
 * @param {string} root
 * @param {Map<string, string[]>} exportsByFile ESM hedef başına tutulacak adlar.
 * @returns {string}
 */
export function registerSource(plan, root, exportsByFile) {
  const lines = [];
  const assigns = [];
  for (const [file, id] of plan.registered) {
    const specifier = JSON.stringify(path.resolve(root, file));
    if (plan.formats.get(file) === "cjs") {
      lines.push(`import * as m${id} from ${specifier};`);
      assigns.push(`r[${id}] = m${id};`);
      continue;
    }

    const names = exportsByFile.get(file) ?? [];
    if (!names.length) {
      lines.push(`import ${specifier};`);
      assigns.push(`r[${id}] = {};`);
      continue;
    }
    const imported = names.map((name, index) => `${exportName(name)} as m${id}_${index}`);
    const fields = names.map((name, index) => `${JSON.stringify(name)}: m${id}_${index}`);
    lines.push(`import { ${imported.join(", ")} } from ${specifier};`);
    assigns.push(`r[${id}] = { ${fields.join(", ")} };`);
  }
  return [
    ...lines,
    `const r = (globalThis.${GLOBAL_KEY} ??= {});`,
    ...assigns,
    "",
  ].join("\n");
}

/**
 * Çatıyı yükleyen onLoad yalnızca aynı adlı dosyalarda JS'e geçsin; her
 * modül için Go → JS turu build'i belirgin yavaşlatır.
 *
 * @param {string} into
 * @returns {RegExp}
 */
function hostFilter(into) {
  const stem = path.posix
    .basename(into.replace(/\\/g, "/"))
    .replace(/\.(?:[cm]?[jt]s)$/i, "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\\\/])${stem}\\.m?[jt]s$`);
}

/**
 * @param {{
 *   root: string,
 *   hoist: HoistOptions,
 *   analyze: () => Promise<{ plan: HoistPlan, names: Map<string, string[]> }>,
 * }} options
 * @returns {{ plugin: import('esbuild').Plugin, getPlan: () => HoistPlan | null }}
 */
export function hoistSharedPlugin({ root, hoist, analyze }) {
  /** @type {HoistPlan | null} */
  let plan = null;
  /** @type {Map<string, string[]>} */
  let exportsByFile = new Map();
  let warnedMissingHost = false;

  const toInput = (/** @type {string} */ absolute) =>
    path.relative(root, absolute).split(path.sep).join("/");

  /** @type {import('esbuild').Plugin} */
  const plugin = {
    name: "jskelet-hoist-shared",
    setup(build) {
      build.onStart(async () => {
        try {
          const result = await analyze();
          plan = result.plan;
          exportsByFile = result.names;
        } catch {
          // Sözdizimi hatası gibi durumlarda asıl build hatayı raporlar;
          // önceki plan varsa onunla devam edilir.
          return;
        }

        if (!plan.host && !warnedMissingHost) {
          warnedMissingHost = true;
          return {
            warnings: [
              {
                text: `build.client.hoistShared.into "${hoist.into}" is not a client entry; shared modules are not hoisted`,
              },
            ],
          };
        }
        return undefined;
      });

      build.onResolve({ filter: /^jskelet-hoist:register$/ }, (args) =>
        args.path === REGISTER_SPECIFIER ? { path: "register", namespace: REGISTER_NS } : undefined,
      );

      build.onResolve({ filter: /.*/ }, (args) => {
        if (!plan?.host || !plan.registered.size) return undefined;
        if (args.kind === "entry-point" || args.namespace !== "file" || !args.importer) {
          return undefined;
        }

        const importer = toInput(args.importer);
        const target = proxyTarget(plan, importer, args.path, args.kind);
        if (!target) return undefined;
        // Proxy importer başına ayrı modül: tek proxy'yi iki island paylaşsaydı
        // esbuild onu yine kendi küçük chunk'ına koyardı. Kopya birkaç düzine bayt.
        return { path: `${target}${PROXY_SEP}${importer}`, namespace: PROXY_NS };
      });

      build.onLoad({ filter: /.*/, namespace: REGISTER_NS }, () => ({
        contents: plan ? registerSource(plan, root, exportsByFile) : "export {};\n",
        resolveDir: root,
        loader: "js",
      }));

      build.onLoad({ filter: /.*/, namespace: PROXY_NS }, (args) => {
        const target = args.path.slice(0, args.path.indexOf(PROXY_SEP));
        const id = plan?.registered.get(target);
        if (id == null || !plan) return { contents: "export {};\n", loader: "js" };
        return {
          contents: proxySource(
            id,
            plan.formats.get(target) ?? "esm",
            exportsByFile.get(target) ?? [],
          ),
          resolveDir: root,
          loader: "js",
        };
      });

      build.onLoad({ filter: hostFilter(hoist.into) }, async (args) => {
        if (args.namespace !== "file" || !plan?.host || !plan.registered.size) {
          return undefined;
        }
        if (toInput(args.path) !== plan.host) return undefined;

        const source = await fs.readFile(args.path, "utf8");
        // Sona eklenir: çatının kendi import sırası (polyfill önce vb.) korunur;
        // register yine çatının gövdesinden önce değerlendirilir.
        return {
          contents: `${source}\nimport ${JSON.stringify(REGISTER_SPECIFIER)};\n`,
          loader: /\.m?ts$/i.test(args.path) ? "ts" : "js",
          resolveDir: path.dirname(args.path),
          // İçerik plugin'den gelince esbuild watch dosyayı kendiliğinden izlemez.
          watchFiles: [args.path],
        };
      });
    },
  };

  return { plugin, getPlan: () => plan };
}
