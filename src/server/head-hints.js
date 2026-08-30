/**
 * `<head>` kaynak ipuçları — `react-dom`'un preconnect/preload çağrılarının
 * karşılığı.
 *
 * Layout bu bloğu `<head>`in en başına basar: preconnect ve LCP preload'ını
 * geciktirmek doğrudan LCP'ye yazılır. Preconnect listesi her sayfada aynı
 * olduğu için bir kez hesaplanır; sayfaya özel görsel preload'ını
 * controller `head` alanıyla `headHints()` üzerinden ekler.
 */
import { getConfig } from "../config/index.js";
import { preloadImage } from "../views/helpers/tags.js";
import { esc, jsonScript } from "../views/helpers/html.js";

/** @type {string | null} */
let cached = null;

/**
 * `jskelet.config.mjs` → `preconnect: ["https://cdn.example.com"]`.
 * Üçüncü taraf kaynaklar (görsel CDN'i, API origin'i, font host'u) buraya
 * yazılır. Boş liste geçerli bir yapılandırmadır.
 *
 * @returns {string}
 */
export function preconnectHints() {
  if (cached != null) return cached;

  cached = getConfig()
    .preconnect.map((origin) => {
      try {
        return `<link rel="preconnect" href="${esc(new URL(origin).origin)}">`;
      } catch {
        console.warn(`[head] invalid preconnect URL, skipped: ${origin}`);
        return "";
      }
    })
    .join("");

  return cached;
}

/**
 * Spekülasyondan her koşulda muaf tutulan bağlantılar. `nofollow` ve
 * `target=_blank` zaten site içi gezinme değil; `data-no-prefetch` ise
 * uygulamanın tek bir bağlantıyı elle dışarıda bırakma yolu (oturum kapatma
 * gibi yan etkili hedefler için).
 */
const EXEMPT_SELECTORS = ["[rel~=nofollow]", "[target=_blank]", "[data-no-prefetch]"];

/**
 * Speculation Rules gövdesini üretir. `getConfig()`ten ayrı tutulmasının
 * sebebi test edilebilirlik: kural üretimi saf bir dönüşüm.
 *
 * @param {import('../config/index.js').NavigationConfig} navigation
 * @returns {object | null} Hiç kural yoksa `null`.
 */
export function buildSpeculationRules(navigation) {
  /** @type {Record<string, object[]>} */
  const rules = {};

  // `href_matches: "/*"` yalnızca aynı origin'deki yolları eşler; dış
  // bağlantılar için spekülasyon hem anlamsız hem gizlilik açısından istenmez.
  const where = {
    and: [
      { href_matches: "/*" },
      ...navigation.exclude.map((pattern) => ({ not: { href_matches: pattern } })),
      ...EXEMPT_SELECTORS.map((selector) => ({ not: { selector_matches: selector } })),
    ],
  };

  if (navigation.prefetch) {
    rules.prefetch = [{ where, eagerness: navigation.prefetch }];
  }
  if (navigation.prerender) {
    rules.prerender = [{ where, eagerness: navigation.prerender }];
  }

  return Object.keys(rules).length ? rules : null;
}

/** @type {string | null} */
let navigationCached = null;

/**
 * Site içi gezinme ipuçları: Speculation Rules + cross-document view
 * transition. İkisi de her sayfada aynı olduğu için bir kez hesaplanır.
 *
 * Bunlar bilinçli olarak client runtime'ı değil: tarayıcı bağlantı üzerinde
 * duraksamayı, önceliklendirmeyi ve iptali kendisi yönetiyor. Aynı davranışı
 * JS ile yazmak hem daha fazla bayt hem daha kötü bir tahmin demek.
 *
 * @returns {string}
 */
export function navigationHints() {
  if (navigationCached != null) return navigationCached;

  const { navigation } = getConfig();
  const rules = buildSpeculationRules(navigation);

  // Geçiş kuralı hem eski hem yeni belgede bulunmalı; her sayfaya basılan
  // satır içi bir kural bunu build çıktısına bağımlı olmadan garanti eder.
  // Hareket azaltma tercihi burada karşılanır: sayfa geçişi tam ekran bir
  // çapraz geçiş üretir ve bu, vestibüler rahatsızlığı olan kullanıcılar için
  // kaçınılması gereken türden bir animasyon.
  const transition = navigation.viewTransition
    ? "<style>@view-transition{navigation:auto}" +
      "@media (prefers-reduced-motion:reduce){@view-transition{navigation:none}}</style>"
    : "";

  navigationCached =
    (rules ? `<script type="speculationrules">${jsonScript(rules)}</script>` : "") +
    transition;

  return navigationCached;
}

/**
 * İlk ekrandaki görselin preload'ı. Preconnect'leri layout zaten her sayfaya
 * bastığı için burada tekrarlanmaz.
 *
 * @param {{ href?: string | null, imageSrcSet?: string,
 *   imageSizes?: string }} [lcpImage]
 * @returns {string}
 */
export function headHints(lcpImage) {
  if (!lcpImage?.href) return "";

  return preloadImage({
    href: lcpImage.href,
    imagesrcset: lcpImage.imageSrcSet,
    imagesizes: lcpImage.imageSizes,
  });
}
