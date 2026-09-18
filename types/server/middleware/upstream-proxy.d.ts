/**
 * Hedefi isteğe göre hesaplayan proxy üretir. `resolveTarget` fırlatırsa
 * istek proxy'lenmez ve zincire devam eder — hedef origin yapılandırılmamış
 * bir kurulumda 500 yerine normal 404 almak daha doğru.
 *
 * @param {(req: import('express').Request) => string} resolveTarget
 * @returns {import('express').RequestHandler}
 */
export declare function createProxy(resolveTarget: (req: import('express').Request) => string): import('express').RequestHandler;
/**
 * Config'teki `rewrites()` kuralları.
 *
 * Hedef mutlaksa (http/https) istek proxy ile dışa taşınır; göreliyse
 * yalnızca `req.url` değiştirilir ve istek kendi route tablosunda devam eder.
 * İki faz var: `beforeFiles` statik dosyalardan önce, `afterFiles` statik
 * denendikten sonra sayfalardan önce.
 *
 * @param {"beforeFiles" | "afterFiles"} phase
 * @returns {import('express').RequestHandler}
 */
export declare function configRewrites(phase: "beforeFiles" | "afterFiles"): import('express').RequestHandler;
