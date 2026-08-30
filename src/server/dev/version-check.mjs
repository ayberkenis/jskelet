/**
 * npm kayıt defterindeki son sürümü yoklar ve dev overlay'e "outdated" bilgisi
 * verir. Yalnızca geliştirme sırasında çalışır.
 *
 * Sonuç geçici dizinde saklanıyor: `node --watch` sunucuyu sık yeniden
 * başlatıyor ve her açılışta ağa çıkmak hem yavaş hem gereksiz. Kayıt defteri
 * ulaşılamazsa sessizce eski/boş sonuç kullanılır — sürüm kontrolü hiçbir
 * koşulda dev akışını bekletmez ya da hata basmaz.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FRAMEWORK_PACKAGE, FRAMEWORK_VERSION } from "../../version.mjs";

const CACHE_FILE = path.join(os.tmpdir(), `jskelet-version-${FRAMEWORK_PACKAGE}.json`);

/** Aynı sürümü saatte birden fazla sormanın anlamı yok. */
const TTL = 6 * 60 * 60 * 1000;

const TIMEOUT = 3000;

/** @type {{ current: string, latest: string | null, outdated: boolean, checkedAt: number | null }} */
let state = {
  current: FRAMEWORK_VERSION,
  latest: null,
  outdated: false,
  checkedAt: null,
};

/**
 * Ön sürüm etiketleri (`1.2.0-beta.1`) karşılaştırmada yok sayılır: kayıt
 * defterinden yalnızca `latest` etiketi okunduğu için pratikte gelmiyor.
 * @param {string} a
 * @param {string} b
 * @returns {number} a > b ise pozitif
 */
function compare(a, b) {
  const parse = (value) =>
    String(value)
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);

  const left = parse(a);
  const right = parse(b);

  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff) return diff;
  }

  return 0;
}

/**
 * @param {string | null} latest
 */
function apply(latest) {
  state = {
    current: FRAMEWORK_VERSION,
    latest,
    outdated: Boolean(latest) && compare(latest, FRAMEWORK_VERSION) > 0,
    checkedAt: Date.now(),
  };
}

/** @returns {{ latest: string, checkedAt: number } | null} */
function readCache() {
  try {
    const saved = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    if (typeof saved.latest !== "string" || typeof saved.checkedAt !== "number") return null;
    return saved;
  } catch {
    return null;
  }
}

async function fetchLatest() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(FRAMEWORK_PACKAGE)}/latest`,
      {
        signal: controller.signal,
        headers: { accept: "application/vnd.npm.install-v1+json, application/json" },
      },
    );

    if (!response.ok) return;

    const body = await response.json();
    if (typeof body?.version !== "string") return;

    apply(body.version);
    try {
      fs.writeFileSync(
        CACHE_FILE,
        JSON.stringify({ latest: body.version, checkedAt: state.checkedAt }),
      );
    } catch {
      // Önbellek yazılamazsa yalnızca her açılışta yeniden sorulur.
    }
  } catch {
    // Ağ yok, kayıt defteri kapalı ya da zaman aşımı: sürüm bilgisi boş kalır.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kontrolü başlatır. Beklenmez; sonuç geldiğinde `versionStatus()` günceldir.
 * `JSKELET_VERSION_CHECK=0` ile tamamen kapatılabilir (çevrimdışı çalışma,
 * kurumsal ağlar).
 */
export function startVersionCheck() {
  if (process.env.JSKELET_VERSION_CHECK === "0") return;

  const cached = readCache();
  if (cached) {
    apply(cached.latest);
    state.checkedAt = cached.checkedAt;
    if (Date.now() - cached.checkedAt < TTL) return;
  }

  // Açılışta ağ isteği ilk isteğin önüne geçmesin.
  const timer = setTimeout(() => {
    fetchLatest();
  }, 1500);
  timer.unref?.();
}

/**
 * @returns {{ current: string, latest: string | null, outdated: boolean, checkedAt: number | null }}
 */
export function versionStatus() {
  return state;
}
