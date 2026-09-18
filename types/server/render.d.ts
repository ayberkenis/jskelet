/**
 * Uygulama geliştirirken bileşen dosyaları değişince kayıt yenilenmeli.
 * Dev sunucusu süreci yeniden başlattığı için normalde gerekmez; gömülü
 * kullanımlar (test, script) için dışa açık.
 *
 * @returns {void}
 */
export declare function resetRenderEngine(): void;
/**
 * Layout kullanmadan tek bir şablon render eder. Fragment/partial uçları
 * ve e-posta şablonları bunu kullanır.
 *
 * Öncelik: derlenmiş `.jsk` → `.ejs`. İstek anında şablon derlenmez.
 *
 * @param {string} view `views/` altındaki yol, uzantısız (örn. "pages/home")
 * @param {object} [data]
 * @returns {Promise<string>}
 */
export declare function renderView(view: string, data?: object): Promise<string>;
/**
 * Sayfayı layout içinde render eder.
 *
 * @param {{ view: string, data?: object, metadata?: object, head?: string,
 *   bodyClass?: string, entries?: string[], styles?: string[],
 *   pathname?: string }} page
 * @returns {Promise<string>}
 */
export declare function renderPage(page: {
    view: string;
    data?: object;
    metadata?: object;
    head?: string;
    bodyClass?: string;
    entries?: string[];
    styles?: string[];
    pathname?: string;
}): Promise<string>;
/**
 * Controller'ı çalıştırıp yanıtı yazar; notFound/redirect kontrol akışını,
 * HTML cache'ini ve hata yönetimini üstlenir.
 *
 * `private: true` kişiye özel sayfaları public cache yolundan tamamen ayırır:
 * HTML cache devre dışı kalır, config'in `cache.html` deseni bu kararı
 * ezemez, yanıt `no-store` ile ve ETag'siz gider. Dashboard tipi sayfalarda
 * bu bayrak olmadan çalışmak, bir kullanıcının HTML'inin bir başkasına
 * servis edilmesi anlamına gelir.
 *
 * @param {(ctx: { params: object, query: object, pathname: string,
 *   req: import('express').Request }) => Promise<object>} controller
 * @param {{ revalidate?: number, private?: boolean }} [options]
 * @returns {import('express').RequestHandler}
 */
export declare function route(controller: (ctx: {
    params: object;
    query: object;
    pathname: string;
    req: import('express').Request;
}) => Promise<object>, options?: {
    revalidate?: number;
    private?: boolean;
}): import('express').RequestHandler;
/**
 * Layout'suz, asla cache'lenmeyen parça yanıtı.
 *
 * Fragment uçları (tablo sayfası, sekme paneli, canlı tazelenen kart) her
 * projede elle yazılıyor ve `no-store` yazmayı unutmak sessiz bir sızıntıya
 * dönüşüyor. Burada politika sabit: HTML cache'e hiç uğramaz, `no-store` ile
 * ve ETag'siz gider.
 *
 * Hata durumunda tüm sayfa yerine küçük bir hata parçası döner: takas edilen
 * bölge bir hata sayfasının tamamını içine almasın.
 *
 * @param {(ctx: { params: object, query: object, pathname: string,
 *   req: import('express').Request }) => Promise<{ view: string, data?: object,
 *   status?: number } | string>} controller
 * @returns {import('express').RequestHandler}
 */
export declare function fragment(controller: (ctx: {
    params: object;
    query: object;
    pathname: string;
    req: import('express').Request;
}) => Promise<{
    view: string;
    data?: object;
    status?: number;
} | string>): import('express').RequestHandler;
export type Produced = {
    html: string;
    status: number;
    degraded?: boolean;
    storable?: boolean;
    retryAfter?: number;
};
/**
 * 404 sayfası. `renderStatusPage(404)` için kısayol; route dosyalarında en sık
 * ihtiyaç duyulan durum bu olduğu için ayrı bir ad taşımaya devam ediyor.
 *
 * @returns {Promise<string>}
 */
export declare function renderNotFound(): Promise<string>;
