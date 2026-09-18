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
 * Phosphor ikonları — build zamanı üretilen SVG sprite'tan `<use>`.
 * `weight` sprite id'sine dahildir (regular/bold/fill).
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
 * Layout `<head>` stylesheet'leri. `hasAsset` false olanları basmaz —
 * build yokken 404 link'i istememek için. `.jsk` ifade dilinde `asset()` /
 * `hasAsset()` çağrılamadığı için layout bu etiketi kullanır.
 *
 * @param {{ styles?: string[] }} [props]
 * @returns {string}
 */
export declare function stylesheets(props?: {
    styles?: string[];
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
