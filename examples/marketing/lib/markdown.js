/**
 * Küçük bir markdown çeviricisi. Bağımlılık eklemek yerine burada durmasının
 * gerekçesi kapsam: belgeler tek bir yazarın elinden çıkıyor ve yalnızca
 * başlık, paragraf, liste, tablo, kod bloğu, bağlantı, kalın metin ve satır
 * içi kod kullanıyor. Genel amaçlı bir ayrıştırıcının geri kalanı (dipnot,
 * gömülü HTML, tanım listesi) bu sitede hiç çalışmayacak koda dönüşürdü.
 *
 * Güvenlik modeli tek cümleyle: **kaynak metnin hiçbir parçası HTML olarak
 * geçmez.** Her metin `esc()` üzerinden çıkar ve etiketler yalnızca bu dosyada
 * üretilir. Belgeler depodan geliyor, yani bugün güvenilir; ama aynı çevirici
 * yarın bir CMS'e bağlanırsa gömülü HTML'e izin veren bir satır doğrudan XSS
 * olurdu.
 */
import { esc } from "jskelet/html";

/**
 * @typedef {object} TocEntry
 * @property {string} id Başlığın anchor'ı
 * @property {string} text Görünen metin
 * @property {number} level 2 ya da 3
 *
 * @typedef {object} RenderedMarkdown
 * @property {string} title İlk `#` başlığı; şablon sayfa başlığı olarak kullanır
 * @property {string} intro Başlıktan sonraki ilk paragrafın düz metni
 * @property {string} html Gövde HTML'i (`#` başlığı dışarıda bırakılır)
 * @property {TocEntry[]} toc "Bu sayfada" listesi
 *
 * @typedef {object} RenderOptions
 * @property {(href: string) => string} [resolveLink] Bağlantı hedefini çevirir
 * @property {{ idle: string, done: string, failed: string }} [copy]
 *   Kod bloklarındaki kopyalama düğmesinin metinleri; verilmezse düğme basılmaz
 */

/** Türkçe harfleri anchor'da kullanılabilir hâle getiren eşleme. */
const FOLD = {
  ç: "c",
  ğ: "g",
  ı: "i",
  i̇: "i",
  ö: "o",
  ş: "s",
  ü: "u",
  â: "a",
  î: "i",
  û: "u",
};

/**
 * Markdown kaynağını HTML'e çevirir.
 *
 * @param {string} source
 * @param {RenderOptions} [options]
 * @returns {RenderedMarkdown}
 */
export function renderMarkdown(source, options = {}) {
  const lines = String(source).replace(/\r\n/g, "\n").split("\n");
  const state = {
    resolveLink: options.resolveLink ?? ((href) => href),
    copy: options.copy,
    /** Aynı başlık metni iki kez geçtiğinde anchor'ların çakışmaması için. */
    used: new Map(),
    /** @type {TocEntry[]} */
    toc: [],
  };

  /** @type {string[]} */
  const html = [];
  let title = "";
  let intro = "";
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const fence = readFence(lines, index);
      html.push(renderCode(fence.code, fence.language, state));
      index = fence.next;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();

      // `#` sayfanın adı: şablon onu kendi düzeninde basıyor, gövdede
      // tekrarlamak iki h1 demek olurdu.
      if (level === 1 && !title) {
        title = plain(text);
        index += 1;
        continue;
      }

      html.push(renderHeading(level, text, state));
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = readTable(lines, index);
      html.push(renderTable(table.rows, table.align, state));
      index = table.next;
      continue;
    }

    if (listMarker(line)) {
      const list = readList(lines, index);
      html.push(renderList(list.items, list.ordered, state));
      index = list.next;
      continue;
    }

    const paragraph = readParagraph(lines, index);
    if (!intro) intro = plain(paragraph.text);
    html.push(`<p>${inline(paragraph.text, state)}</p>`);
    index = paragraph.next;
  }

  return { title, intro, html: html.join("\n"), toc: state.toc };
}

/**
 * Bir başlık metninden anchor üretir. Sunucuda üretilmesi önemli: "bu sayfada"
 * listesi ile başlıkların id'leri aynı fonksiyondan çıkmazsa bağlantılar
 * sessizce hiçbir yere gitmez.
 *
 * @param {string} value
 * @returns {string}
 */
export function slugify(value) {
  return (
    plain(value)
      .toLowerCase()
      .replace(/[çğıiöşüâîû]/g, (char) => FOLD[char] ?? char)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/**
 * Markdown işaretlerini atıp düz metin bırakır: `<title>` ve meta açıklaması
 * HTML kabul etmiyor.
 *
 * @param {string} value
 * @returns {string}
 */
export function plain(value) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

/**
 * @param {string} line
 * @returns {{ ordered: boolean, text: string } | null}
 */
function listMarker(line) {
  const unordered = /^[-*]\s+(.*)$/.exec(line);
  if (unordered) return { ordered: false, text: unordered[1] };

  const ordered = /^\d+\.\s+(.*)$/.exec(line);
  if (ordered) return { ordered: true, text: ordered[1] };

  return null;
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ code: string, language: string, next: number }}
 */
function readFence(lines, start) {
  const language = lines[start].slice(3).trim();
  const body = [];
  let index = start + 1;

  while (index < lines.length && !lines[index].startsWith("```")) {
    body.push(lines[index]);
    index += 1;
  }

  // Kapanışı olmayan bir blok dosyanın sonuna kadar kod sayılır; belgeyi
  // yarıda kesmek yerine böyle davranmak yazım hatasını görünür kılıyor.
  return { code: body.join("\n"), language, next: index + 1 };
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {boolean}
 */
function isTableStart(lines, start) {
  if (!lines[start].trimStart().startsWith("|")) return false;
  const next = lines[start + 1];
  return Boolean(next && /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(next));
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ rows: string[][], align: Array<"left" | "center" | "right">, next: number }}
 */
function readTable(lines, start) {
  const align = splitRow(lines[start + 1]).map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  });

  const rows = [splitRow(lines[start])];
  let index = start + 2;

  while (index < lines.length && lines[index].trimStart().startsWith("|")) {
    rows.push(splitRow(lines[index]));
    index += 1;
  }

  return { rows, align, next: index };
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Liste öğeleri. Devam satırları (girintili ya da işaretsiz) aynı öğeye
 * eklenir: belgeler 80 kolona sarıldığı için tek bir madde sık sık iki satıra
 * yayılıyor ve her satırı ayrı `<li>` yapmak listeyi anlamsızlaştırırdı.
 *
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ items: string[], ordered: boolean, next: number }}
 */
