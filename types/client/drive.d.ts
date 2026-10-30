export type DriveOptions = {
    /**
     * Yazılacak bölge; varsayılan `"body"`.
     */
    root?: string;
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
 * Canlı `data-permanent[id]` düğümlerini ağaçtan ayır. İç içe olanlar
 * dışarıdakinin içinde kalır; iki kez taşınmasın.
 *
 * @param {ParentNode} root
 * @returns {HTMLElement[]}
 */
export declare function collectPermanent(root: ParentNode): HTMLElement[];
/**
 * Yeni ağaçtaki aynı `id` + `data-permanent` yuvasına canlı düğümü koy.
 * Yuva yoksa (yeni sayfa bu controller'ı istemiyor) sök.
 *
 * @param {ParentNode} root
 * @param {HTMLElement[]} kept
 */
export declare function restorePermanent(root: ParentNode, kept: HTMLElement[]): void;
/**
 * Çekilen belgenin stylesheet'lerini canlı `<head>` ile hizala. Drive
 * `body`'yi yazar; `<head>` yerinde kalır. Sayfa sheet'i olan her site
 * aksi halde eski CSS ile yeni HTML görür.
 *
 * @param {Document} parsed
 * @returns {Promise<void>}
 */
export declare function syncDrivenHead(parsed: Document): Promise<void>;
/**
 * @param {string} href
 * @param {DriveToOptions} [options]
 * @returns {Promise<boolean>}
 */
export declare function driveTo(href: string, options?: DriveToOptions): Promise<boolean>;
/**
 * Aynı origin bağlantıları belge ziyaretine çevirir. `data-permanent`
 * controller host'ları sökülmez. `start({ drive: true })` bunu çağırır.
 *
 * @param {DriveOptions | string | boolean} [options]
 * @returns {() => void}
 */
export declare function startDrive(options?: DriveOptions | string | boolean): () => void;
