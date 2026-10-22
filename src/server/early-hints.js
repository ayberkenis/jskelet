/**
 * 103 Early Hints: render sürerken tarayıcıya bağlantı ve varlık ipuçları.
 *
 * HTML cache'ten dönen sayfa zaten ~1 ms'de gidiyor; orada 103 yalnızca ek bir
 * yanıt satırı olur. Kazanç render beklenen yolda (MISS, dinamik, private):
 * controller upstream'i beklerken tarayıcı CDN'e bağlanıp ana betiği indirir.
 *
 * Varsayılan kapalı. Bazı eski proxy'ler ve HTTP istemcileri 1xx yanıtını
 * nihai yanıt sanıyor; açmak bilinçli bir karar olmalı.
 *
 * `app.css` varsayılan listede yok: sayfa kendi `styles` çıktısını
 * kullanıyorsa ortak sheet'i önden indirmek boşa bant genişliği.
 */
import process from "node:process";
import { getConfig } from "../config/index.js";
import { asset, hasAsset } from "./assets.js";
import { preconnectOrigins } from "./head-hints.js";

const isDev = process.env.NODE_ENV === "development";

/** @type {string[] | null} */
let cached = null;

/** Config yeniden yüklenince (testler, gömülü kullanım) liste de yenilenir. */
/** @type {object | null} */
let cachedFor = null;

/**
 * Manifest anahtarının uzantısından Link başlığı.
 *
 * @param {string} name
 * @param {string} url
 * @returns {string | null}
 */
function assetLink(name, url) {
  const target = `<${encodeURI(url)}>`;
  if (/\.m?js$/i.test(name)) return `${target}; rel=modulepreload`;
  if (/\.css$/i.test(name)) return `${target}; rel=preload; as=style`;
  // Font isteği her zaman CORS modunda; `crossorigin`siz preload ikinci kez
  // indirilir.
  if (/\.woff2?$/i.test(name)) return `${target}; rel=preload; as=font; crossorigin`;
  return null;
}

/**
 * Bu build için gönderilecek Link değerleri; kapalıysa boş dizi.
 *
 * @returns {string[]}
 */
export function earlyHintLinks() {
  const config = getConfig();
  if (cached && cachedFor === config && !isDev) return cached;

  cachedFor = config;
  if (!config.earlyHints?.enabled) {
    cached = [];
    return cached;
  }
  const { earlyHints } = config;

  const links = preconnectOrigins().map((origin) => `<${origin}>; rel=preconnect`);

  for (const name of earlyHints.assets ?? ["main.js"]) {
    // Build yoksa ipucu da yok: hash'siz yedek yolu önden indirmek, sayfanın
    // hiç istemeyeceği bir dosyayı istemek olur.
    if (!hasAsset(name)) continue;
    const link = assetLink(name, asset(name));
    if (link) links.push(link);
  }

  cached = links;
  return links;
}

/**
 * Yanıt yazılmadan önce 103 gönderir. Hata sayfayı düşürmez: ipucu
 * opsiyonel, nihai yanıt değil.
 *
 * @param {import('express').Response} res
 * @returns {void}
 */
export function sendEarlyHints(res) {
  if (res.headersSent || typeof res.writeEarlyHints !== "function") return;

  const links = earlyHintLinks();
  if (!links.length) return;

  try {
    res.writeEarlyHints({ link: links });
  } catch {
    // Soket kapanmış ya da başlık geçersiz: nihai yanıt yine gider.
  }
}
