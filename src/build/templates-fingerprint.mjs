/**
 * Şablon parmak izi: üretilen HTML'i şekillendiren kaynakların kısa hash'i.
 *
 * Paylaşımlı HTML önbelleğinin isim alanı (`getBuildId()`) yalnızca asset
 * manifest'inden türüyordu. CSS/JS'e dokunmayan bir layout değişikliği aynı
 * isim alanına düşüyor ve eski `<head>` Redis'ten TTL dolana kadar servis
 * ediliyordu — süreç yeniden başlasa, deploy yapılsa bile. Parmak izi bu
 * boşluğu kapatır.
 *
 * Kapsam: view kökleri altındaki `.jsk` / `.ejs` / bileşen `.js` / `.mjs`
 * dosyaları, kök dışında duruyorsa layout dosyası ve framework sürümü
 * (derleyici çıktısı, yerleşik etiketler ve varsayılan layout sürümle
 * değişir). Controller'lar ve config kapsam dışı: onların çıktıyı değiştirmesi
 * veriyle iç içe ve TTL / invalidation'ın işi.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { getViewRoots } from "../compile/resolve.js";
import { FRAMEWORK_VERSION } from "../version.mjs";

const SOURCE_EXTENSIONS = /\.(?:jsk|ejs|js|mjs)$/i;

/**
 * `.jskelet/templates/` altındaki kayıt; build'in Templates adımı yazar.
 * `src/compile` VS Code eklentisine olduğu gibi kopyalandığı için yazım
 * `compileAll` içinde değil: oradan `version.mjs`'e uzanmak eklentiyi kırar.
 */
export const FINGERPRINT_FILE = "build.json";

/** @type {{ root: string, id: string } | null} */
let cached = null;

/**
 * @param {string} dir
 * @param {string[]} out
 */
function collect(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      collect(full, out);
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) out.push(full);
  }
}

/**
 * Kaynaklardan parmak izini hesaplar. Dosyalar kök-göreli yolla sıralanır;
 * makineden makineye aynı ağaç aynı kimliği vermeli ki kümedeki node'lar aynı
 * isim alanını paylaşsın.
 *
 * @param {{ root: string, dirs: Record<string, string>, layout?: string }} config
 * @returns {string} 10 hex karakter.
 */
export function computeTemplatesFingerprint(config) {
  /** @type {string[]} */
  const files = [];
  for (const root of getViewRoots(config)) collect(root, files);
  if (config.layout && fs.existsSync(config.layout)) files.push(config.layout);

  const labelled = new Map();
  for (const file of files) {
    const label = path.relative(config.root, path.resolve(file)).split(path.sep).join("/");
    labelled.set(label, file);
  }

  const hash = crypto.createHash("sha256");
  hash.update(`jskelet@${FRAMEWORK_VERSION}\n`);
  for (const label of [...labelled.keys()].sort()) {
    hash.update(`${label}\0`);
    try {
      hash.update(fs.readFileSync(labelled.get(label)));
    } catch {
      // Tarama ile okuma arasında silinmiş dosya: adı yine kimliğe girer.
    }
    hash.update("\0");
  }

  return hash.digest("hex").slice(0, 10);
}

/**
 * Parmak izini derleme çıktısının yanına yazar.
 *
 * @param {{ root: string, dirs: Record<string, string>, layout?: string }} config
 * @param {string} outDir `.jskelet/templates`
 * @returns {string}
 */
export function writeTemplatesFingerprint(config, outDir) {
  const id = computeTemplatesFingerprint(config);
  fs.writeFileSync(
    path.join(outDir, FINGERPRINT_FILE),
    `${JSON.stringify({ id }, null, 2)}\n`,
    "utf8",
  );
  return id;
}

/**
 * Süreç ömrü boyunca sabit parmak izi.
 *
 * Production build'in yazdığı kaydı okur: cold start'ta view ağacını gezmek
 * istenmiyor (`ensureTemplatesCompiled` ile aynı gerekçe). Kayıt yoksa
 * (eski build, elle başlatılmış süreç) kaynaktan hesaplanır.
 *
 * Dev'de kayıt güvenilmez: watch yalnızca `.jsk` mtime'ına bakıyor, bir
 * bileşen `.js`'i ya da `.ejs` değiştiğinde dosya eskide kalır. Dev sunucusu
 * view değişikliğinde süreci yeniden başlattığı için açılışta kaynaktan
 * hesaplamak yeterli.
 *
 * @param {{ root: string, dirs: Record<string, string>, layout?: string }} config
 * @returns {string}
 */
export function getTemplatesFingerprint(config) {
  if (cached && cached.root === config.root) return cached.id;

  let id = "";
  if (process.env.NODE_ENV !== "development") {
    try {
      const file = path.join(config.dirs.generated, "templates", FINGERPRINT_FILE);
      const value = JSON.parse(fs.readFileSync(file, "utf8")).id;
      if (typeof value === "string" && value) id = value;
    } catch {
      // Kayıt yok; kaynağa düşülür.
    }
  }
  if (!id) id = computeTemplatesFingerprint(config);

  cached = { root: config.root, id };
  return id;
}
