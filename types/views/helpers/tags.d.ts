/**
 * `SeoLink` karşılığı: title otomatik doldurulur.
 * @param {{ href: string, text?: string, html?: string, class?: string,
 *   title?: string, ariaLabel?: string, target?: string, rel?: string,
 *   attrs?: Record<string, unknown> }} props
 * @returns {string}
 */
export declare function link(props: {
    href: string;
    text?: string;
    html?: string;
    class?: string;
    title?: string;
    ariaLabel?: string;
    target?: string;
    rel?: string;
    attrs?: Record<string, unknown>;
}): string;
/**
 * `next/image` karşılığı. `public/` altındaki yerel görseller için build'de
 * üretilen webp varyantları (`build/tasks/images.mjs`) otomatik olarak
 * `srcset` + intrinsic `width`/`height` olarak eklenir; manifest'te olmayan
 * yerel yollar olduğu gibi basılır.
 *
 * `images.remote.allowHosts` açıksa uzak http(s) URL'leri `/_jskelet/image`
 * proxy'sine çevrilir (webp + `w`). `unoptimized` veya elle `srcset` bunu
 * atlar.
 *
 * `priority` LCP görselleri için `fetchpriority=high` + eager yükleme yapar.
 * @param {{ src: string, alt: string, width?: number, height?: number,
 *   class?: string, sizes?: string, srcset?: string, priority?: boolean,
 *   fill?: boolean, loading?: 'lazy' | 'eager', unoptimized?: boolean,
 *   attrs?: Record<string, unknown> }} props
 * @returns {string}
 */
export declare function image(props: {
    src: string;
    alt: string;
    width?: number;
    height?: number;
    class?: string;
    sizes?: string;
    srcset?: string;
    priority?: boolean;
    fill?: boolean;
    loading?: 'lazy' | 'eager';
    unoptimized?: boolean;
    attrs?: Record<string, unknown>;
}): string;
/**
 * LCP görselleri için `<head>` preload etiketi.
 * @param {{ href: string, imagesrcset?: string, imagesizes?: string }} props
 * @returns {string}
 */
export declare function preloadImage({ href, imagesrcset, imagesizes }: {
    href: string;
    imagesrcset?: string;
    imagesizes?: string;
}): string;
/**
 * Kritik island paketleri için `<link rel="modulepreload">`.
 *
 * Bir island bugün üç turda iner: HTML → `main.js` → `import()` ile paket.
 * Kaynak yolu (`client/bundles/chrome.js`) build'in `preload.json`
 * haritasından hash'li chunk'a ve static import'larına çözülür ve hepsi
 * `<head>`'den istenir; ortadaki tur kalkar. Dinamik import'lar listeye
 * girmez, tembel kalmaları gerekir.
 *
 * URL'ler `build.assets.prefix`'e uyar. Ortak chunk'lar hem tek çağrıda hem
 * aynı istekteki çağrılar arasında bir kez basılır. `crossorigin` yazılmaz:
 * `<script type="module">` ile aynı varsayılan kimlik modu, preload'un
 * eşleşmesi için gereken bu.
 *
 * Build yoksa boş string döner. Harita kaynağı tanımıyorsa (yanlış yol ya da
 * hiçbir entry'den erişilmeyen modül) dev'de bir kez uyarır.
 *
 * @param {string | string[] | { src?: string | string[] }} source
 * @returns {string}
 */
export declare function modulePreload(source: string | string[] | {
    src?: string | string[];
}): string;
/**
 * Phosphor ikonları — build zamanı üretilen SVG sprite'tan `<use>`.
 * `weight` sprite id'sine dahildir (regular/bold/fill).
 *
 * Sprite URL'si her zaman site origin'indedir (`asset(..., { origin:
 * "document" })`). `<use href>` çapraz origin SVG yüklemez; CDN prefix
 * açıkken bile `public/assets/sprite.<hash>.svg` aynı host'tan gelir.
 *
 * @param {{ name: string, size?: number | string, weight?: string,
 *   class?: string, attrs?: Record<string, unknown> }} props
 * @returns {string}
 */
export declare function icon(props: {
    name: string;
    size?: number | string;
    weight?: string;
    class?: string;
    attrs?: Record<string, unknown>;
}): string;
/**
 * Formun içine CSRF token'ını gizli alan olarak basar.
 *
 * Token **burada** üretilir ve imzalı cookie olarak yazılır: bir sayfada
 * token gerçekten gerekiyorsa o sayfa zaten kişiye özeldir. Bu yüzden çağrı
 * render'ı işaretler (`tainted`) ve sayfa public HTML cache'ine giremez —
 * aksi hâlde tüm ziyaretçiler cache'ten aynı token'ı alırdı ve çift gönderim
 * kontrolü hiçbir şey doğrulamazdı.
 *
 * `security.csrf.token` kapalıysa boş string döner; şablon her koşulda
 * render edilebilmeli, korumanın açık olması config'in kararı.
 *
 * @returns {string}
 */
export declare function csrfField(): string;
/**
 * `ArrowRightIcon` / `ArrowRight` → `arrow-right`
 * @param {string} name
 * @returns {string}
 */
export declare function toKebab(name: string): string;
/**
 * Layout `<head>` stylesheet'leri. Sayfa sheet'i varsa global CSS'i zaten
 * taşıyan bu birleşik varlık basılır; yoksa `app.css` kullanılır. `hasAsset`
 * false olanları basmaz — build yokken 404 link'i istememek için. `.jsk`
 * ifade dilinde `asset()` / `hasAsset()` çağrılamadığı için layout bu etiketi
 * kullanır.
 *
 * `blocking` varsayılan `true`: `<link rel="stylesheet">` boyamayı bekletir.
 * Ölçümde bu, sheet geç gelince oluşan CLS'ten daha ucuz. `false` yalnızca
 * açık boolean'dır (`:blocking="false"`); atlamak veya `true` aynı çıktıyı
 * verir.
 *
 * String bir media sorgusu (`blocking="(min-width: 1024px)"`) beklemeyi o
 * sorguya bağlar: eşleşen ekranda link render-blocking, eşleşmeyende
 * `false` ile aynı yoldan iner ve yüklenince uygulanır. Geniş ekranda CLS,
 * dar ekranda LCP önemliyse iki takası tek linkte birleştirir. Literal
 * `"true"` / `"false"` string'leri sorgu sayılmaz; eski çıktı (blocking)
 * korunur.
 *
 * @param {{ styles?: string[], blocking?: boolean | string }} [props]
 * @returns {string}
 */
export declare function stylesheets(props?: {
    styles?: string[];
    blocking?: boolean | string;
}): string;
/**
 * Layout gövde sonu script'leri: `main.js`, controller `entries`, isteğe
 * bağlı dev overlay.
 *
 * @param {{ entries?: string[], devtools?: boolean, devBasePath?: string }} [props]
 * @returns {string}
 */
export declare function bodyScripts(props?: {
    entries?: string[];
    devtools?: boolean;
    devBasePath?: string;
}): string;
/**
 * JSON-LD script etiketleri. `structuredData` dizisindeki her öğe için bir
 * `<script type="application/ld+json">`.
 *
 * @param {{ items?: unknown[] }} [props]
 * @returns {string}
 */
export declare function jsonLd(props?: {
    items?: unknown[];
}): string;
