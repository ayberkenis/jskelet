import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ImageResponse,
  OG_SIZE,
  buildOgSvg,
  escapeXml,
  ogImage,
  wrapText,
} from "../src/server/og-image.js";

test("escapeXml escapes markup-sensitive characters", () => {
  assert.equal(escapeXml(`A & B <C> "d" 'e'`), "A &amp; B &lt;C&gt; &quot;d&quot; &apos;e&apos;");
});

test("wrapText breaks on word boundaries and caps lines", () => {
  assert.deepEqual(wrapText("one two three four", 10, 3), [
    "one two",
    "three four",
  ]);
  assert.deepEqual(wrapText("abcdefghijklmnop", 5, 2), ["abcde", "fghi…"]);
  assert.deepEqual(wrapText("  spaced   words  ", 20, 2), ["spaced words"]);
  assert.deepEqual(wrapText("", 10, 2), []);
});

test("buildOgSvg embeds escaped title and defaults size", () => {
  const svg = buildOgSvg({
    title: 'Hello <World> & "friends"',
    description: "A short blurb",
    siteName: "Demo",
  });
  assert.match(svg, /width="1200"/);
  assert.match(svg, /height="630"/);
  assert.match(svg, /Hello &lt;World&gt; &amp; &quot;friends&quot;/);
  assert.match(svg, /A short blurb/);
  assert.match(svg, /Demo/);
  assert.equal(OG_SIZE.width, 1200);
  assert.equal(OG_SIZE.height, 630);
});

test("ogImage returns SVG when format=svg", async () => {
  const result = await ogImage({
    title: "Card",
    format: "svg",
  });
  assert.equal(result.contentType.startsWith("image/svg+xml"), true);
  assert.equal(result.width, 1200);
  assert.equal(result.height, 630);
  assert.match(result.body.toString("utf8"), /<svg/);
});

test("ogImage accepts raw svg", async () => {
  const raw =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">` +
    `<rect width="100" height="50" fill="#111"/>` +
    `</svg>`;
  const result = await ogImage({ svg: raw, width: 100, height: 50, format: "svg" });
  assert.equal(result.body.toString("utf8"), raw);
});

test("ImageResponse wraps card options", async () => {
  const image = new ImageResponse(
    { title: "Post", siteName: "Blog" },
    { format: "svg", width: 800, height: 400 },
  );
  const result = await image.buffer();
  assert.equal(result.width, 800);
  assert.equal(result.height, 400);
  assert.match(result.body.toString("utf8"), /Post/);
  assert.match(result.body.toString("utf8"), /Blog/);
});

test("ogImage embeds fonts as @font-face and uses the family", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-og-"));
  const file = path.join(dir, "demo.woff2");
  fs.writeFileSync(file, Buffer.from("not-a-real-font"));

  try {
    const result = await ogImage({
      title: "Merhaba",
      siteName: "Site",
      format: "svg",
      fonts: [{ path: file, family: "Demo" }],
    });
    const svg = result.body.toString("utf8");
    assert.match(svg, /@font-face/);
    assert.match(svg, /font-family: "Demo"/);
    assert.match(svg, /font-weight: 100 900/);
    assert.match(svg, /font-style: normal/);
    assert.match(svg, /data:font\/woff2;base64,/);
    assert.match(svg, /format\("woff2"\)/);
    assert.match(svg, /font-family="&quot;Demo&quot;, system-ui/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ogImage keeps an explicit weight and injects into raw svg", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jskelet-og-"));
  const file = path.join(dir, "demo.ttf");
  fs.writeFileSync(file, Buffer.from("ttf-bytes"));
  const raw =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50">` +
    `<text font-family="Demo">Hi</text>` +
    `</svg>`;

  try {
    const result = await ogImage({
      svg: raw,
      width: 100,
      height: 50,
      format: "svg",
      fonts: [{ path: file, family: 'Demo" <x>', weight: 700, style: "italic" }],
    });
    const svg = result.body.toString("utf8");
    assert.match(svg, /font-family: "Demo x"/);
    assert.match(svg, /font-weight: 700/);
    assert.match(svg, /font-style: italic/);
    assert.match(svg, /data:font\/ttf;base64,/);
    assert.match(svg, /<text font-family="Demo">Hi<\/text>/);
    assert.match(svg, /<defs><style><!\[CDATA\[/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ogImage skips a missing font and still returns the card", async () => {
  const missing = path.join(os.tmpdir(), "jskelet-og-missing.woff2");
  const result = await ogImage({
    title: "Card",
    format: "svg",
    fonts: [{ path: missing, family: "Nope" }],
  });
  const svg = result.body.toString("utf8");
  assert.equal(result.contentType.startsWith("image/svg+xml"), true);
  assert.doesNotMatch(svg, /@font-face/);
  assert.match(svg, /font-family="system-ui, -apple-system, Segoe UI, sans-serif"/);
});

test("ogImage produces PNG when sharp is available", async () => {
  let sharpOk = false;
  try {
    await import("sharp");
    sharpOk = true;
  } catch {
    // peer yoksa atla
  }
  if (!sharpOk) return;

  const result = await ogImage({ title: "PNG card" });
  assert.equal(result.contentType, "image/png");
  // PNG imzası
  assert.equal(result.body[0], 0x89);
  assert.equal(result.body[1], 0x50);
  assert.equal(result.body[2], 0x4e);
  assert.equal(result.body[3], 0x47);
});

test("ogImage rasterizes a ttf through fontconfig when sharp is available", async () => {
  try {
    await import("sharp");
  } catch {
    return;
  }

  const wing = "C:\\Windows\\Fonts\\wingding.ttf";
  if (!fs.existsSync(wing)) return;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">` +
    `<rect width="200" height="120" fill="#ffffff"/>` +
    `<text x="10" y="90" font-family="NopeNotInstalled" font-size="80" fill="#000000">A</text>` +
    `</svg>`;
  const ogModule = new URL("../src/server/og-image.js", import.meta.url).href;

  // Fontsuz çizim fontconfig'i mühürler. Yüzlü kart ayrı süreçte, ilk PNG o olsun.
  const writeWorker = (name, source) => {
    const file = path.join(os.tmpdir(), name);
    fs.writeFileSync(file, source);
    return file;
  };
  const markedWorker = writeWorker(
    "jskelet-og-fontconfig-marked.mjs",
    `import { ogImage } from ${JSON.stringify(ogModule)};
const marked = await ogImage({
  svg: ${JSON.stringify(svg)},
  width: 200,
  height: 120,
  fonts: [{ path: ${JSON.stringify(wing)}, family: "NopeNotInstalled" }],
});
process.stdout.write(marked.contentType + ":" + marked.body.length);
`,
  );
  const plainWorker = writeWorker(
    "jskelet-og-fontconfig-plain.mjs",
    `import { ogImage } from ${JSON.stringify(ogModule)};
const plain = await ogImage({
  svg: ${JSON.stringify(svg)},
  width: 200,
  height: 120,
});
process.stdout.write(plain.contentType + ":" + plain.body.length);
`,
  );

  const marked = spawnSync(process.execPath, [markedWorker], { encoding: "utf8" });
  const plain = spawnSync(process.execPath, [plainWorker], { encoding: "utf8" });
  fs.rmSync(markedWorker, { force: true });
  fs.rmSync(plainWorker, { force: true });
  assert.equal(marked.status, 0, marked.stderr);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(marked.stdout, /^image\/png:/);
  assert.match(plain.stdout, /^image\/png:/);
  assert.notEqual(marked.stdout, plain.stdout);
});
