/**
 * Ertelenmiş panel (fragment) ucu.
 *
 * Sekmeli bir widget'ta sunucu yalnızca **aktif** paneli basar; diğerleri
 * `data-tab-src` ile işaretlenir ve istek üzerine buradan gelir. Böylece
 * markup'ın tek kaynağı sunucuda kalır — istemci ikinci bir şablon taşımaz —
 * ve ilk HTML görünmeyen panellerin ağırlığını ödemez.
 *
 * `renderView` layout'suz render eder: yanıt gövdesi doğrudan panelin
 * HTML'i olur.
 */
import { getPosts, getPostsByTag, getTags } from "../lib/posts.js";

export default function register(app, { renderView }) {
  app.get("/_fragment/posts-by-tag", async (req, res, next) => {
    const tag = String(req.query.tag ?? "");

    // İstenen anahtar verinin **kendi** anahtarlarına karşı doğrulanır;
    // sabit bir izin listesi tutmak etiket eklendiğinde unutuluyor.
    if (!getTags().includes(tag)) {
      res.status(404).type("text/plain").send("Not Found");
      return;
    }

    try {
      const html = await renderView("partials/post-rows", {
        posts: getPostsByTag(tag),
      });

      // Fragment'lar kısa süre cache'lenebilir; anahtar query'yi içerir.
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
      res.type("html").send(html);
    } catch (error) {
      next(error);
    }
  });

  app.get("/_fragment/latest", async (req, res, next) => {
    try {
      const html = await renderView("partials/post-rows", {
        posts: getPosts().slice(0, 3),
      });
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
      res.type("html").send(html);
    } catch (error) {
      next(error);
    }
  });
}
