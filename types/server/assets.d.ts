export type AssetState = {
    manifest: Record<string, string>;
    generated: string;
    stamp: string;
};
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
 * Stylesheet hash'i değişince (aynı `generated` kökünde) çağrılır. HTML
 * cache L1'i buradan düşürür; Redis/disk eski `a=` anahtarında kalır ve
 * TTL ile ölür.
 *
 * @param {(next: string, prev: string) => void} listener
 * @returns {void}
 */
export declare function onStylesheetHashChange(listener: (next: string, prev: string) => void): void;
/**
 * Manifest'teki CSS girdilerinin içerik hash'i. `cache().vary.assets`
 * bunu HTML anahtarına `a=<hash>` olarak yazar.
 *
 * @returns {string}
 */
export declare function getStylesheetHash(): string;
/**
 * Bu build'i tanımlayan kısa kimlik: `<asset>-<şablon>`.
 *
 * Paylaşımlı önbellek anahtarlarının isim alanı bu: saklanan HTML hash'li
 * varlık yollarını ve layout'un ürettiği `<head>`'i gömdüğü için ikisinden
 * biri değişince eski HTML **geçersizdir**. Asset kısmı `build.json` → `id`
 * (manifest hash'i), şablon kısmı view kaynaklarının parmak izi
 * (`templates-fingerprint.mjs`). Yalnızca manifest'e bakmak, CSS/JS'e
 * dokunmayan bir layout değişikliğinde eski HTML'i Redis'ten TTL boyunca
 * geri getiriyordu.
 *
 * Build çalışmadıysa asset kısmı `"dev"` olur — build çıktısı olmadan da
 * ayağa kalkma kuralı burada da geçerli. Parmak izi hesaplanamazsa (config
 * yok) yalnızca asset kısmı döner.
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
export type PreloadState = {
    generated: string;
    table: Record<string, string[]>;
    byStem: Map<string, string>;
};
/**
 * Kaynak modül yolunu (`client/bundles/chrome.js`) hash'li chunk'ına ve onun
 * static import kapanışına çevirir; CDN prefix uygulanmış URL'ler döner, ilk
 * eleman modülün kendisi.
 *
 * Yol proje köküne göredir; baştaki `./`, `/` ve `@/` yok sayılır. `null`
 * → harita var ama kaynak içinde yok (yanlış yol ya da hiçbir entry'den
 * erişilmeyen modül). Build hiç çalışmadıysa boş dizi döner: build çıktısı
 * olmadan ayağa kalkma kuralı.
 *
 * @param {string} source
 * @returns {string[] | null}
 */
export declare function modulePreloadUrls(source: string): string[] | null;
/**
 * Sprite'taki sembol kimlikleri. Sprite yalnızca kaynakta **statik olarak**
 * görülen ikon adlarını içerir; adı çalışma anında hesaplanan bir `icon()`
 * çağrısı eksik sembole işaret ederse ekranda sessizce boşluk kalır. Dev'de
 * `icon()` bu kümeye bakıp uyarır.
 *
 * @returns {Set<string>}
 */
export declare function getSpriteIds(): Set<string>;
