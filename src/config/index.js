/**
 * `jskelet.config.mjs` yükleyicisi ve çözümlenmiş proje durumu.
 *
 * Bu modül framework'ün **tek gerçek kaynağıdır**: proje kökü, dizin yolları,
 * markalama, hook'lar ve `headers/redirects/rewrites/cache` kuralları burada
 * normalize edilir. Diğer modüller yol hesaplamaz, `getConfig()` çağırır.
 * Böylece framework `node_modules/` içine girdiğinde hiçbir dosyada
 * `../..` sayma hatası oluşmaz.
 *
 * Config dosyası **zorunlu değildir**: yoksa ya da okunamıyorsa uyarı basılır
 * ve sunucu varsayılanlarla ayağa kalkar. Bozuk bir düzenleme siteyi
 * açılamaz hâle getirmemeli.
 *
 * Desteklenen bölümler (hepsi opsiyonel, hepsi `async` olabilir):
 *   headers()   → [{ source, headers: [{ key, value }] }]
 *   redirects() → [{ source, destination, permanent?, statusCode? }]
 *   rewrites()  → [{ source, destination }] | { beforeFiles?, afterFiles? }
 *   cache()     → { html?: { [source]: saniye }, prewarm?: {...} }
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { compilePattern } from "./pattern.js";
import {
  DEFAULT_BRAND,
  DEFAULT_DEV_GATE_BYPASS,
  DEFAULT_DIRS,
  DEFAULT_PREWARM,
  DEFAULT_PREWARM_SKIP,
  DEFAULT_STATIC,
} from "./defaults.js";

/** Framework paketinin kökü — kendi şablonlarına ve varlıklarına erişir. */
export const FRAMEWORK_ROOT = path.resolve(import.meta.dirname, "..", "..");

const CONFIG_FILE = "jskelet.config.mjs";

/**
 * @typedef {import('./pattern.js').CompiledPattern} CompiledPattern
 *
 * @typedef {object} ResolvedConfig
 * @property {string} root Proje kökü (mutlak).
 * @property {boolean} loaded Config dosyası okundu mu.
 * @property {Record<string, string>} dirs Mutlak dizin yolları.
 * @property {{ pattern: CompiledPattern, headers: { key: string, value: string }[] }[]} headers
 * @property {{ pattern: CompiledPattern, destination: string, statusCode: number }[]} redirects
 * @property {{ phase: "beforeFiles" | "afterFiles", pattern: CompiledPattern, destination: string }[]} rewrites
 * @property {{ pattern: CompiledPattern, seconds: number }[]} html
 * @property {Record<string, unknown>} prewarm
 * @property {Record<string, unknown>} brand
 * @property {Record<string, Function>} hooks
 * @property {string} layout Layout `.ejs` dosyasının mutlak yolu.
 * @property {string[] | null} routes Açık route modülü listesi.
 * @property {{ extensions: Set<string>, prefixes: string[] }} static
 * @property {string[]} devGateBypass
 * @property {string[]} preconnect
 * @property {string[]} prewarmSkip
 * @property {{ family: string, slug?: string, weights: number[] }[]} fonts
 * @property {{ scan?: string[] } | false} icons
 * @property {{ widths?: number[], quality?: number, skip?: string[] } | false} images
 * @property {string[]} clientEnv Client bundle'a gömülecek env anahtarları.
 */

/** @type {ResolvedConfig | null} */
let config = null;

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {unknown[]}
 */
function asArray(value, label) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  console.warn(`[config] ${label} bir dizi döndürmeli, yok sayıldı`);
  return [];
}

/**
 * @param {unknown} raw
 * @returns {ResolvedConfig["headers"]}
 */
function normalizeHeaders(raw) {
  /** @type {ResolvedConfig["headers"]} */
  const out = [];

  for (const entry of asArray(raw, "headers()")) {
    const pattern = compilePattern(entry?.source);
    if (!pattern) continue;

    const headers = asArray(entry?.headers, "headers()[].headers")
      .filter((header) => header?.key && header?.value !== undefined)
      .map((header) => ({ key: String(header.key), value: String(header.value) }));

    if (headers.length) out.push({ pattern, headers });
  }

  return out;
}

/**
 * @param {unknown} raw
 * @returns {ResolvedConfig["redirects"]}
 */
