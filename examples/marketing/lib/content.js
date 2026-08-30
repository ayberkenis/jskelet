/**
 * İçerik sözlüklerinin girişi.
 *
 * Sitenin bütün metni `lib/content/<dil>.js` altında duruyor; şablonlar dil
 * bilmez, controller çözümlenmiş sözlüğü `t` olarak geçer. Metni şablondan
 * ayrı tutmanın buradaki karşılığı somut: aynı liste hem sayfada hem sitemap'te
 * hem fragment ucunda kullanılabiliyor ve ikinci dil eklemek yeni bir şablon
 * gerektirmiyor.
 */
import { DEFAULT_LOCALE } from "./i18n.js";

import en from "./content/en.js";
import tr from "./content/tr.js";

/** @typedef {import("./i18n.js").Locale} Locale */
/** @typedef {typeof en} Dictionary */

/** @type {Record<Locale, Dictionary>} */
const DICTIONARIES = { en, tr };

/**
 * Bir dilin sözlüğü. Tanınmayan bir dil varsayılana düşer: dil çözümlemesi
 * yol önekinden geldiği için buraya yalnızca bir programlama hatasıyla
 * geçersiz değer gelebilir ve o durumda sayfayı düşürmek yerine İngilizce
 * basmak doğru davranış.
 *
 * @param {string} locale
 * @returns {Dictionary}
 */
export function getContent(locale) {
  return DICTIONARIES[/** @type {Locale} */ (locale)] ?? DICTIONARIES[DEFAULT_LOCALE];
}

/**
 * Sözlükteki `%s` yer tutucularını sırayla doldurur. Sürüm numarası gibi
 * ölçülen değerler metnin içine giriyor ve iki dilde kelime sırası farklı;
 * cümleyi parçalara bölmek yerine yer tutucu kullanmak çeviriyi bozmuyor.
 *
 * @param {string} template
 * @param {...(string | number)} values
 * @returns {string}
 */
export function format(template, ...values) {
  let index = 0;
  return template.replace(/%s/g, () => String(values[index++] ?? ""));
}
