/**
 * CDN prefix + göreli asset yolu. Zaten mutlak (`https:…`) URL'lere dokunmaz.
 *
 * @param {string} prefix Sonunda `/` olmadan (normalize edilmiş).
 * @param {string} url
 * @returns {string}
 */
export declare function applyAssetPrefix(prefix: string, url: string): string;
export type AssetOptions = {
    origin?: "cdn" | "document";
};
/**
 * @typedef {{ origin?: "cdn" | "document" }} AssetOptions
 */
/**
 * Manifest'teki hash'li (veya yedek) URL.
 *
 * @param {string} name Örn. "app.css", "main.js", "sprite.svg"
 * @param {AssetOptions} [options]
 *   `origin: "document"` → `build.assets.prefix` uygulanmaz; site
 *   origin'indeki `/assets/…` yolu döner (varsayılan `"cdn"`).
 * @returns {string}
 */
export declare function asset(name: string, options?: AssetOptions): string;
/**
 * @param {string} name
 * @returns {boolean}
 */
export declare function hasAsset(name: string): boolean;
/**
 * Bu build'i tanımlayan kısa kimlik (`build.json` → `id`).
 *
 * Paylaşımlı önbellek anahtarlarının isim alanı bu: saklanan HTML hash'li
 * varlık yollarını gömdüğü için bir deploy'dan sonra eski HTML **geçersizdir**.
 *
 * Build çalışmadıysa `"dev"` döner — build çıktısı olmadan da ayağa kalkma
 * kuralı burada da geçerli.
 *
 * @returns {string}
 */
export declare function getBuildId(): string;
export type OptimizedImage = {
    width: number;
    height: number;
    variants: {
        width: number;
        url: string;
    }[];
};
/**
 * `build/tasks/images.mjs` çıktısı: kaynak yolundan webp varyantlarına.
 * Build çalışmadıysa boş kalır ve görseller orijinalleriyle servis edilir.
 *
 * @param {string} [src] Örn. "/hero.png"
 * @returns {OptimizedImage | undefined}
 */
export declare function optimizedImage(src?: string): OptimizedImage | undefined;
/**
 * Sprite'taki sembol kimlikleri. Sprite yalnızca kaynakta **statik olarak**
 * görülen ikon adlarını içerir; adı çalışma anında hesaplanan bir `icon()`
 * çağrısı eksik sembole işaret ederse ekranda sessizce boşluk kalır. Dev'de
 * `icon()` bu kümeye bakıp uyarır.
 *
 * @returns {Set<string>}
 */
export declare function getSpriteIds(): Set<string>;
