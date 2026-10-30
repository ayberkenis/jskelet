import { registerAll, start, startSafeImages } from "jskelet/client";

/**
 * Global entry. Her sayfada yüklenir, bu yüzden burada yalnızca kayıt yapılır:
 * island modülleri sayfada karşılığı varken ve görünür olduğunda inilir.
 * `drive`: header yerinde kalır, yalnızca `#page-content` değişir.
 */
registerAll({
  "theme-toggle": () => import("../islands/theme-toggle.js"),
  tabs: () => import("../islands/tabs.js"),
  search: () => import("../islands/search.js"),
  "contact-form": () => import("../islands/contact-form.js"),
});

// Island kodu kullanıcı oraya bir ekran kala inmeye başlar.
start({ rootMargin: "100% 0px", drive: { root: "#page-content" } });

/** Kırık görselleri placeholder'a çevirir; `data-safe-image` taşıyanlar için. */
startSafeImages();