function normalizeRedirects(raw) {
  /** @type {ResolvedConfig["redirects"]} */
  const out = [];

  for (const entry of asArray(raw, "redirects()")) {
    const pattern = compilePattern(entry?.source);
    if (!pattern || typeof entry?.destination !== "string") continue;

    // Next semantiği: permanent → 308, geçici → 307. Farklı bir kod isteyen
    // `statusCode` verebilir (ör. eski kurulumlarla uyum için 301).
    const statusCode = Number(entry.statusCode) || (entry.permanent ? 308 : 307);

    out.push({ pattern, destination: entry.destination, statusCode });
  }

  return out;
}

/**
 * @param {unknown} raw
 * @returns {ResolvedConfig["rewrites"]}
 */
function normalizeRewrites(raw) {
  /** @type {ResolvedConfig["rewrites"]} */
  const out = [];

  /** @type {[("beforeFiles" | "afterFiles"), unknown][]} */
  const phases = Array.isArray(raw)
    ? [["afterFiles", raw]]
    : [
        ["beforeFiles", raw?.beforeFiles],
        ["afterFiles", raw?.afterFiles],
      ];

  for (const [phase, entries] of phases) {
    for (const entry of asArray(entries, `rewrites().${phase}`)) {
      const pattern = compilePattern(entry?.source);
      if (!pattern || typeof entry?.destination !== "string") continue;
      out.push({ phase, pattern, destination: entry.destination });
    }
  }

  return out;
}

/**
 * @param {unknown} raw
 * @returns {{ html: ResolvedConfig["html"], prewarm: Record<string, unknown> }}
 */
function normalizeCache(raw) {
  /** @type {ResolvedConfig["html"]} */
  const html = [];

  for (const [source, seconds] of Object.entries(raw?.html ?? {})) {
    const pattern = compilePattern(source);
    const value = Number(seconds);
    if (!pattern || !Number.isFinite(value) || value < 0) continue;
    html.push({ pattern, seconds: value });
  }

  return { html, prewarm: { ...DEFAULT_PREWARM, ...(raw?.prewarm ?? {}) } };
}

/**
 * Dizin adlarını mutlak yola çevirir. `styles` bir dosya yolu olduğu için
 * de aynı çözümlemeden geçer; ayrı bir alan tutmaya değmez.
 *
 * @param {string} root
 * @param {Record<string, string>} [overrides]
 * @returns {Record<string, string>}
 */
function resolveDirs(root, overrides) {
  /** @type {Record<string, string>} */
  const dirs = {};
  const merged = { ...DEFAULT_DIRS, ...(overrides ?? {}) };

  for (const [key, value] of Object.entries(merged)) {
    dirs[key] = path.resolve(root, value);
  }

  // Build çıktısı `public/assets` altına yazılır; ayrı ayar gerektirmeyecek
  // kadar sabit ama yol hesabı tek yerde kalsın.
  dirs.assets = path.join(dirs.public, "assets");
  dirs.fonts = path.join(dirs.public, "fonts");

  return dirs;
}

/**
 * Uygulamanın layout'u yoksa framework'ün minimal layout'u kullanılır. Bu
 * sayede yeni bir proje tek bir route ile çalışır hâle gelir.
 *
 * @param {Record<string, string>} dirs
 * @param {string} [override]
 * @returns {string}
 */
function resolveLayout(dirs, override) {
  if (override) return path.resolve(dirs.views, "..", override);

  const appLayout = path.join(dirs.views, "layout.ejs");
  if (fs.existsSync(appLayout)) return appLayout;

  return path.join(FRAMEWORK_ROOT, "src", "templates", "layout.ejs");
}

/**
 * Config'i okur, normalize eder ve modül durumuna yazar. Sunucu ve build
 * süreçleri açılışta bir kez çağırır.
 *
 * Aynı süreçte ikinci çağrı önbelleğe düşer: `jskelet start` hem
 * `ensure-build` hem `createApp` üzerinden çağırıyor ve config'i iki kez
 * okuyup iki kez loglamanın hiçbir faydası yok. Yeniden okumak gerekiyorsa
 * `force: true`.
 *
 * @param {{ root?: string, configFile?: string, force?: boolean }} [options]
 * @returns {Promise<ResolvedConfig>}
 */
