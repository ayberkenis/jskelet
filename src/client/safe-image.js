/**
 * Yüklenemeyen görseller için tek bir belge dinleyicisi.
 *
 * Bu iş bilinçli olarak **island değil**. Görsel ağırlıklı bir sayfada 80+
 * `<img>` olabiliyor ve her birine ayrı island bağlamak (gözlemci + dinamik
 * import + mount) sırf hata ihtimali için ciddi bir hidrasyon yükü. `error`
 * olayı kabarmaz ama yakalama fazında görülebilir, bu yüzden tek dinleyici
 * hepsini karşılar ve sonradan DOM'a eklenen görseller de kendiliğinden
 * kapsanır.
 *
 * Kullanım: görsele `data-safe-image` ekleyin. Kendi hata görünümünüzü
 * vermek için görseli `data-safe-image-host` taşıyan bir sarmalayıcıya alın
 * ve içine `<template data-safe-image-fallback>` koyun — framework hiçbir
 * stil dayatmaz, yalnızca değiştirme işini yapar.
 */

const MARKER = "data-safe-image";

/**
 * Şablon verilmemişse yerine geçen minimal blok: görselin ölçülerini korur
 * ki değiştirme sırasında düzen kaymasın (CLS).
 *
 * @param {HTMLImageElement} img
 * @returns {HTMLElement}
 */
function buildFallback(img) {
  const element = document.createElement("div");
  const label = img.dataset.fallbackLabel || img.getAttribute("alt") || "";

  element.className = [img.className, img.dataset.fallbackClass ?? ""]
    .filter(Boolean)
    .join(" ");
  element.dataset.safeImageFallback = "";

  if (img.width && img.height) {
    element.style.width = `${img.width}px`;
    element.style.height = `${img.height}px`;
  }

  element.setAttribute("role", "img");
  if (label) element.setAttribute("aria-label", label);

  return element;
}

/**
 * @param {HTMLImageElement} img
 */
function replace(img) {
  if (!img.isConnected) return;

  const host = img.closest("[data-safe-image-host]");
  const template = host?.querySelector("template[data-safe-image-fallback]");

  if (host && template) {
    host.replaceWith(template.content.cloneNode(true));
    return;
  }

  img.replaceWith(buildFallback(img));
}

/**
 * @returns {void}
 */
export function startSafeImages() {
  document.addEventListener(
    "error",
    (event) => {
      const target = /** @type {HTMLElement} */ (event.target);
      if (target?.tagName !== "IMG" || !target.hasAttribute(MARKER)) return;
      replace(/** @type {HTMLImageElement} */ (target));
    },
    // `error` kabarmaz; yalnızca yakalama fazında görülür.
    true,
  );

  // JS çalışmadan önce başarısız olmuş görseller olay üretmez; bir kez taranır.
  const sweep = () => {
    for (const img of document.querySelectorAll(`img[${MARKER}]`)) {
      const image = /** @type {HTMLImageElement} */ (img);
      if (image.complete && image.naturalWidth === 0) replace(image);
    }
  };

  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(sweep, { timeout: 2000 });
  } else {
    setTimeout(sweep, 0);
  }
}
