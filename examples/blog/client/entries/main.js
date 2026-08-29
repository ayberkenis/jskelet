import { registerAll, start, startSafeImages } from "jskelet/client";

/**
 * Global entry. Her sayfada yüklenir, bu yüzden burada yalnızca kayıt yapılır:
 * island modülleri sayfada karşılığı varken ve görünür olduğunda inilir.
 */
registerAll({
  "theme-toggle": () => import("../islands/theme-toggle.js"),
  tabs: () => import("../islands/tabs.js"),
  search: () => import("../islands/search.js"),
  "contact-form": () => import("../islands/contact-form.js"),
});

start();

/** Kırık görselleri placeholder'a çevirir; `data-safe-image` taşıyanlar için. */
startSafeImages();
