/**
 * `/kiyaslama` sayfasındaki canlı ölçümün kontrol grubu.
 *
 * Bilinçli olarak **cache'siz**: her istekte gerçekten render edilir ve
 * `no-store` ile döner. Sayfadaki `latency` island'ı bir yanda cache'ten dönen
 * `/`yi, öbür yanda burayı ölçüyor; aradaki fark ağ ya da makine değil,
 * doğrudan HTML TTL cache'inin kendisi.
 *
 * `renderView` layout'suz render eder: gövde doğrudan parçanın HTML'i olur.
 */
import { comparison } from "../lib/content.js";

export default function register(app, { renderView }) {
  app.get("/_fragment/render-demo", async (req, res, next) => {
    try {
      const html = await renderView("partials/render-demo", {
        rows: comparison.rows,
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
