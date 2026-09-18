/**
 * Durum koduna karşılık gelen sayfayı üretir. Hiçbir koşulda fırlatmaz:
 * hata sayfasının kendisi patlarsa ziyaretçi boş yanıt görür, bu yüzden her
 * başarısızlık gömülü HTML'e düşer.
 *
 * Development'ta 5xx yanıtları `hooks.error` ve gömülü 500 sayfasını atlar;
 * yığın izini içeren bir teşhis sayfası döner. Production'da ayrıntı
 * gösterilmez — sunucu içi ziyaretçiye açılmaz.
 *
 * @param {number} status
 * @param {{ error?: unknown }} [options]
 * @returns {Promise<string>}
 */
export declare function renderStatusPage(status: number, options?: {
    error?: unknown;
}): Promise<string>;
/**
 * Bir hatadan HTTP durum kodu çıkarır. Uygulama kodu `error.statusCode` ya da
 * `error.status` ile kendi kodunu bildirebilir; tanınmayan her şey 500'dür.
 *
 * @param {unknown} error
 * @returns {number}
 */
export declare function statusFromError(error: unknown): number;