function readList(lines, start) {
  const first = listMarker(lines[start]);
  const ordered = Boolean(first?.ordered);
  const items = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) break;

    const marker = listMarker(line);
    if (marker) {
      // Sıralı ve sırasız liste yan yana geldiğinde ikincisi yeni bir blok.
      if (marker.ordered !== ordered) break;
      items.push(marker.text);
      index += 1;
      continue;
    }

    if (!items.length) break;
    items[items.length - 1] += ` ${line.trim()}`;
    index += 1;
  }

  return { items, ordered, next: index };
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ text: string, next: number }}
 */
function readParagraph(lines, start) {
  const body = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) break;
    if (line.startsWith("```")) break;
    if (/^#{1,6}\s/.test(line)) break;
    if (listMarker(line)) break;
    if (line.trimStart().startsWith("|")) break;

    body.push(line.trim());
    index += 1;
  }

  return { text: body.join(" "), next: index };
}

/**
 * @param {number} level
 * @param {string} text
 * @param {object} state
 * @returns {string}
 */
function renderHeading(level, text, state) {
  const base = slugify(text);
  const seen = state.used.get(base) ?? 0;
  state.used.set(base, seen + 1);
  const id = seen ? `${base}-${seen + 1}` : base;

  // Yalnızca h2 ve h3 sağdaki listeye giriyor: h4 başlıkları belgelerde tek
  // bir tabloyu ya da alanı adlandırıyor ve listeyi okunmaz hâle getiriyor.
  if (level === 2 || level === 3) {
    state.toc.push({ id, text: plain(text), level });
  }

  const tag = `h${Math.min(level, 6)}`;

  // Başlığın kendisi bağlantı: adres çubuğuna bölüm anchor'ını almanın en kısa
  // yolu ve JS gerektirmiyor.
  return `<${tag} id="${esc(id)}"><a class="doc-anchor" href="#${esc(id)}">${inline(text, state)}</a></${tag}>`;
}

/**
 * @param {string} code
 * @param {string} language
 * @param {object} state
 * @returns {string}
 */
function renderCode(code, language, state) {
  const label = language
    ? `<span class="doc-code-language">${esc(language)}</span>`
    : "";

  const copy = state.copy
    ? `<button
        type="button"
        data-island="copy-command"
        data-island-props='${esc(
          JSON.stringify({
            text: code,
            done: state.copy.done,
            failed: state.copy.failed,
          }),
        )}'
        class="doc-code-copy"
      >${esc(state.copy.idle)}</button>`
    : "";

  return `<div class="doc-code">
    <div class="doc-code-bar">${label}${copy}</div>
    <pre><code>${esc(code)}</code></pre>
  </div>`;
}

/**
 * @param {string[][]} rows
 * @param {Array<"left" | "center" | "right">} align
 * @param {object} state
 * @returns {string}
 */
function renderTable(rows, align, state) {
  const [head, ...body] = rows;

  const headCells = head
    .map(
      (cell, column) =>
        `<th scope="col" style="text-align:${align[column] ?? "left"}">${inline(cell, state)}</th>`,
    )
    .join("");

  const bodyRows = body
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell, column) =>
              `<td style="text-align:${align[column] ?? "left"}">${inline(cell, state)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");

  // Tablolar belgelerde geniş: sarmalayıcı olmadan mobilde sayfanın tamamını
  // yatay kaydırılır hâle getiriyorlar.
  return `<div class="doc-table"><table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
}

/**
 * @param {string[]} items
 * @param {boolean} ordered
 * @param {object} state
 * @returns {string}
 */
function renderList(items, ordered, state) {
  const tag = ordered ? "ol" : "ul";
  const body = items
    .map((item) => `<li>${inline(item, state)}</li>`)
    .join("");

  return `<${tag}>${body}</${tag}>`;
}

/**
 * Satır içi biçimleme. Sıra önemli: kod parçaları önce yer tutucuya alınıyor,
 * böylece bir `` `**` `` örneği kalın metne dönüşmüyor.
 *
 * @param {string} text
 * @param {object} state
 * @returns {string}
 */
function inline(text, state) {
  /** @type {string[]} */
  const codes = [];

  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = esc(out);

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const target = state.resolveLink(unescapeAttribute(href));
    const external = /^https?:\/\//.test(target);
    const extra = external ? ' rel="noopener" target="_blank"' : "";
    return `<a href="${esc(target)}"${extra}>${label}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>");

  return out.replace(
    /\u0000(\d+)\u0000/g,
    (_, position) => `<code>${esc(codes[Number(position)])}</code>`,
  );
}

/**
 * Bağlantı hedefi `esc()` sonrası yakalandığı için `&amp;` gibi diziler geri
 * çevrilmeli; aksi hâlde query string taşıyan bir adres bozulur.
 *
 * @param {string} value
 * @returns {string}
 */
function unescapeAttribute(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
