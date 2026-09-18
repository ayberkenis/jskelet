import assert from "node:assert/strict";
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
