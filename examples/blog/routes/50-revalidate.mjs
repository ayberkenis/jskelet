/**
 * "Bu içerik güncellendi" webhook'u.
 *
 * Bir CMS ya da yönetim paneli, yazı değiştiğinde burayı çağırır ve sayfa
 * TTL'in dolmasını beklemeden tazelenir. İki yol var:
 *
 *   - `invalidateHtmlCache(yol)` — hangi sayfaların etkilendiğini biliyorsanız.
 *   - `clearDataCache(önek)` — veri katmanı `withDataCache` kullanıyorsa daha
 *     iyisi: o veriyi okumuş **bütün** sayfalar kendiliğinden bayatlar, liste
 *     sayfasını unutma ihtimali kalmaz (bkz. docs/06-cache.md).
 *
 * Invalidation varsayılan olarak silmez, bayatlatır: ziyaretçi eski HTML'i
 * beklemeden alır, tazeleme arkada koşar. Yüzlerce sayfayı aynı anda soğuk
 * render'a çevirmek, tam da içeriğin güncellendiği anda upstream'i dövmek olurdu.
 *
 * Token kontrolü 404 döner, 401 değil: ucun varlığını bile bildirmeye gerek yok.
 */
import { invalidateHtmlCache } from "jskelet";

export default function register(app) {
  app.post("/_admin/revalidate", (req, res) => {
    if (
      !process.env.ADMIN_TOKEN ||
      req.headers["x-admin-token"] !== process.env.ADMIN_TOKEN
    ) {
      res.status(404).end();
      return;
    }

    const slug = typeof req.body?.slug === "string" ? req.body.slug : null;

    // Yazı sayfası ve onu listeleyen sayfalar birlikte tazelenir; ana sayfa
    // ile etiket sayfaları o yazıyı gösterdiği için listede olmaları şart.
    const targets = slug
      ? [`/blog/${slug}`, "/", "/blog", "/etiket/:tag"]
      : [/^\//];

    res.json({ ok: true, invalidated: invalidateHtmlCache(targets) });
  });
}
