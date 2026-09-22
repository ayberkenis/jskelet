/**
 * Isıtmanın canlı durumu. Dev araçları bunu okuyup ilerlemeyi gösterir;
 * üretimde kimse okumazsa da maliyeti bir nesnedir.
 */
export declare const prewarmProgress: {
    active: boolean;
    done: number;
    total: number;
    ok: number;
    failed: number;
    /** @type {number | null} */
    startedAt: number | null;
    /** @type {number | null} */
    finishedAt: number | null;
    /**
     * Denenen her yolun sonucu; dev panelindeki Prewarming sekmesi bunu listeler.
     * @type {{ path: string, status: number, ms: number, bytes: number,
     *   cache: string | null, error: string | null }[]}
     */
    entries: {
        path: string;
        status: number;
        ms: number;
        bytes: number;
        cache: string | null;
        error: string | null;
    }[];
};
/**
 * İstek ısıtma turunun kendi isteği mi? Yalnızca tur çalışırken ve istek
 * ısıtmanın user-agent'ıyla geldiğinde doğru; gerçek trafiğin hataları her
 * zaman loglanmaya devam eder.
 *
 * @param {{ get?: (name: string) => string | undefined } | null | undefined} req
 * @returns {boolean}
 */
export declare function isPrewarmRequest(req: {
    get?: (name: string) => string | undefined;
} | null | undefined): boolean;
/**
 * Isıtma turuna ait bir uyarıyı loglamak yerine sayar.
 *
 * @param {string} message Gruplama anahtarı; yol adı içermemeli.
 * @returns {boolean} `true` ise sayıldı, çağıran taraf loglamamalı.
 */
export declare function suppressForPrewarm(message: string): boolean;
/**
 * Bastırılan bir istek hatasını sayaca ekler. Yığın izi saklanmaz: özet
 * satırının amacı "neyin bozulduğunu" göstermek, hatayı ayıklamak değil.
 *
 * @param {number} status
 * @param {unknown} error
 * @returns {void}
 */
export declare function notePrewarmError(status: number, error: unknown): void;
/**
 * Bir turda ısıtılacak dilimi seçer: önce `priority` eşleşenler, sonra
 * kuyruğun sırası gelen parçası. Dışa açık olması bilinçli — sıralama ve
 * rotasyon, tur çalışmadan doğrulanabilen tek davranış.
 *
 * @param {string[]} all
 * @param {number} limit
 * @param {boolean} rotate
 * @returns {string[]}
 */
export declare function selectPrewarmPaths(all: string[], limit: number, rotate?: boolean): string[];
/**
 * @param {{ origin: string, quiet?: boolean, paths?: string[],
 *   forwardedHost?: string }} options
 *   `paths` verilirse hook çağrılmaz, yalnızca o yollar ısıtılır (dev
 *   panelindeki "tekrar dene" bunu kullanır). `forwardedHost` loopback
 *   isteğine public host'u taşır; cache anahtarı `h=127.0.0.1` olmasın.
 * @returns {Promise<{ ok: number, failed: number, total: number, elapsed: number }>}
 */
export declare function prewarm({ origin, quiet, paths: only, forwardedHost }: {
    origin: string;
    quiet?: boolean;
    paths?: string[];
    forwardedHost?: string;
}): Promise<{
    ok: number;
    failed: number;
    total: number;
    elapsed: number;
}>;
/**
 * HTML içindeki aynı-origin `<a href>` yollarını DOM sırasıyla (üstten alta)
 * toplar. Speculation Rules ile aynı muafiyetler: `nofollow`, `_blank`,
 * `data-no-prefetch`, `prewarmSkip`, `navigation.exclude`.
 *
 * @param {string} html
 * @param {{ limit?: number, basePath?: string }} [options]
 * @returns {string[]}
 */
export declare function extractSameOriginLinks(html: string, options?: {
    limit?: number;
    basePath?: string;
}): string[];
/**
 * Ziyaret ısıtması açık mı? `PREWARM=0` her iki modu da keser.
 *
 * @returns {boolean}
 */
export declare function isOnVisitPrewarm(): boolean;
/**
 * Yanıt gövdesindeki linkleri soğuksa kuyruğa alır. İstek yolunu bloklamamak
 * için `route()` bunu `queueMicrotask` ile çağırır.
 *
 * @param {string} html
 * @param {{ path: string, req?: { get?: (name: string) => string | undefined,
 *   headers?: Record<string, unknown> } }} context
 * @returns {void}
 */
export declare function noteVisitWarm(html: string, context: {
    path: string;
    req?: {
        get?: (name: string) => string | undefined;
        headers?: Record<string, unknown>;
    };
}): void;
/**
 * Açılışta ısıtmayı tetikler. `listen` geri çağrısından çağrılır.
 * `onVisit` modunda klasik zamanlayıcı yok; yine de erken-TTL invalidation
 * drain'i çalışır — soft-bayatlayan sweeper'ın kuyruğu boşalmasın.
 *
 * @param {{ port: number }} options
 * @returns {void}
 */
export declare function startPrewarm({ port }: {
    port: number;
}): void;
