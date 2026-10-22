/**
 * Çatının static chunk'larını çatıya gömer (`build.client.hoistShared`).
 *
 * `hoistShared` uygulama modüllerini çatıya taşır ama esbuild'in kendi
 * ürettiği ortak kod (interop yardımcıları, `process.env` define'ı) yine
 * çatı + island'ların hepsinin paylaştığı bir chunk'a düşer. Bu chunk çatının
 * static import'u olduğu için her sayfada kritik yolda fazladan bir istektir.
 *
 * Build sonrası, bellekteki çıktı üzerinde:
 *
 * 1. Çatının static import kapanışındaki chunk'lar ikinci bir esbuild turuyla
 *    çatıya bundle edilir. Dışarıdan da kullanılanların namespace nesnesi
 *    `globalThis.__jskeletShared[<chunk adı>]` altına konur.
 * 2. Bu chunk'ları import eden diğer çıktılarda import satırı silinir ve
 *    yerel adlar `define` ile o namespace'in alanlarına çevrilir.
 *
 * Neden çatının adına `import` değil: çatı island'ların hash'li adlarını
 * içerir; island da çatının hash'li adını içerseydi döngü olurdu ve
 * yalnızca çatı değiştiğinde island'ın adı değişmeden içeriği değişirdi.
 * Namespace okuması ise chunk adına bağlıdır; o ad zaten island'ın
 * hash'ine girer.
 *
 * Neden namespace üzerinden: esbuild'in tembel init'li değişkenleri
 * (`var O; E = () => { O = … }`) canlı bağlantıdır; anlık kopya `undefined`
 * yakalardı.
 */
import path from "node:path";
import * as esbuild from "esbuild";

export const SHARED_GLOBAL = "__jskeletShared";
const OUTPUT_NS = "jskelet-output";
const SETUP_SPECIFIER = "jskelet-inline:setup";
const MAP_COMMENT = /\n?\/\/# sourceMappingURL=([^\s]+)\s*$/;

/**
 * @typedef {object} InlineOptions
 * @property {string} root `absWorkingDir`; metafile yolları buna göreli.
 * @property {string} host Çatının kaynak yolu (`client/entries/main.js`).
 * @property {esbuild.BuildOptions["target"]} target
 * @property {boolean} sourcemap
 */

/**
 * @typedef {object} InlineResult
 * @property {esbuild.OutputFile[]} files
 * @property {string[]} inlined Gömülen chunk'ların metafile yolları.
 */

/**
 * @param {string} file
 * @returns {string}
 */
function normalize(file) {
  return path.resolve(file).replace(/\\/g, "/");
}

/**
 * @param {string} file
 * @returns {string}
 */
export function chunkKey(file) {
  return path.posix.basename(file).replace(/\.m?js$/, "");
}

/**
 * Çıktının başındaki import deyimleri. esbuild bütün import'ları dosyanın
 * en başına yazar; gövde içinde aramak string'lere takılırdı.
 *
 * @param {string} text
 * @returns {{ start: number, end: number, names: string | null, specifier: string }[]}
 */
