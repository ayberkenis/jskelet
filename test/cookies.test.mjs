/**
 * İmzalı cookie yüzeyi.
 *
 * Sırrı config yerine ortam değişkeninden veriyoruz: `loadConfig` çağırmadan
 * da çalışması bu modülün sözleşmesinin parçası (script ve build tarafı).
 */
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";

process.env.JSKELET_SECRET = "test-sirri";

const { clearCookie, getSignedCookie, parseCookies, randomToken, safeEqual, serializeCookie, setCookie, setSignedCookie } =
  await import("../src/http/cookies.js");

/** @param {string} [cookieHeader] */
function createRequest(cookieHeader) {
  return /** @type {any} */ ({
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

function createResponse() {
  /** @type {Map<string, string | string[]>} */
  const headers = new Map();

  return /** @type {any} */ ({
    setHeader: (/** @type {string} */ key, /** @type {any} */ value) =>
      headers.set(key.toLowerCase(), value),
    getHeader: (/** @type {string} */ key) => headers.get(key.toLowerCase()),
    headers,
    /** @returns {string[]} */
    cookies() {
      const value = headers.get("set-cookie");
      if (!value) return [];
      return Array.isArray(value) ? value.map(String) : [String(value)];
    },
  });
}

test("varsayılanlar kısıtlayıcı", () => {
  const serialized = serializeCookie("a", "b", { secure: true });

  assert.match(serialized, /^a=b/);
  assert.match(serialized, /Path=\//);
  assert.match(serialized, /HttpOnly/);
  assert.match(serialized, /Secure/);
  assert.match(serialized, /SameSite=Lax/);
});

test("değer yüzde kodlanır", () => {
  const serialized = serializeCookie("a", "x y;z");
  assert.match(serialized, /a=x%20y%3Bz/);
});

test("cookie başlığı ayrıştırılır", () => {
  const cookies = parseCookies(createRequest("a=1; b=x%20y; bozuk"));

  assert.equal(cookies.a, "1");
  assert.equal(cookies.b, "x y");
  assert.equal(cookies.bozuk, undefined);
});

test("birden fazla cookie aynı yanıta yazılır", () => {
  const res = createResponse();
  setCookie(res, "a", "1");
  setCookie(res, "b", "2");

  assert.equal(res.cookies().length, 2);
});

test("imzalı cookie okunur", () => {
  const res = createResponse();
  setSignedCookie(res, "session", "kullanici-7");

  const raw = res.cookies()[0].split(";")[0].slice("session=".length);
  const req = createRequest(`session=${raw}`);

  assert.equal(getSignedCookie(req, "session"), "kullanici-7");
});

test("kurcalanmış değer null döner", () => {
  const res = createResponse();
  setSignedCookie(res, "session", "kullanici-7");

  const raw = decodeURIComponent(res.cookies()[0].split(";")[0].slice("session=".length));
  const [encoded, signature] = raw.split(".");

  // Değeri değiştirip imzayı olduğu gibi bırakmak: en tipik saldırı.
  const forged = Buffer.from("kullanici-1", "utf8").toString("base64url");
  const req = createRequest(`session=${encodeURIComponent(`${forged}.${signature}`)}`);

  assert.equal(getSignedCookie(req, "session"), null);
  assert.equal(getSignedCookie(createRequest(`session=${encoded}`), "session"), null);
});

test("imzasız ve eksik cookie null döner", () => {
  assert.equal(getSignedCookie(createRequest(), "session"), null);
  assert.equal(getSignedCookie(createRequest("session=düz"), "session"), null);
});

test("clearCookie süresi geçmiş bir cookie yazar", () => {
  const res = createResponse();
  clearCookie(res, "session");

  assert.match(res.cookies()[0], /Max-Age=0/);
});

test("safeEqual farklı uzunlukta çökmez", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("abc", ""), false);
});

test("randomToken url-güvenli ve benzersiz", () => {
  const a = randomToken(16);
  const b = randomToken(16);

  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});
