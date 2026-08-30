/**
 * JSkelet konsol çıktısı.
 *
 * İki ayrı bölge vardır ve karışmazlar:
 *   1. Başlangıç — banner, hizalı build satırları, "Ready" özeti.
 *   2. Çalışma anı — zaman damgalı, tek satırlık olaylar (HTTP, rebuild, restart).
 *
 * Renk anlam taşır: ✓ yeşil, ✖ kırmızı, ⚠ sarı, ↻ cyan; süre ve yol gri,
 * önemli değerler beyaz/bold. Dekoratif renk kullanılmaz.
 *
 * Build ve dev script'leri bu modülü paylaşır; alt süreçlerde renk
 * algılanamadığı için `JSKELET_COLOR=1` ile zorlanabilir.
 */
import process from "node:process";

const stream = process.stdout;
const isTTY = Boolean(stream.isTTY);
const useColor =
  !process.env.NO_COLOR && (isTTY || process.env.JSKELET_COLOR === "1");

/**
 * @param {string} open
 * @returns {(text: string) => string}
 */
function color(open) {
  return (text) => (useColor ? `\u001b[${open}m${text}\u001b[0m` : String(text));
}

export const c = {
  bold: color("1"),
  dim: color("2"),
  red: color("31"),
  green: color("32"),
  yellow: color("33"),
  blue: color("34"),
  magenta: color("35"),
  cyan: color("36"),
  gray: color("90"),
};

export const symbols = {
  ok: c.green("✓"),
  fail: c.red("✖"),
  warn: c.yellow("⚠"),
  cycle: c.cyan("↻"),
  ready: c.green("✔"),
  arrow: c.cyan("→"),
};

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Hizalama genişlikleri: her satır aynı ızgaraya oturur. */
const LABEL = 12;
const DETAIL = 20;
const TIME = 7;

