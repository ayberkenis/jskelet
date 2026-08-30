/**
 * Markdown kaynaklarının (belgeler ve sürüm notları) tek okuma kapısı.
 *
 * Dosyalar depodan, GitHub'ın raw ucundan çekiliyor. Gerekçesi dağıtım:
 * `node_modules/` üretim imajına girmediği (ya da `--omit` ile budandığı)
 * kurulumlarda paketin `docs/` dizini sunucuda bulunmuyor ve site belgeleri
 * servis edemiyordu. Kaynağı depo yapınca dağıtım biçimi ne olursa olsun içerik
 * yerinde kalıyor.
 *
 * Ağ tek nokta arıza olmasın diye üretimde üç kademe var:
 *   1. Süreç belleğindeki taze kopya (TTL boyunca ağa çıkılmaz),
 *   2. GitHub raw,
 *   3. Kurulu paketin kendi dosyası — çevrimdışı sunucu, GitHub kesintisi.
 *
 * Ağ başarısız olur ama bellekte eskimiş bir kopya varsa o kullanılır: bir
 * kesinti sırasında eski belgeyi göstermek, hiç göstermemekten iyidir.
 *
 * Geliştirmede sıra tersine döner ve önbellek devre dışıdır; markdown üzerinde
 * çalışırken dosyanın diskteki hâli görünür.
 */
import fs from "node:fs";
import path from "node:path";

import { getConfig } from "jskelet";

/** Depodaki dal ya da etiket. Sabit bir sürüme çakmak için `DOCS_REF` verilir. */
const REF = process.env.DOCS_REF ?? "master";

const RAW_BASE = `https://raw.githubusercontent.com/ayberkenis/jskelet/${REF}`;

/** İçerik saatte bir yenilenir; HTML cache zaten sayfaları bir saat tutuyor. */
const TTL = 60 * 60 * 1000;

const TIMEOUT = 5000;

/** @type {Map<string, { text: string, at: number }>} */
const memo = new Map();

/**
 * Depodaki bir metin dosyasını okur.
 *
 * @param {string} file Depo köküne göre POSIX yol: `docs/en/03-routing.md`
 * @returns {Promise<string | null>} Hiçbir kaynaktan okunamazsa `null`
 */
export async function readSource(file) {
  // Geliştirmede sıra tersine döner ve önbelleğe alınmaz: belge üzerinde
  // çalışırken kaydettiğin dosyayı görmek istersin, dala gönderilmiş hâlini
  // değil.
  if (process.env.NODE_ENV !== "production") {
    const local = readLocal(file);
    if (local !== null) return local;
  }

  const hit = memo.get(file);
  if (hit && Date.now() - hit.at < TTL) return hit.text;

  const remote = await fetchRaw(file);
  if (remote !== null) {
    memo.set(file, { text: remote, at: Date.now() });
    return remote;
  }

  // Ağ yok: elde bir kopya varsa yaşını sormadan onu ver.
  if (hit) return hit.text;

  const local = readLocal(file);
  if (local !== null) memo.set(file, { text: local, at: Date.now() });
  return local;
}

/**
 * @param {string} file
 * @returns {Promise<string | null>}
 */
async function fetchRaw(file) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(`${RAW_BASE}/${file}`, {
      signal: controller.signal,
    });

    // 404 de bir cevap: dosya adı yanlışsa çağıran taraf yerel kopyaya düşer.
    if (!response.ok) return null;

    return await response.text();
  } catch {
    // Ağ yok, DNS çözülmedi ya da zaman aşımı.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} file
 * @returns {string | null}
 */
function readLocal(file) {
  const absolute = path.join(
    getConfig().root,
    "node_modules",
    "jskelet",
    ...file.split("/"),
  );

  try {
    return fs.readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
}
