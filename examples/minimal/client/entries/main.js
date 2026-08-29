import { registerAll, start } from "jskelet/client";

/**
 * Island kaydı: ad → dinamik import. Modül yalnızca sayfada o island varsa
 * ve görünür olduğunda indirilir, yani bu haritayı büyütmek ilk yükü
 * büyütmez.
 */
registerAll({
  counter: () => import("../islands/counter.js"),
});

start();
