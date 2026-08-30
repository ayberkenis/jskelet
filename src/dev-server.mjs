/**
 * Geliştirme akışı: build watch + sunucu, tek terminalde.
 *
 * Alt süreçlerin çıktısı olduğu gibi akmaz. Build satırları başlangıç
 * bloğunda görünür; sonrası zaman damgalı tek satırlık olaylara indirgenir ve
 * hata yığınları çerçeveli kutuya dönüşür. Kendi framework'ünü geliştirirken
 * hatanın akış içinde kaybolmaması, gerçekten fark yaratan ayrıntı.
 *
 * NODE_ENV ataması da platformdan bağımsız olarak burada yapılır
 * (`cross-env` gerekmez).
 */
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import * as log from "./log.mjs";
import { loadConfig } from "./config/index.js";
import { FRAMEWORK_VERSION } from "./version.mjs";

const ROOT = process.cwd();
const SRC = import.meta.dirname;

const config = await loadConfig();

const env = {
  ...process.env,
  NODE_ENV: "development",
  JSKELET_CHILD: "1",
  // Alt süreçler boruya yazdığı için renk algılaması kapanır; burada zorlanır.
  ...(process.stdout.isTTY && !process.env.NO_COLOR ? { JSKELET_COLOR: "1" } : {}),
};

const started = Date.now();
let ready = false;
let buildReady = false;
/** @type {string | null} */
let serverUrl = null;
let restartedAt = 0;
let restarting = false;

log.banner(`v${FRAMEWORK_VERSION}`, "development", ROOT);

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

/** Yeniden başlatma sırasındaki beklenen çıkışı işaretler. */
const STOPPING = Symbol("jskelet.stopping");

/**
 * Satır tamponu: parça parça gelen çıktıyı tam satırlara böler.
 *
 * @param {import('node:stream').Readable} stream
 * @param {(line: string) => void} onLine
 */
function readLines(stream, onLine) {
  let buffer = "";

  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  });
}

/**
 * Build alt süreci kendi biçimini bastığı için satırları olduğu gibi geçer.
 * @param {string} line
 */
function onBuildLine(line) {
  if (line.includes("[jskelet:build-ready]")) {
    buildReady = true;
    announceReady();
    return;
  }

  if (line.trim()) process.stdout.write(`${line}\n`);
}

/**
 * "Ready" özeti hem build hem sunucu hazır olduğunda basılır; aksi hâlde
 * özet, arkadan gelen build satırlarının arasında kalıyor.
 */
function announceReady() {
  if (ready || !buildReady || !serverUrl) return;
  ready = true;

  log.ready({ elapsed: Date.now() - started, url: serverUrl, watching: true });
  log.event({
    symbol: log.symbols.cycle,
    scope: "devtools",
    message: "overlay ready",
    note: "Alt+D",
  });
}

/* ------------------------------------------------------- sunucu çıktısı */

/** @type {string[]} */
let errorBuffer = [];
/** @type {NodeJS.Timeout | null} */
let errorTimer = null;

/** Yığın satırları parça parça gelir; kısa bir sessizlikten sonra basılır. */
function scheduleErrorFlush() {
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(flushError, 60);
}

function flushError() {
  const lines = errorBuffer;
  errorBuffer = [];
  errorTimer = null;
  if (!lines.length) return;

  const header = lines.find((line) => /^[\w.]*Error\b/.test(line)) ?? lines[0];
  const match = header.match(/^([\w.]*Error)\b:?\s*(.*)$/);

  const frames = lines
    .filter((line) => line.trim().startsWith("at "))
    .slice(0, 3)
    .map((line) => line.trim().replace(new RegExp(escapeRegExp(ROOT), "g"), "."));

  log.errorBox({
    title: "Server Error",
    name: match?.[1] ?? "Error",
    message: match?.[2] || header,
    lines: frames,
  });

  log.event({ symbol: log.symbols.cycle, scope: "server", message: "watching" });
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} line
 * @param {boolean} isError
 */
function onServerLine(line, isError) {
  // Sunucunun dev araçları zaten bu modülün biçimini kullanıyor; renk kodları
  // satır başında olabildiği için karşılaştırma ANSI'siz yapılır.
  // eslint-disable-next-line no-control-regex -- ANSI escape'i eşlemenin yolu bu.
  const plain = line.replace(/\u001b\[\d+m/g, "");
  if (/^(?:\d{2}:\d{2}:\d{2}\s|[┌│└])/.test(plain)) {
    process.stdout.write(`${line}\n`);
    return;
  }

  const listening = line.match(/^jskelet → (\S+)/);
  if (listening) {
    serverUrl = listening[1];

    if (!ready) {
      announceReady();
      return;
    }

    if (!restarting) return;

    restarting = false;
    log.event({
      scope: "server",
      message: "restarted",
      time: restartedAt ? Date.now() - restartedAt : null,
    });
    return;
  }

  if (!line.trim()) return;

  // Hata gövdesi ve yığın satırları kutuya toplanır.
  if (isError || /^\s+at\s/.test(line) || /Error\b/.test(line)) {
    errorBuffer.push(
      line.replace(/^\[(?:uncaughtException|unhandledRejection)\]\s*/, ""),
    );
    scheduleErrorFlush();
    return;
  }

  log.event({ scope: "server", message: line });
}

/**
 * @param {string[]} args
 * @param {string} label
 * @param {boolean} passthrough
 */
function run(args, label, passthrough) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  readLines(child.stdout, (line) =>
    passthrough ? onBuildLine(line) : onServerLine(line, false),
  );
  readLines(child.stderr, (line) =>
    passthrough ? onBuildLine(line) : onServerLine(line, true),
  );

  child.on("exit", (code) => {
    if (code === 0 || code === null) return;
    if (child[STOPPING]) return; // yeniden başlatma: beklenen çıkış
    log.error(`${label} exited (code ${code})`);
    shutdown(code);
  });

  children.push(child);
  return child;
}

