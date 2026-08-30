/**
 * `next/link`, `next/image` ve `@phosphor-icons/react` karşılıkları.
 * Hepsi HTML string döndürür; EJS içinden `<%- %>` ile basılır.
 */
import { attrs, esc, cn } from "./html.js";
import { asset, getSpriteIds, optimizedImage } from "../../server/assets.js";
import { getRequestContext, markTainted } from "../../http/request-context.js";
import { getSignedCookie, randomToken, setSignedCookie } from "../../http/cookies.js";
import { getConfig } from "../../config/index.js";

const isDev = process.env.NODE_ENV === "development";

/** Aynı eksik ikon için tek uyarı. */
const warnedIcons = new Set();

/**
 * `SeoLink` karşılığı: title otomatik doldurulur.
 * @param {{ href: string, text?: string, html?: string, class?: string,
 *   title?: string, ariaLabel?: string, target?: string, rel?: string,
 *   attrs?: Record<string, unknown> }} props
 * @returns {string}
 */
export function link(props) {
  const {
    href,
    text,
    html,
    class: className,
    title,
    ariaLabel,
    target,
    rel,
    attrs: extra = {},
  } = props;

  const resolvedTitle = title ?? ariaLabel ?? text ?? href;
  const isExternal = /^https?:\/\//.test(String(href ?? ""));

  const attributes = attrs({
    href,
    class: className,
    title: resolvedTitle,
    "aria-label": ariaLabel,
    target: target ?? (isExternal ? "_blank" : undefined),
    rel: rel ?? (isExternal ? "noopener noreferrer" : undefined),
    ...extra,
  });

  return `<a${attributes}>${html ?? esc(text ?? "")}</a>`;
}

/**
 * `next/image` karşılığı. `public/` altındaki yerel görseller için build'de
 * üretilen webp varyantları (`build/tasks/images.mjs`) otomatik olarak
 * `srcset` + intrinsic `width`/`height` olarak eklenir; manifest'te olmayan
 * ya da uzak görseller olduğu gibi basılır.
 *
 * `priority` LCP görselleri için `fetchpriority=high` + eager yükleme yapar.
 * @param {{ src: string, alt: string, width?: number, height?: number,
 *   class?: string, sizes?: string, srcset?: string, priority?: boolean,
 *   fill?: boolean, loading?: 'lazy' | 'eager', unoptimized?: boolean,
 *   attrs?: Record<string, unknown> }} props
 * @returns {string}
 */
export function image(props) {
  const {
    src,
    alt,
    width,
    height,
    class: className,
    sizes,
    srcset,
    priority = false,
    fill = false,
    loading,
    unoptimized = false,
    attrs: extra = {},
  } = props;

  const optimized = unoptimized || srcset ? undefined : optimizedImage(src);
  const largest = optimized?.variants.at(-1);
  // Tek varyant üretilmişse (kaynak zaten küçükse) srcset/sizes gürültüden ibaret.
  const responsive = optimized && optimized.variants.length > 1;

  const attributes = attrs({
    src: largest?.url ?? src,
    alt: alt ?? "",
    width: fill ? undefined : (width ?? optimized?.width),
    height: fill ? undefined : (height ?? optimized?.height),
    class: fill
      ? cn("absolute inset-0 h-full w-full object-cover", className)
      : className,
    sizes: responsive ? (sizes ?? defaultSizes(optimized)) : sizes,
    srcset: responsive ? toSrcSet(optimized) : srcset,
    loading: loading ?? (priority ? "eager" : "lazy"),
    decoding: priority ? "sync" : "async",
    fetchpriority: priority ? "high" : undefined,
    ...extra,
  });

  return `<img${attributes}>`;
}

/**
 * @param {import("../../server/assets.js").OptimizedImage} optimized
 * @returns {string}
 */
function toSrcSet(optimized) {
  return optimized.variants
    .map((variant) => `${variant.url} ${variant.width}w`)
    .join(", ");
}

/**
 * Çağıran `sizes` vermediyse makul bir varsayılan: görsel kendi intrinsic
 * genişliğinden büyütülmez, dar ekranlarda viewport'u kaplar.
 * @param {import("../../server/assets.js").OptimizedImage} optimized
 * @returns {string}
 */
function defaultSizes(optimized) {
  const max = optimized.variants.at(-1)?.width ?? optimized.width;
  return `(max-width: ${max}px) 100vw, ${max}px`;
}

/**
 * LCP görselleri için `<head>` preload etiketi.
 * @param {{ href: string, imagesrcset?: string, imagesizes?: string }} props
 * @returns {string}
 */
export function preloadImage({ href, imagesrcset, imagesizes }) {
  return `<link${attrs({
    rel: "preload",
    as: "image",
    href,
    imagesrcset,
    imagesizes,
    fetchpriority: "high",
  })}>`;
}

/**
 * Phosphor ikonları — build zamanı üretilen SVG sprite'tan `<use>`.
 * `weight` sprite id'sine dahildir (regular/bold/fill).
 * @param {{ name: string, size?: number | string, weight?: string,
 *   class?: string, attrs?: Record<string, unknown> }} props
 * @returns {string}
 */
export function icon(props) {
  const {
    name,
    size = 24,
    weight = "regular",
    class: className,
    attrs: extra = {},
  } = props;

  const spritePath = asset("sprite.svg");
  const id = `${toKebab(name)}-${weight}`;

  if (isDev && !warnedIcons.has(id)) {
    const ids = getSpriteIds();
    if (ids.size && !ids.has(id)) {
      warnedIcons.add(id);
      console.warn(
        `[icon] missing from sprite: ${id} — write the name as a literal or add it to the build/tasks/icons.mjs scan.`,
      );
    }
  }

  const attributes = attrs({
    width: size,
    height: size,
    class: className,
    "aria-hidden": "true",
    focusable: "false",
    fill: "currentColor",
    viewBox: "0 0 256 256",
    ...extra,
  });

  return `<svg${attributes}><use href="${esc(spritePath)}#${esc(id)}"></use></svg>`;
}

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
export function csrfField() {
  const context = getRequestContext();
  if (!context?.res) return "";

  const { csrf } = getConfig().security;
  if (!csrf.token) return "";

  if (!context.csrfToken) {
    const existing = getSignedCookie(context.res.req, csrf.cookieName);
    const token = existing ?? randomToken(24);

    if (!existing) {
      try {
        setSignedCookie(context.res, csrf.cookieName, token, {
          // Token'ı istemci cookie'den değil, basılan gizli alandan okur;
          // HttpOnly kalması XSS durumunda bir katman daha demek.
          httpOnly: true,
        });
      } catch (error) {
        console.warn(
          "[csrf] could not emit the token: no secret for signed cookies",
          error instanceof Error ? error.message : error,
        );
        return "";
      }
    }

    context.csrfToken = token;
  }

  markTainted("csrfField()");

  return `<input type="hidden" name="${esc(csrf.fieldName)}" value="${esc(context.csrfToken)}">`;
}

/**
 * `ArrowRightIcon` / `ArrowRight` → `arrow-right`
 * @param {string} name
 * @returns {string}
 */
export function toKebab(name) {
  return String(name)
    .replace(/Icon$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
