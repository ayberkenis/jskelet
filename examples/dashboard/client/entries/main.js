import { registerAll, start, startForms, startSwapLinks } from "jskelet/client";

/**
 * Panelin global entry'si.
 *
 * Üç satırın üçü de delege dinleyici kuruyor: `data-swap` taşıyan bağlantılar,
 * `data-enhance` taşıyan formlar ve `data-island` taşıyan elementler. Delege
 * olmaları önemli — fragment takasıyla sonradan DOM'a giren işaretleme de
 * kapsanıyor, her takastan sonra yeniden bağlama gerekmiyor.
 */
registerAll({
  "live-clock": () => import("../islands/live-clock.js"),
});

start();

/** `data-swap` taşıyan sayfalama bağlantıları. */
startSwapLinks();

/** `data-enhance` taşıyan formlar. */
startForms();