/* ---------------------------------------------------------------- watcher */

/**
 * Sunucu yeniden başlatmayı `node --watch` yerine kendimiz yönetiyoruz.
 *
 * `--watch-path` verilse bile Node bu kurulumda proje kökünü izliyordu; build
 * çıktısı (`public/assets`, `manifest.json`) ya da dev araçlarının günlüğü
 * yazıldığında sunucu boşuna yeniden başlıyor, hatta kendini besleyen bir
 * döngü kuruluyordu. Kendi watcher'ımız yalnızca sunucu kaynaklarını izler,
 * değişiklikleri birleştirir ve hangi dosyaların değiştiğini bildirir.
 *
 * `views` de izlenir: bileşenlerin çoğu `views/components/**.js` içinde ve bu
 * modüller sunucuya bir kez import edildiği için, restart olmadan yapılan
 * değişiklik tarayıcıya hiç yansımıyordu (şablon düzenleyip "hiçbir şey
 * değişmedi" hissi buradan geliyor). `client/` ve `styles/` burada **yok**;
 * onları esbuild ve CSS watcher'ları kendi içinde hallediyor.
 */
const WATCH_DIRS = [
  config.dirs.routes,
  config.dirs.views,
  path.join(ROOT, "lib"),
  ...(config.watch ?? []).map((dir) => path.resolve(ROOT, dir)),
];

const WATCH_EXTENSIONS = /\.(?:js|mjs|json|ejs)$/;

/** @type {import('node:child_process').ChildProcess | null} */
let server = null;

// `--import` modül belirteci bekler: Windows'ta `H:\…` yolu `h:` şemalı URL
// sanılıp reddediliyor, bu yüzden file:// URL'e çevrilir.
const SERVER_ARGS = [
  // `.env` yoksa bayrak hiç geçilmez: `--env-file-if-exists` dosya yokken bir
  // bildirim satırı basıyor ve bu satır hata kutusuna dönüşüyordu.
  ...(fs.existsSync(path.join(ROOT, ".env")) ? ["--env-file=.env"] : []),
  "--import",
  pathToFileURL(path.join(SRC, "runtime", "register.mjs")).href,
  path.join(SRC, "start.mjs"),
];

function startServerProcess() {
  server = run(SERVER_ARGS, "server", false);
}

/** @type {Set<string>} */
const changed = new Set();
/** @type {NodeJS.Timeout | null} */
let restartTimer = null;

/**
 * Bilinen değişiklik zamanları. Windows'ta `fs.watch` bir dosya yazıldığında
 * komşuları için de olay üretebiliyor; gerçekten değişmeyenleri elemezsek tek
 * kaydetme iki restart'a dönüşüyor.
 *
 * @type {Map<string, number>}
 */
const mtimes = new Map();

/**
 * @param {string} file Mutlak yol.
 * @returns {boolean} içerik zamanı gerçekten değiştiyse
 */
function touched(file) {
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    // Silinmiş dosya: kaydı düşür ve değişiklik say.
    return mtimes.delete(file);
  }

  if (mtimes.get(file) === mtime) return false;
  mtimes.set(file, mtime);
  return true;
}

/** @param {string} file Mutlak yol. */
function onSourceChange(file) {
  if (!touched(file)) return;

  changed.add(path.relative(ROOT, file).split(path.sep).join("/"));

  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(restartServer, 250);
}

function restartServer() {
  restartTimer = null;

  const files = [...changed];
  changed.clear();

  restarting = true;
  restartedAt = Date.now();

  log.event({
    symbol: log.symbols.cycle,
    scope: "server",
    message: "restarting…",
    note: files.length > 1 ? `${files.length} files` : files[0],
  });

  if (process.env.JSKELET_VERBOSE === "1" && files.length > 1) {
    for (const file of files) log.line(file);
  }

  if (server) {
    server[STOPPING] = true;
    server.kill();
  }

  startServerProcess();
}

function watchSources() {
  for (const target of WATCH_DIRS) {
    if (!fs.existsSync(target)) continue;

    // Mevcut zamanlar önden okunur; ilk sahte olay da böylece elenir.
    for (const entry of fs.readdirSync(target, {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !WATCH_EXTENSIONS.test(entry.name)) continue;
      touched(path.join(entry.parentPath ?? entry.path, entry.name));
    }

    try {
      fs.watch(target, { recursive: true }, (event, name) => {
        if (!name || !WATCH_EXTENSIONS.test(name)) return;
        onSourceChange(path.join(target, name));
      });
    } catch {
      log.warn(
        `could not watch ${path.relative(ROOT, target)}; no auto restart for this directory.`,
      );
    }
  }

  // Config değişince sunucu da build de yeni ayarlarla açılmalı.
  const configFile = path.join(ROOT, "jskelet.config.mjs");
  if (fs.existsSync(configFile)) {
    touched(configFile);
    fs.watch(configFile, () => onSourceChange(configFile));
  }
}

/** @param {number} code */
function shutdown(code) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log.event({ symbol: log.symbols.cycle, scope: "dev", message: "shutting down" });
    shutdown(0);
  });
}

run([path.join(SRC, "build", "build.mjs"), "--watch"], "build", true);
startServerProcess();
watchSources();
