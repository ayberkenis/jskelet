#!/usr/bin/env node
/**
 * JSkelet CLI.
 *
 *   jskelet dev      build watch + sunucu, canlı yenileme, dev overlay
 *   jskelet build    tek seferlik prod build (fontlar, sprite, CSS, JS, görseller)
 *   jskelet start    prod sunucu (build eksikse önce üretir)
 *   jskelet init     bulunduğun dizine minimal iskelet kurar
 *
 * Alt komutlar ayrı süreçlerde çalışır. Sebep: `dev` iki uzun ömürlü süreci
 * (build watch + sunucu) yönetiyor ve sunucunun ESM resolve hook'larına
 * (`--import`) ihtiyacı var; bunlar süreç başlarken kurulmak zorunda.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(fileURLToPath(import.meta.url), "..", "..", "src");

/**
 * `--import` bir modül **belirteci** bekler, dosya yolu değil. Windows'ta
 * `H:\...` mutlak yolu `h:` şemalı bir URL sanılıp reddediliyor; file:// URL'e
 * çevirmek her platformda doğru.
 */
const REGISTER = pathToFileURL(path.join(SRC, "runtime", "register.mjs")).href;

const [command, ...rest] = process.argv.slice(2);

/**
 * `.env` yalnızca varsa geçilir: `--env-file-if-exists` dosya yokken de bir
 * bildirim satırı basıyor ve bu satır dev çıktısında hata gibi görünüyor.
 * `--import` alias hook'larını kurar; uygulama kodu `@/…` yazabilsin diye.
 *
 * @param {string} file
 * @param {{ env?: Record<string, string>, args?: string[], hooks?: boolean }} [options]
 * @returns {import('node:child_process').ChildProcess}
 */
function run(file, options = {}) {
  const args = [
    ...(fs.existsSync(path.join(process.cwd(), ".env"))
      ? ["--env-file=.env"]
      : []),
    ...(options.hooks === false ? [] : ["--import", REGISTER]),
    file,
    ...(options.args ?? []),
  ];

  return spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

/** @param {import('node:child_process').ChildProcess} child */
function exitWith(child) {
  child.on("exit", (code) => process.exit(code ?? 0));
}

switch (command) {
  case "dev": {
    exitWith(run(path.join(SRC, "dev-server.mjs"), { hooks: false, args: rest }));
    break;
  }

  case "build": {
    exitWith(
      run(path.join(SRC, "build", "build.mjs"), {
        env: { NODE_ENV: process.env.NODE_ENV ?? "production" },
        args: rest,
      }),
    );
    break;
  }

  case "start": {
    exitWith(
      run(path.join(SRC, "start.mjs"), {
        env: { NODE_ENV: process.env.NODE_ENV ?? "production" },
        args: rest,
      }),
    );
    break;
  }

  case "init": {
    const { init } = await import("../src/init.mjs");
    await init(process.cwd());
    break;
  }

  default: {
    const known = command ? `unknown command: ${command}\n\n` : "";
    process.stderr.write(
      `${known}usage: jskelet <dev|build|start|init>\n\n` +
        "  dev     build watch + server (live reload, dev overlay)\n" +
        "  build   production build\n" +
        "  start   production server\n" +
        "  init    scaffold a minimal skeleton in the current directory\n",
    );
    process.exit(command ? 1 : 0);
  }
}
