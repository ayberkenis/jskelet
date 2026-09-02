/**
 * Admin panel sözlüğü.
 *
 * Elle yazılmış bir sözlükte iki hata sessizce panelde görünüyor: bir dilde
 * eksik kalan anahtar (metin yerine anahtarın kendisi çıkar) ve şablonda geçip
 * sözlükte olmayan anahtar. İkisi de burada yakalanıyor.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { MESSAGES, t } from "../src/client/admin/i18n.js";

const PANEL_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "client",
  "admin",
);

/**
 * @param {string} name
 * @returns {string}
 */
const read = (name) => fs.readFileSync(path.join(PANEL_DIR, name), "utf8");

test("every language has the same keys", () => {
  const [reference, ...others] = Object.keys(MESSAGES);
  const expected = Object.keys(MESSAGES[reference]).sort();

  for (const language of others) {
    assert.deepEqual(
      Object.keys(MESSAGES[language]).sort(),
      expected,
      `${language} sözlüğü ${reference} ile eşleşmiyor`,
    );
  }
});

test("no translation is left empty", () => {
  for (const [language, entries] of Object.entries(MESSAGES)) {
    for (const [key, value] of Object.entries(entries)) {
      assert.ok(value.trim(), `${language}/${key} boş`);
    }
  }
});

test("keys used in the templates exist", () => {
  const markup = [read("panel.html"), read("login.html")].join("\n");
  const keys = [...markup.matchAll(/data-i18n(?:-html|-ph|-title)?="([^"]+)"/g)].map(
    (match) => match[1],
  );

  assert.ok(keys.length > 40, "şablonlarda çeviri anahtarı bulunamadı");

  for (const key of keys) {
    for (const language of Object.keys(MESSAGES)) {
      assert.ok(MESSAGES[language][key], `${language} sözlüğünde eksik: ${key}`);
    }
  }
});

test("keys used from the client script exist", () => {
  const script = read("panel.js");
  const keys = [...script.matchAll(/\bt\("([^"]+)"/g)].map((match) => match[1]);

  assert.ok(keys.length > 40, "panel.js içinde çeviri anahtarı bulunamadı");

  for (const key of keys) {
    for (const language of Object.keys(MESSAGES)) {
      assert.ok(MESSAGES[language][key], `${language} sözlüğünde eksik: ${key}`);
    }
  }
});

test("server action codes have a message in both languages", () => {
  const source = fs.readFileSync(
    path.join(PANEL_DIR, "..", "..", "server", "admin", "actions.js"),
    "utf8",
  );
  const codes = [...source.matchAll(/code: "([\w.]+)"/g)].map((match) => match[1]);

  assert.ok(codes.length > 15, "aksiyon kodu bulunamadı");

  for (const code of codes) {
    for (const language of Object.keys(MESSAGES)) {
      assert.ok(MESSAGES[language][`msg.${code}`], `${language}: msg.${code} eksik`);
    }
  }
});

test("placeholders are filled and unknown keys fall back to themselves", () => {
  assert.equal(t("card.limit", { count: 500 }), "limit 500");
  assert.equal(t("entries.shown", { total: 7 }), "7 shown");
  assert.equal(t("nope.missing"), "nope.missing");
});
