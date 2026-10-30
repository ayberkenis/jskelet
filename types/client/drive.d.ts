export type DriveOptions = {
    /**
     * Takas edilecek bölge; CSS seçici (`#page-content`).
     */
    root: string;
};
export type DriveToOptions = {
    /**
     * Varsayılan `"push"`.
     */
    history?: "push" | "replace" | false;
    /**
     * `[x, y]`; yoksa üste (hash varsa hedefe).
     */
    scroll?: number[];
};
/**
 * Bu tıklama drive'a ait mi? `data-swap` fragment takası, `data-no-drive`
 * tam sayfa, yeni sekme / indirme / origin dışı tarayıcıya bırakılır.
 *
 * @param {Event} event
 * @returns {URL | null}
 */
export declare function driveableUrl(event: Event): URL | null;
/**
 * @param {string} href
 * @param {DriveToOptions} [options]
 * @returns {Promise<boolean>}
 */
export declare function driveTo(href: string, options?: DriveToOptions): Promise<boolean>;
/**
 * Aynı origin bağlantıları `root` bölgesine sürer. Layout (çatı) yerinde
 * kalır. `start({ drive: { root: "#page-content" } })` bunu çağırır.
 *
 * @param {DriveOptions | string} options
 * @returns {() => void}
 */
export declare function startDrive(options: DriveOptions | string): () => void;
