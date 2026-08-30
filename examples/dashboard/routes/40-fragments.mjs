/**
 * Sipariş tablosunun sayfalama ucu.
 *
 * `fragment()` politikayı sabitliyor: layout basılmaz, yanıt `private,
 * no-store` ve ETag'siz gider, HTML cache'e hiç uğramaz. Elle yazıldığında
 * en sık atlanan şey `no-store`'du — kişiye özel bir parçanın araya giren bir
 * katmanda saklanması, bir kullanıcının siparişlerinin başkasına gösterilmesi
 * demek.
 *
 * İstemci tarafı `data-swap` ile bağlanıyor (bkz. views/partials/order-table).
 * Verinin ne zaman tazeleneceğini uygulama seçiyor — burada bir tıklama, ama
 * aynı ucu bir SSE olayı ya da WebSocket mesajı da tetikleyebilir; framework
 * taşıma katmanına karışmıyor.
 */
import { currentUser } from "../lib/auth.js";
import { getOrders } from "../lib/data.js";

export default function register(app, { fragment }) {
  app.get(
    "/_fragment/siparisler",
    fragment(async ({ req, query }) => {
      const user = currentUser(req);

      // Oturum düşmüşse tabloya login formu takmak anlamsız; küçük bir uyarı
      // parçası dönüyor ve istemci sayfayı yenilemeye çağırıyor.
      if (!user) {
        return { view: "partials/session-expired", status: 401 };
      }

      const page = Number(query.sayfa ?? 1);

      return {
        view: "partials/order-table",
        data: {
          siparisler: getOrders(user.username, Number.isFinite(page) ? page : 1),
        },
      };
    }),
  );
}