export async function loadConfig(options = {}) {
  if (config && !options.force) return config;

  const root = path.resolve(options.root ?? process.cwd());
  const configFile = options.configFile ?? CONFIG_FILE;
  const configPath = path.join(root, configFile);

  /** @type {Record<string, any>} */
  let source = {};
  let loaded = false;

  if (!fs.existsSync(configPath)) {
    console.warn(
      `[config] ${configFile} bulunamadı — yerleşik varsayılanlarla devam ediliyor.`,
    );
  } else {
    try {
      // Windows'ta mutlak yol import'u için file:// şeması gerekir.
      const module = await import(pathToFileURL(configPath).href);
      source = module.default ?? module;
      loaded = true;
    } catch (error) {
      console.warn(`[config] ${configFile} yüklenemedi, yok sayıldı`, error);
    }
  }

  /** @param {string} name */
  const section = async (name) => {
    const value = source?.[name];
    if (value == null) return null;
    try {
      return typeof value === "function" ? await value.call(source) : value;
    } catch (error) {
      console.warn(`[config] ${name}() hata verdi, yok sayıldı`, error);
      return null;
    }
  };

  const [headers, redirects, rewrites, cache] = await Promise.all([
    section("headers"),
    section("redirects"),
    section("rewrites"),
    section("cache"),
  ]);

  const { html, prewarm } = normalizeCache(cache);
  const dirs = resolveDirs(root, source.paths);

  config = {
    root,
    loaded,
    dirs,
    headers: normalizeHeaders(headers),
    redirects: normalizeRedirects(redirects),
    rewrites: normalizeRewrites(rewrites),
    html,
    prewarm,
    brand: { ...DEFAULT_BRAND, ...(source.brand ?? {}) },
    hooks: source.hooks ?? {},
    layout: resolveLayout(dirs, source.layout),
    routes: Array.isArray(source.routes) ? source.routes : null,
    static: {
      extensions: new Set(source.static?.extensions ?? DEFAULT_STATIC.extensions),
      prefixes: source.static?.prefixes ?? DEFAULT_STATIC.prefixes,
    },
    devGateBypass: source.devGateBypass ?? DEFAULT_DEV_GATE_BYPASS,
    preconnect: source.preconnect ?? [],
    prewarmSkip: source.prewarmSkip ?? DEFAULT_PREWARM_SKIP,
    // `routes`, `views` ve `lib` zaten izlenir; buraya yalnızca ek dizinler.
    watch: source.watch ?? [],
    // Build tarafı ayarları. Sunucu bunları okumaz ama config tek dosya
    // olsun diye aynı yerden geçer.
    fonts: source.fonts ?? [],
    icons: source.icons ?? {},
    images: source.images ?? {},
    clientEnv: source.clientEnv ?? [],
  };

  // Dev'de build ve sunucu ayrı alt süreçler; üçü de aynı özeti basınca satır
  // banner'ın ve build bloğunun arasına üç kez giriyor. Özeti dış süreç basar.
  if (loaded && !process.env.JSKELET_CHILD) {
    const counts = [
      config.headers.length && `${config.headers.length} header`,
      config.redirects.length && `${config.redirects.length} redirect`,
      config.rewrites.length && `${config.rewrites.length} rewrite`,
      config.html.length && `${config.html.length} cache kuralı`,
    ].filter(Boolean);

    if (counts.length) {
      console.log(`[config] ${configFile} yüklendi — ${counts.join(", ")}`);
    }
  }

  return config;
}

/**
 * Çözümlenmiş config. `loadConfig()` çağrılmadan erişilirse boş bir proje
 * kökü varsayımıyla çalışmak yerine hata verir: sessiz yanlış yol,
 * "stylesheet neden yok" gibi teşhisi zor sorunlara dönüşüyor.
 *
 * @returns {ResolvedConfig}
 */
export function getConfig() {
  if (!config) {
    throw new Error(
      "[config] loadConfig() çağrılmadan getConfig() kullanıldı. " +
        "Sunucuyu `jskelet` CLI ile ya da createApp() üzerinden başlatın.",
    );
  }
  return config;
}

/**
 * Uygulamanın tanımladığı hook'u çalıştırır; yoksa `fallback` döner.
 * Hook'un hata vermesi sayfayı düşürmemeli — framework kendi varsayılanına
 * geri döner ve uyarır.
 *
 * @template T
 * @param {string} name
 * @param {T} fallback
 * @param {unknown[]} args
 * @returns {Promise<T>}
 */
export async function hook(name, fallback, ...args) {
  const fn = getConfig().hooks?.[name];
  if (typeof fn !== "function") return fallback;

  try {
    return await fn(...args);
  } catch (error) {
    console.warn(`[config] hooks.${name}() hata verdi, varsayılan kullanıldı`, error);
    return fallback;
  }
}
