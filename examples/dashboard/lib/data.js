/**
 * Süreç belleğinde duran örnek veri.
 *
 * Gerçek bir panelde burası bir veritabanı ya da upstream API olurdu; örneğin
 * anlatmak istediği şey veri katmanı değil, verinin **kullanıcıya bağlı**
 * olması: her kullanıcı yalnızca kendi kayıtlarını görüyor.
 */

/** @typedef {{ id: number, musteri: string, tutar: number, durum: string, sahip: string }} Order */

const DURUMLAR = ["Hazırlanıyor", "Kargoda", "Teslim edildi", "İptal"];

/** @type {Order[]} */
const ORDERS = Array.from({ length: 47 }, (_, index) => ({
  id: 1000 + index,
  musteri: `Müşteri ${String(index + 1).padStart(2, "0")}`,
  tutar: 250 + ((index * 137) % 4000),
  durum: DURUMLAR[index % DURUMLAR.length],
  sahip: index % 3 === 0 ? "mert" : "ayse",
}));

/** @type {{ id: number, sahip: string, metin: string, tarih: string }[]} */
const NOTES = [
  {
    id: 1,
    sahip: "ayse",
    metin: "Kargo firmasıyla fiyat görüşmesi cuma günü.",
    tarih: "2026-08-28",
  },
];

let nextNoteId = 2;

export const PAGE_SIZE = 10;

/**
 * @param {string} username
 * @param {number} page 1'den başlar.
 * @returns {{ rows: Order[], page: number, pageCount: number, total: number }}
 */
export function getOrders(username, page = 1) {
  const owned = ORDERS.filter((order) => order.sahip === username);
  const pageCount = Math.max(1, Math.ceil(owned.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * PAGE_SIZE;

  return {
    rows: owned.slice(start, start + PAGE_SIZE),
    page: current,
    pageCount,
    total: owned.length,
  };
}

/**
 * @param {string} username
 * @returns {{ toplam: number, ciro: number, bekleyen: number }}
 */
export function getSummary(username) {
  const owned = ORDERS.filter((order) => order.sahip === username);

  return {
    toplam: owned.length,
    ciro: owned.reduce((sum, order) => sum + order.tutar, 0),
    bekleyen: owned.filter((order) => order.durum === "Hazırlanıyor").length,
  };
}

/**
 * @param {string} username
 * @returns {typeof NOTES}
 */
export function getNotes(username) {
  return NOTES.filter((note) => note.sahip === username).toReversed();
}

/**
 * Doğrulama sunucuda: istemci tarafı kontrol yalnızca bir kolaylık, tek
 * gerçek kaynak burası.
 *
 * @param {string} username
 * @param {string} metin
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function addNote(username, metin) {
  const value = String(metin ?? "").trim();

  if (value.length < 3) {
    return { ok: false, error: "Not en az 3 karakter olmalı." };
  }

  if (value.length > 200) {
    return { ok: false, error: "Not en fazla 200 karakter olabilir." };
  }

  NOTES.push({
    id: nextNoteId++,
    sahip: username,
    metin: value,
    tarih: new Date().toISOString().slice(0, 10),
  });

  return { ok: true };
}

/**
 * @param {number} amount
 * @returns {string}
 */
export function formatTutar(amount) {
  return `${amount.toLocaleString("tr-TR")} ₺`;
}