export function leadingImports(text) {
  const statement =
    /\s*import\s*(?:\{([^}]*)\}\s*from\s*)?(["'])([^"']+)\2\s*;?/y;
  /** @type {{ start: number, end: number, names: string | null, specifier: string }[]} */
  const found = [];
  let index = 0;
  for (;;) {
    statement.lastIndex = index;
    const match = statement.exec(text);
    if (!match) break;
    const start = index + (match[0].length - match[0].trimStart().length);
    found.push({
      start,
      end: statement.lastIndex,
      names: match[1] ?? null,
      specifier: match[3],
    });
    index = statement.lastIndex;
  }
  return found;
}

/**
 * `a as e,b as t,c` → `{ e: "a", t: "b", c: "c" }` (yerel → dışa açık ad).
 *
 * @param {string} names
 * @returns {Record<string, string>}
 */
export function parseImportNames(names) {
  /** @type {Record<string, string>} */
  const locals = {};
  for (const part of names.split(",")) {
    const item = part.trim();
    if (!item) continue;
    const [imported, local = imported] = item.split(/\s+as\s+/);
    locals[local.trim()] = imported.trim();
  }
  return locals;
}

/**
 * Bağlı map dosyasını data URL'ye çevirir: ikinci tur dosyaları diskten değil
 * bellekten okur ve esbuild kaynak haritasını ancak böyle zincirler.
 *
 * @param {string} text
 * @param {string} file
 * @param {Map<string, esbuild.OutputFile>} byPath
 * @returns {string}
 */
function inlineSourceMap(text, file, byPath) {
  const match = MAP_COMMENT.exec(text);
  if (!match) return text;
  const map = byPath.get(normalize(path.join(path.dirname(file), match[1])));
  if (!map) return text;
  const data = Buffer.from(map.text).toString("base64");
  return `${text.slice(0, match.index)}\n//# sourceMappingURL=data:application/json;base64,${data}\n`;
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
function relativeSpecifier(from, to) {
  const relative = path.posix.relative(path.posix.dirname(from), to);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/**
 * @param {esbuild.Metafile} metafile
 * @param {string} hostOutput
 * @returns {string[] | null} Kapanıştaki chunk'lar; içinde entry varsa `null`.
 */
function staticChunks(metafile, hostOutput) {
  const seen = new Set([hostOutput]);
  const queue = [hostOutput];
  /** @type {string[]} */
  const chunks = [];
  while (queue.length) {
    const current = /** @type {string} */ (queue.shift());
    for (const item of metafile.outputs[current]?.imports ?? []) {
      if (item.kind !== "import-statement" || item.external) continue;
      if (seen.has(item.path)) continue;
      // Entry çıktısı başka bir sayfada tek başına da yüklenir; gömülemez.
      if (metafile.outputs[item.path]?.entryPoint) return null;
      seen.add(item.path);
      queue.push(item.path);
      chunks.push(item.path);
    }
  }
  return chunks;
}

/**
 * Gömülecek bir şey yoksa `null` döner. İkinci tur başarısız olursa fırlatır;
 * çağıran ikisinde de esbuild'in çıktısını olduğu gibi yazar. Hiçbir dosya
 * bu fonksiyon içinde yazılmaz, yarım kalmış bir gömme diske düşmez.
 *
 * @param {esbuild.OutputFile[]} files
 * @param {esbuild.Metafile} metafile Yerinde güncellenir.
 * @param {InlineOptions} options
 * @returns {Promise<InlineResult | null>}
 */
export async function inlineHostChunks(files, metafile, options) {
  const { root } = options;
  const toAbs = (/** @type {string} */ output) => normalize(path.join(root, output));

  const hostOutput = Object.entries(metafile.outputs).find(
    ([, output]) => output.entryPoint === options.host,
  )?.[0];
  if (!hostOutput) return null;

  const chunks = staticChunks(metafile, hostOutput);
  if (!chunks?.length) return null;
  const merged = new Set(chunks);
  const mergedAbs = new Map(chunks.map((chunk) => [toAbs(chunk), chunk]));

  /** @type {Map<string, esbuild.OutputFile>} */
  const byPath = new Map(files.map((file) => [normalize(file.path), file]));
  const hostAbs = toAbs(hostOutput);

  // Çatı dışından kullanılan chunk'lar; yalnızca bunların namespace'i açılır.
  /** @type {Map<string, string[]>} */
  const importers = new Map();
  for (const [output, info] of Object.entries(metafile.outputs)) {
    if (output === hostOutput || merged.has(output)) continue;
    for (const item of info.imports ?? []) {
      if (!merged.has(item.path)) continue;
      const list = importers.get(output) ?? [];
      if (!list.includes(item.path)) list.push(item.path);
      importers.set(output, list);
    }
  }
  const exposed = [...new Set([...importers.values()].flat())].sort();

  const shared = {
    target: options.target,
    format: /** @type {const} */ ("esm"),
    bundle: true,
    write: false,
    minify: true,
    legalComments: /** @type {const} */ ("none"),
    sourcemap: options.sourcemap ? /** @type {const} */ ("linked") : false,
    allowOverwrite: true,
    logLevel: /** @type {const} */ ("silent"),
  };

  const host = await esbuild.build({
      ...shared,
      entryPoints: [hostAbs],
      outfile: hostAbs,
      inject: exposed.length ? [SETUP_SPECIFIER] : [],
      plugins: [
        {
          name: "jskelet-inline-host",
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (args.path === SETUP_SPECIFIER) {
                return { path: SETUP_SPECIFIER, namespace: OUTPUT_NS };
              }
              if (args.kind === "entry-point") return { path: hostAbs };
              const target = normalize(path.resolve(args.resolveDir, args.path));
              if (mergedAbs.has(target)) return { path: target };
              // Gömülen chunk'ın kendi import'ları çatının konumuna göre yazılır.
              return { path: relativeSpecifier(hostAbs, target), external: true };
            });
            build.onLoad({ filter: /.*/, namespace: OUTPUT_NS }, () => ({
              contents: [
                ...exposed.map(
                  (chunk, index) =>
                    `import * as s${index} from ${JSON.stringify(toAbs(chunk))};`,
                ),
                `const g = (globalThis.${SHARED_GLOBAL} ||= {});`,
                ...exposed.map(
                  (chunk, index) => `g[${JSON.stringify(chunkKey(chunk))}] = s${index};`,
                ),
              ].join("\n"),
              resolveDir: root,
            }));
            build.onLoad({ filter: /.*/ }, (args) => {
              const file = byPath.get(normalize(args.path));
              if (!file) return undefined;
              return {
                contents: inlineSourceMap(file.text, args.path, byPath),
                loader: "js",
              };
            });
          },
        },
      ],
    });
  const rewritten = [...host.outputFiles];
  for (const [output, used] of importers) {
    rewritten.push(...(await rewriteImporter(output, used, { toAbs, byPath, shared })));
  }

  const replaced = new Set(rewritten.map((file) => normalize(file.path)));
  const dropped = new Set(
    chunks.flatMap((chunk) => [toAbs(chunk), `${toAbs(chunk)}.map`]),
  );
  const next = [
    ...files.filter((file) => {
      const key = normalize(file.path);
      return !replaced.has(key) && !dropped.has(key);
    }),
    ...rewritten,
  ];

  updateMetafile(metafile, { hostOutput, chunks, files: rewritten, root });
  return { files: next, inlined: chunks };
}

