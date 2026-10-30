import { registerAll, start, startSafeImages } from "jskelet/client";

/**
 * Global entry. Her sayfada yüklenir, bu yüzden burada yalnızca kayıt yapılır:
 * island modülleri sayfada karşılığı varken ve görünür olduğunda inilir.
 * `drive: true`: belge ziyareti; `data-permanent` host'lar sökülmez.
 */
registerAll({
  "theme-toggle": () => import("../islands/theme-toggle.js"),
  tabs: () => import("../islands/tabs.js"),
  search: () => import("../islands/search.js"),
  "contact-form": () => import("../islands/contact-form.js"),
});

// Island kodu kullanıcı oraya bir ekran kala inmeye başlar.
start({ rootMargin: "100% 0px", drive: true });

/** Kırık görselleri placeholder'a çevirir; `data-safe-image` taşıyanlar için. */
startSafeImages();