/** @param {number} value */
export function ms(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

/** @param {number} bytes */
export function size(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} kB`;
}

/** @param {string} text */
function write(text) {
  stream.write(text);
}

function clearLine() {
  if (isTTY) write("\r\u001b[2K");
}

/**
 * Saat, yerelden bağımsız olarak 24 saatlik biçimde. Dil etiketi vermek
 * sunucunun bulunduğu makinenin diline göre `ÖÖ/ÖS` ya da `AM/PM` basılmasına
 * yol açıyordu; log satırının genişliği sabit kalmalı.
 *
 * @returns {string} `01:49:02`
 */
export function clock() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

/**
 * @param {string} version
 * @param {string} mode
 * @param {string} [root]
 */
export function banner(version, mode, root) {
  write(`\n ${c.bold(c.cyan("◆ JSkelet"))} ${c.bold(version)}\n`);
  write(`   ${c.dim(mode)}${root ? ` ${c.gray("·")} ${c.gray(root)}` : ""}\n`);
}

/** @param {string} title */
export function section(title) {
  write(`\n  ${c.bold(c.gray(title.toUpperCase()))}\n`);
}

/**
 * Hizalı build satırı.
 * @param {string} symbol
 * @param {string} label
 * @param {string} detail
 * @param {string} time
 */
function row(symbol, label, detail, time) {
  return (
    `  ${symbol} ${c.bold(label.padEnd(LABEL))} ` +
    `${detail.padEnd(DETAIL)} ${c.gray(time.padStart(TIME))}`
  );
}

/**
 * Adım sürerken biriken ek satırlar; spinner'ı bozmasın diye adım bitince
 * dökülür. İlk ayrıntı satırı hizalı sütuna yazılır, kalanlar altına.
 *
 * @type {string[] | null}
 */
let pending = null;

function flush() {
  const lines = pending?.slice(1) ?? [];
  pending = null;
  for (const line of lines) write(`      ${c.gray("·")} ${c.dim(line)}\n`);
}

/**
 * Build adımı. TTY'de spinner döner; bitince satır aynı ızgaraya oturur.
 *
 * @param {string} label
 * @returns {{ done: (detail?: string) => number, fail: (error: unknown) => void }}
 */
export function task(label) {
  pending = [];

  const started = Date.now();
  let frame = 0;

  const paint = () => {
    clearLine();
    write(row(c.cyan(FRAMES[frame]), label, c.dim(pending?.[0] ?? ""), ""));
    frame = (frame + 1) % FRAMES.length;
  };

  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  if (isTTY) {
    paint();
    timer = setInterval(paint, 80);
    timer.unref?.();
  }

  const finish = (line) => {
    if (timer) clearInterval(timer);
    clearLine();
    write(`${line}\n`);
    flush();
  };

  return {
    done(detail) {
      const elapsed = Date.now() - started;
      finish(row(symbols.ok, label, detail ?? pending?.[0] ?? "", ms(elapsed)));
      return elapsed;
    },
    fail(error) {
      finish(row(symbols.fail, label, c.red(String(error?.message ?? error)), ""));
    },
  };
}

/**
 * Adımın sütununa yazılacak kısa özet; ikinci ve sonraki çağrılar alt satıra
 * düşer. Adım dışında çağrılırsa doğrudan basılır.
 *
 * @param {string} text
 */
export function detail(text) {
  if (pending) {
    pending.push(text);
    return;
  }
  write(`      ${c.gray("·")} ${c.dim(text)}\n`);
}

/**
 * Sütuna yazılacak özeti, adım içinde daha önce ayrıntı basılmış olsa bile
 * öne alır (ör. font indirme satırlarından sonra "4/4 weights").
 *
 * @param {string} text
 */
export function summary(text) {
  if (pending) {
    pending.unshift(text);
    return;
  }
  detail(text);
}

/** @param {string} text */
export function warn(text) {
  if (pending) {
    pending.push(`${symbols.warn} ${text}`);
    return;
  }
  write(`  ${symbols.warn} ${text}\n`);
}

/**
 * Bölüm gövdesindeki düz satır (ör. çıktı boyutları).
 * @param {string} text
 */
export function line(text) {
  write(`    ${c.dim(text)}\n`);
}

/** @param {string} text */
export function error(text) {
  write(`  ${symbols.fail} ${c.red(text)}\n`);
}

/**
 * Başlangıç özeti: süre, adres ve watch durumu.
 *
 * @param {{ elapsed: number, url?: string | null, watching?: boolean, label?: string }} info
 */
export function ready({ elapsed, url, watching, label = "Ready" }) {
  write(`\n  ${symbols.ready} ${c.bold(`${label} in ${ms(elapsed)}`)}\n`);
  if (url) write(`  ${symbols.arrow} ${c.cyan(url)}\n`);
  if (watching) write(`  ${symbols.cycle} ${c.dim("Watching for changes")}\n`);
  write("\n");
}

/**
 * Çalışma anı olayı: `01:49:03  ✓ css        rebuilt   195.9 kB   150ms`
 *
 * Hizalama ANSI kodlarından etkilenmesin diye `message` düz metin olmalı;
 * ek bilgi `note` ile geçilir.
 *
 * @param {{ symbol?: string, scope: string, message: string, note?: string, time?: number | null }} info
 */
export function event({ symbol = symbols.ok, scope, message, note, time = null }) {
  const body = `${message}${note ? `  ${note}` : ""}`;
  const padding = " ".repeat(Math.max(1, DETAIL - body.length));

  write(
    `${c.gray(clock())}  ${symbol} ${c.bold(scope.padEnd(10))} ` +
    `${message}${note ? `  ${c.dim(note)}` : ""}${padding}` +
    `${c.gray((time == null ? "" : ms(time)).padStart(TIME))}\n`,
  );
}

/**
 * HTTP isteği. Cache bilgisi yalnızca gerçekten anlamlıysa (HIT) gösterilir;
 * her satıra MISS yazmak akışı okunmaz hâle getiriyor.
 *
 * @param {{ method: string, url: string, status: number, ms: number, cache?: string | null }} info
 */
export function http(info) {
  const tint =
    info.status >= 500 ? c.red : info.status >= 400 ? c.yellow : c.green;

  write(
    `${c.gray(clock())}  ${c.bold(info.method.padEnd(6))}` +
    `${c.gray(truncate(info.url, 28).padEnd(30))}` +
    `${tint(String(info.status))} ${c.gray(ms(info.ms).padStart(TIME))}` +
    `${info.cache === "HIT" ? ` ${c.dim("cached")}` : ""}\n`,
  );
}

/**
 * @param {string} text
 * @param {number} max
 */
function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Kutunun içi sabit genişlikte; uzun satırlar kırpılır. */
const BOX = 52;

/**
 * Çerçeveli hata kutusu — kendi framework'ünü geliştirirken hatanın
 * akış içinde kaybolmaması için.
 *
 * @param {{ title: string, name: string, message: string, lines?: string[] }} info
 */
export function errorBox({ title, name, message, lines = [] }) {
  const top = `┌─ ${title} ${"─".repeat(Math.max(0, BOX - title.length - 3))}┐`;
  const bottom = `└${"─".repeat(BOX)}┘`;

  /** @param {string} text @param {(value: string) => string} [tint] */
  const line = (text, tint = (value) => value) => {
    const clipped = truncate(text, BOX - 4);
    write(
      `${c.red("│")}  ${tint(clipped)}${" ".repeat(BOX - 4 - clipped.length)}  ${c.red("│")}\n`,
    );
  };

  write(`\n${c.red(top)}\n`);
  line("");
  line(name, (value) => c.bold(c.red(value)));
  for (const part of wrap(message, BOX - 4)) line(part);
  if (lines.length) {
    line("");
    for (const part of lines) line(part, c.gray);
  }
  line("");
  write(`${c.red(bottom)}\n\n`);
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string[]}
 */
function wrap(text, max) {
  /** @type {string[]} */
  const out = [];
  let current = "";

  for (const word of String(text).split(/\s+/)) {
    if (!current.length) current = word;
    else if (`${current} ${word}`.length <= max) current += ` ${word}`;
    else {
      out.push(current);
      current = word;
    }
  }

  if (current) out.push(current);
  return out.length ? out : [""];
}