/**
 * @param {string} output
 * @param {string[]} used
 * @param {{
 *   toAbs: (output: string) => string,
 *   byPath: Map<string, esbuild.OutputFile>,
 *   shared: esbuild.BuildOptions,
 * }} context
 * @returns {Promise<esbuild.OutputFile[]>}
 */
async function rewriteImporter(output, used, { toAbs, byPath, shared }) {
  const abs = toAbs(output);
  const file = byPath.get(abs);
  if (!file) throw new Error(`missing output ${output}`);

  const usedAbs = new Map(used.map((chunk) => [toAbs(chunk), chunk]));
  /** @type {Record<string, string>} */
  const define = {};
  /** @type {Set<string>} */
  const injected = new Set();
  let text = file.text;
  let matched = 0;

  for (const statement of leadingImports(file.text)) {
    const target = normalize(path.join(path.dirname(abs), statement.specifier));
    const chunk = usedAbs.get(target);
    if (!chunk) continue;
    matched += 1;
    const binding = `__jskShared_${chunkKey(chunk).replace(/\W/g, "_")}`;
    injected.add(chunk);
    for (const [local, imported] of Object.entries(
      parseImportNames(statement.names ?? ""),
    )) {
      define[local] = `${binding}.${imported}`;
    }
    // Aynı uzunlukta boşluk: kaynak haritasının sütunları kaymasın.
    text =
      text.slice(0, statement.start) +
      " ".repeat(statement.end - statement.start) +
      text.slice(statement.end);
  }
  // Tanımadığımız bir import biçimi kaldıysa (yeniden export vb.) gömme yapılmaz.
  if (matched < used.length) throw new Error(`unmatched import in ${output}`);

  const resolveDir = path.dirname(abs);
  const result = await esbuild.build({
    ...shared,
    stdin: {
      contents: inlineSourceMap(text, abs, byPath),
      sourcefile: abs,
      resolveDir,
      loader: "js",
    },
    outfile: abs,
    define,
    inject: [SETUP_SPECIFIER],
    plugins: [
      {
        name: "jskelet-inline-importer",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) =>
            args.path === SETUP_SPECIFIER
              ? { path: SETUP_SPECIFIER, namespace: OUTPUT_NS }
              : { path: args.path, external: true },
          );
          build.onLoad({ filter: /.*/, namespace: OUTPUT_NS }, () => ({
            contents: [...injected]
              .map((chunk) => {
                const binding = `__jskShared_${chunkKey(chunk).replace(/\W/g, "_")}`;
                return `export const ${binding} = globalThis.${SHARED_GLOBAL}[${JSON.stringify(chunkKey(chunk))}];`;
              })
              .join("\n"),
          }));
        },
      },
    ],
  });
  return result.outputFiles;
}

/**
 * Dev panelindeki analiz ve `preload.json` metafile'dan okunur; gömülen
 * chunk'lar orada da görünmemeli.
 *
 * @param {esbuild.Metafile} metafile
 * @param {{ hostOutput: string, chunks: string[], files: esbuild.OutputFile[], root: string }} change
 */
function updateMetafile(metafile, { hostOutput, chunks, files, root }) {
  const merged = new Set(chunks);
  const host = metafile.outputs[hostOutput];

  /** @type {esbuild.Metafile["outputs"][string]["imports"]} */
  const carried = [];
  for (const chunk of chunks) {
    const info = metafile.outputs[chunk];
    if (!info) continue;
    for (const [input, detail] of Object.entries(info.inputs)) {
      const previous = host.inputs[input];
      host.inputs[input] = previous
        ? { bytesInOutput: previous.bytesInOutput + detail.bytesInOutput }
        : detail;
    }
    carried.push(...info.imports.filter((item) => !merged.has(item.path)));
    delete metafile.outputs[chunk];
    delete metafile.outputs[`${chunk}.map`];
  }

  for (const [output, info] of Object.entries(metafile.outputs)) {
    const extra = output === hostOutput ? carried : [];
    const seen = new Set();
    info.imports = [...info.imports, ...extra].filter((item) => {
      if (merged.has(item.path)) return false;
      const key = `${item.kind}\0${item.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  for (const file of files) {
    const output = path.relative(root, file.path).split(path.sep).join("/");
    if (metafile.outputs[output]) metafile.outputs[output].bytes = file.contents.byteLength;
  }
}
