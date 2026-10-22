/**
 * Bu build için gönderilecek Link değerleri; kapalıysa boş dizi.
 *
 * @returns {string[]}
 */
export declare function earlyHintLinks(): string[];
/**
 * Yanıt yazılmadan önce 103 gönderir. Hata sayfayı düşürmez: ipucu
 * opsiyonel, nihai yanıt değil.
 *
 * @param {import('express').Response} res
 * @returns {void}
 */
export declare function sendEarlyHints(res: import('express').Response): void;
