/**
 * `/compare` sayfasındaki canlı ölçümün kontrol grubu.
 *
 * Bilinçli olarak **cache'siz**: her istekte gerçekten render edilir ve
 * `no-store` ile döner. Sayfadaki `latency` island'ı bir yanda cache'ten dönen
 * ana sayfayı, öbür yanda burayı ölçüyor; aradaki fark ağ ya da makine değil,
 * doğrudan HTML TTL cache'inin kendisi.
 *
 * Ölçülen şey render maliyeti olduğu için içerik dilinin bir önemi yok:
 * varsayılan dilin sözlüğü kullanılıyor ve uç dil başına çoğaltılmıyor.
 *
 * `renderView` layout'suz render eder: gövde doğrudan parçanın HTML'i olur.
 */
import { getContent } from "../lib/content.js";
import { DEFAULT_LOCALE } from "../lib/i18n.js";

export default function register(app, { renderView }) {
  app.get("/_fragment/render-demo", async (req, res, next) => {
    try {
      const html = await renderView("partials/render-demo", {
        rows: getContent(DEFAULT_LOCALE).comparison.rows,
      });

      // Ölçümün anlamı buna bağlı: bu uç önbelleğe girerse iki taraf da
      // cache'ten dönen aynı şeyi ölçer ve karşılaştırma anlamsızlaşır.
      res.setHeader("Cache-Control", "no-store");
      res.type("html").send(html);
    } catch (error) {
      next(error);
    }
  });
}
