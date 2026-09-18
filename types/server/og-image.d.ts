/** Sosyal kartlar için yaygın boyut (Facebook / X / LinkedIn). */
export declare const OG_SIZE: Readonly<{
    width: 1200;
    height: 630;
}>;
export type OgCardOptions = {
    title?: string;
    description?: string;
    siteName?: string;
    /**
     * Düz SVG rengi (`#0f172a`)
     */
    background?: string;
    /**
     * Ana metin rengi
     */
    color?: string;
    /**
     * Açıklama / site adı
     */
    mutedColor?: string;
    /**
     * Sol şerit rengi
     */
    accent?: string;
};
export type OgImageOptions = OgCardOptions & {
    svg?: string;
    width?: number;
    height?: number;
    format?: 'png' | 'svg';
    cacheControl?: string;
};
export type OgImageResult = {
    body: Buffer;
    contentType: string;
    width: number;
    height: number;
};
/**
 * @typedef {object} OgCardOptions
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [siteName]
 * @property {string} [background] Düz SVG rengi (`#0f172a`)
 * @property {string} [color] Ana metin rengi
 * @property {string} [mutedColor] Açıklama / site adı
 * @property {string} [accent] Sol şerit rengi
 */
/**
 * @typedef {OgCardOptions & {
 *   svg?: string,
 *   width?: number,
 *   height?: number,
 *   format?: 'png' | 'svg',
 *   cacheControl?: string,
 * }} OgImageOptions
 */
/**
 * @typedef {object} OgImageResult
 * @property {Buffer} body
 * @property {string} contentType
 * @property {number} width
 * @property {number} height
 */
/**
 * XML metin kaçışı — kullanıcı başlığı SVG'ye gömülür.
 * @param {unknown} value
 * @returns {string}
 */
export declare function escapeXml(value: unknown): string;
/**
 * Kelime sınırında satır kır. Uzun kelime kesilir; taşan içerik son satırda `…`.
 * @param {string} text
 * @param {number} maxChars
 * @param {number} maxLines
 * @returns {string[]}
 */
export declare function wrapText(text: string, maxChars: number, maxLines: number): string[];
/**
 * Hazır kart SVG'si. Uygulama kendi SVG'sini vermek isterse `svg` kullanır.
 * @param {OgCardOptions & { width?: number, height?: number }} options
 * @returns {string}
 */
export declare function buildOgSvg(options?: OgCardOptions & {
    width?: number;
    height?: number;
}): string;
/**
 * SVG veya kart alanlarından PNG/SVG gövde üretir.
 * @param {OgImageOptions} [options]
 * @returns {Promise<OgImageResult>}
 */
export declare function ogImage(options?: OgImageOptions): Promise<OgImageResult>;
/**
 * Express yanıtına OG görseli basar.
 * @param {import('express').Response} res
 * @param {OgImageOptions} [options]
 * @returns {Promise<OgImageResult>}
 */
export declare function sendOgImage(res: import('express').Response, options?: OgImageOptions): Promise<OgImageResult>;
/**
 * Next `opengraph-image` route handler'ına yakın Express sarmalayıcı.
 *
 * Factory `null` dönerse veya `notFound()` fırlatırsa 404.
 *
 * @param {(ctx: { params: Record<string, string>, query: import('express').Request['query'], req: import('express').Request }) =>
 *   OgImageOptions | null | Promise<OgImageOptions | null>} factory
 * @param {OgImageOptions} [defaults] Her istekte birleşen varsayılanlar
 * @returns {import('express').RequestHandler}
 */
export declare function ogHandler(factory: (ctx: {
    params: Record<string, string>;
    query: import('express').Request['query'];
    req: import('express').Request;
}) => OgImageOptions | null | Promise<OgImageOptions | null>, defaults?: OgImageOptions): import('express').RequestHandler;
/**
 * Next.js `new ImageResponse(...)` DX'si. JSX yok — ilk argüman SVG string
 * veya kart alanları nesnesi.
 *
 * @example
 * ```js
 * return new ImageResponse(
 *   { title: post.title, description: post.excerpt, siteName: "Blog" },
 *   { width: 1200, height: 630 },
 * );
 * // handler içinde: await image.send(res)
 * ```
 */
export declare class ImageResponse {
    #private;
    /**
     * @param {string | OgCardOptions} element
     * @param {Omit<OgImageOptions, keyof OgCardOptions | 'svg'> & { width?: number, height?: number }} [init]
     */
    constructor(element: string | OgCardOptions, init?: Omit<OgImageOptions, keyof OgCardOptions | 'svg'> & {
        width?: number;
        height?: number;
    });
    /** @returns {OgImageOptions} */
    get options(): OgImageOptions;
    /** @returns {Promise<OgImageResult>} */
    buffer(): Promise<OgImageResult>;
    /**
     * @param {import('express').Response} res
     * @returns {Promise<OgImageResult>}
     */
    send(res: import('express').Response): Promise<OgImageResult>;
}
