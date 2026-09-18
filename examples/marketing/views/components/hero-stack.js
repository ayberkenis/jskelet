import { esc } from "jskelet/html";

/**
 * Ana sayfa hero'sunun sağındaki 3D katman illüstrasyonu. Raster PNG
 * `public/hero-stack.png`; CSS sahnesi yok — görselin kendisi derinlik
 * taşıyor, sayfada yalnızca hafif float kalır.
 *
 * @param {{ diagramLabel: string, logoAlt: string }} props
 * @returns {string}
 */
export function heroStack({ diagramLabel, logoAlt }) {
  return `<figure class="hero-visual">
    <img
      src="/hero-stack.png"
      alt="${esc(logoAlt)}"
      width="1024"
      height="853"
      decoding="async"
      fetchpriority="high"
    >
    <figcaption class="sr-only">${esc(diagramLabel)}</figcaption>
  </figure>`;
}
