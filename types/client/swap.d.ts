export type SwapOptions = {
    /**
     * Varsayılan `GET`.
     */
    method?: string;
    body?: BodyInit | null;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    /**
     * `true` → adres çubuğu `url` ile güncellenir.
     */
    history?: boolean;
    /**
     * Varsayılan `replace`.
     */
    mode?: "replace" | "append";
};
/**
 * @typedef {object} SwapOptions
 * @property {string} [method] Varsayılan `GET`.
 * @property {BodyInit | null} [body]
 * @property {Record<string, string>} [headers]
 * @property {AbortSignal} [signal]
 * @property {boolean} [history] `true` → adres çubuğu `url` ile güncellenir.
 * @property {"replace" | "append"} [mode] Varsayılan `replace`.
 */
/**
 * @param {Element | string} target Takas edilecek bölge.
 * @param {string} url Parçayı döndüren uç.
 * @param {SwapOptions} [options]
 * @returns {Promise<boolean>} Başarılıysa `true`; hata durumunda mevcut
 *   içerik korunur ve `false` döner.
 */
export declare function swap(target: Element | string, url: string, options?: SwapOptions): Promise<boolean>;
/**
 * `data-swap` taşıyan bağlantı ve butonları otomatik bağlar.
 *
 *   <a href="/_fragment/rows?page=2" data-swap="#rows" data-swap-history>…</a>
 *
 * Tek bir delege dinleyici: sonradan DOM'a giren bağlantılar da çalışır ve
 * her takastan sonra yeniden bağlama gerekmez.
 *
 * @param {ParentNode} [root]
 * @returns {() => void} Dinleyiciyi söken fonksiyon.
 */
export declare function startSwapLinks(root?: ParentNode): () => void;
