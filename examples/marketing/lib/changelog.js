/**
 * Sürüm notlarının veri katmanı. Liste elle yazılmıyor: kurulu paketin
 * `CHANGELOG.md` dosyası ayrıştırılıyor — `lib/docs.js` belgeler için ne
 * yapıyorsa aynısı. Böylece paket yükseldiğinde sürüm sayfası kendiliğinden
 * güncelleniyor ve aynı metni iki yerde tutmak gerekmiyor.
 *
 * Beklenen biçim Keep a Changelog: `## [0.1.1] - 2026-08-30` başlıkları,
 * altında `### Added` / `### Changed` / `### Fixed` / `### Removed` /
 * `### Breaking` bölümleri ve `-` ile başlayan maddeler.
 */
import fs from "node:fs";
import path from "node:path";

import { getConfig } from "jskelet";

import { plain, renderInline } from "./markdown.js";

/**
 * @typedef {object} ChangeGroup
 * @property {string} type `added` | `changed` | `fixed` | `removed` | `breaking`
 * @property {string[]} items Madde metinleri; satır içi markdown korunur
 *
 * @typedef {object} ChangelogEntry
 * @property {string} version `0.1.1` ya da `unreleased`
 * @property {string} date ISO tarih; başlıkta tarih yoksa boş
 * @property {boolean} unreleased Henüz yayınlanmamış bölüm mü
 * @property {string} summary Sürüm başlığının altındaki serbest paragraf
 * @property {ChangeGroup[]} groups
 */

/** Tanınan bölüm başlıkları. Başkası varsa `changed` gibi gösterilir. */
const TYPES = new Set(["added", "changed", "fixed", "removed", "breaking"]);

/** @type {ChangelogEntry[] | null} */
let memo = null;

/**
 * Kurulu paketin sürüm notları, en yeniden eskiye.
 *
 * Sonuç süreç belleğinde: HTML cache sayfanın tamamını tutuyor ama cache
 * boşaltıldığında dosyayı yeniden ayrıştırmanın anlamı yok.
 *
 * @returns {ChangelogEntry[]}
 */
export function getChangelog() {
  if (memo) return memo;

  const source = read();
  memo = source ? parse(source) : [];
  return memo;
}

/**
 * Madde metnini HTML'e çevirir: `` `route()` `` gibi kod parçaları ve
 * bağlantılar dosyada markdown olarak yazılıyor, sayfada da öyle görünmeli.
 *
 * @param {string} item
 * @returns {string}
 */
export function renderChange(item) {
  return renderInline(item);
}

/**
 * @param {string} source
 * @returns {ChangelogEntry[]}
 */
function parse(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  /** @type {ChangelogEntry[]} */
  const entries = [];
  /** @type {ChangelogEntry | null} */
  let entry = null;
  /** @type {ChangeGroup | null} */
  let group = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // Dosya sonundaki `[Unreleased]: https://…` bağlantı tanımları.
    if (/^\[[^\]]+]:\s/.test(line)) continue;

    const version = /^##\s+\[?([^\]\s]+)]?(?:\s+[-–]\s+(\S+))?/.exec(line);
    if (version) {
      const label = version[1];
      const unreleased = label.toLowerCase() === "unreleased";

      entry = {
        version: unreleased ? "unreleased" : label,
        date: version[2] ?? "",
        unreleased,
        summary: "",
        groups: [],
      };
      group = null;
      entries.push(entry);
      continue;
    }

    if (!entry) continue;

    const heading = /^###\s+(.+)$/.exec(line);
    if (heading) {
      const type = plain(heading[1]).toLowerCase();
      group = { type: TYPES.has(type) ? type : "changed", items: [] };
      entry.groups.push(group);
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet && group) {
      // Bir madde birden çok satıra sarılabiliyor; girintili devam satırları
      // aynı maddeye ekleniyor.
      const parts = [bullet[1].trim()];
      while (/^\s{2,}\S/.test(lines[index + 1] ?? "")) {
        index += 1;
        parts.push(lines[index].trim());
      }
      group.items.push(parts.join(" "));
      continue;
    }

    // Sürüm başlığı ile ilk bölüm arasındaki paragraf özet sayılıyor.
    if (!group && line.trim() && !line.startsWith("#")) {
      entry.summary = entry.summary ? `${entry.summary} ${line.trim()}` : line.trim();
    }
  }

  // Maddesi olmayan bölümler ve tamamen boş sürümler listeye girmez: dosyada
  // başlık bırakılmış olabiliyor ve boş bir kart okuyucuya hiçbir şey anlatmaz.
  return entries
    .map((item) => ({
      ...item,
      groups: item.groups.filter((candidate) => candidate.items.length > 0),
    }))
    .filter((item) => item.groups.length > 0 || item.summary);
}

/**
 * @returns {string | null}
 */
function read() {
  const file = path.join(
    getConfig().root,
    "node_modules",
    "jskelet",
    "CHANGELOG.md",
  );

  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    // Paket başka bir yerden çözülüyor olabilir. Sayfa yine açılır: sürüm
    // künyesi durur, liste boş kalır.
    return null;
  }
}
