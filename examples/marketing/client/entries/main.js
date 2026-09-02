import { registerAll, start } from "jskelet/client";

/**
 * Tek entry. Buradaki her kayıt yalnızca bir **dinamik import** referansı;
 * island'ın kendi modülü ancak sayfada o `data-island` varsa ve görünürlüğe
 * girdiğinde iniyor. Pazarlama sayfalarında bunun pratik sonucu şu: ana
 * sayfada tema düğmesi ve menü dışında hiçbir şey hemen yüklenmiyor.
 */
registerAll({
  "theme-toggle": () => import("../islands/theme-toggle.js"),
  "nav-toggle": () => import("../islands/nav-toggle.js"),
  "copy-command": () => import("../islands/copy-command.js"),
  "doc-toc": () => import("../islands/doc-toc.js"),
  "changelog-jump": () => import("../islands/changelog-jump.js"),
  bars: () => import("../islands/bars.js"),
  latency: () => import("../islands/latency.js"),
  "ops-story": () => import("../islands/ops-story.js"),
});

start();
