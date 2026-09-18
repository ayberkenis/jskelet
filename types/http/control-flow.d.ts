/**
 * `next/navigation` içindeki notFound/redirect kontrol akışının karşılığı.
 * Derinlerdeki bir fonksiyon throw eder, Express error handler yakalar.
 */
export declare class NotFoundError extends Error {
    statusCode: number;
    constructor(message?: string);
}
export declare class RedirectError extends Error {
    location: string;
    statusCode: 301 | 302 | 303 | 307 | 308;
    /**
     * @param {string} location
     * @param {301 | 302 | 303 | 307 | 308} [statusCode]
     */
    constructor(location: string, statusCode?: 301 | 302 | 303 | 307 | 308);
}
/** @returns {never} */
export declare function notFound(): never;
/**
 * @param {string} location
 * @returns {never}
 */
export declare function permanentRedirect(location: string): never;
/**
 * @param {string} location
 * @returns {never}
 */
export declare function redirect(location: string): never;
/**
 * POST sonrası yönlendirme (303 See Other).
 *
 * `redirect()` 307 kullanır ve 307 **metodu korur**: bir POST handler'ından
 * çağrıldığında tarayıcı hedefe yeniden POST eder. Form gönderiminden sonra
 * sayfayı GET olarak açmak — yani geri tuşunun formu yeniden göndermediği
 * klasik "post/redirect/get" akışı — 303 gerektiriyor.
 *
 * @param {string} location
 * @returns {never}
 */
export declare function seeOther(location: string): never;
/** @param {unknown} error */
export declare function isNotFoundError(error: unknown): error is NotFoundError;
/** @param {unknown} error */
export declare function isRedirectError(error: unknown): error is RedirectError;
