export type RequestContext = {
    /**
     * Route `private: true` ile mi kaydedildi.
     */
    private: boolean;
    /**
     * Kimliğe bağlı bir veri okundu mu.
     */
    tainted: boolean;
    /**
     * Hangi erişimler işaretledi (teşhis için).
     */
    taintReasons: string[];
    csrfToken: string | null;
    res: import('express').Response | null;
    /**
     * Devtools: bu isteğin sayfa yolu (SSR
     * sırasında upstream hatasına "hangi sayfa" bağlamak için).
     */
    pathname: string | null;
};
/**
 * @param {{ private?: boolean, res?: import('express').Response, pathname?: string | null }} [initial]
 * @returns {RequestContext}
 */
export declare function createRequestContext(initial?: {
    private?: boolean;
    res?: import('express').Response;
    pathname?: string | null;
}): RequestContext;
/**
 * İsteği verilen bağlam içinde çalıştırır.
 *
 * @template T
 * @param {RequestContext} context
 * @param {() => T} run
 * @returns {T}
 */
export declare function withRequestContext<T>(context: RequestContext, run: () => T): T;
/**
 * @returns {RequestContext | undefined}
 */
export declare function getRequestContext(): RequestContext | undefined;
/**
 * Çıktının kullanıcıya bağlı olduğunu bildirir. Bağlam yoksa (script, build,
 * fragment dışı kullanım) sessizce yok sayılır.
 *
 * @param {string} reason Teşhis mesajında görünecek erişim adı.
 */
export declare function markTainted(reason: string): void;
/**
 * Controller'a giden `req`'i kimliğe dokunan erişimleri işaretleyen bir Proxy
 * ile sarar.
 *
 * Neden gerekli: HTML cache anahtarı yalnızca yol + query. Cookie okuyan bir
 * controller cache'lenebilir bir route'a bağlanmışsa bir kullanıcının HTML'i
 * bir başkasına servis edilir ve bu hiçbir yerde hata olarak görünmez.
 * İşaretleme, sessiz sızıntıyı gürültülü bir uyarıya çeviriyor.
 *
 * Kapsam bilinçli olarak dar: yalnızca *okuma* yakalanır, yazma ve metot
 * çağrıları hedefe dokunulmadan geçer. Proxy'nin prototipi korunduğu için
 * `req instanceof IncomingMessage` gibi kontroller etkilenmez.
 *
 * @param {import('express').Request} req
 * @returns {import('express').Request}
 */
export declare function guardRequest(req: import('express').Request): import('express').Request;
