/**
 * Oturum gerektiren sayfalar ve mutasyonlar.
 *
 * Sayfalar `route(fn, { private: true })` ile kayıtlı. Bayrağın yaptığı üç
 * şey: HTML cache devre dışı kalır, config'in `cache.html` deseni bu kararı
 * ezemez, yanıt `private, no-store` ve ETag'siz gider.
 */
import { currentUser } from "../lib/auth.js";
import { addNote, getNotes, getOrders, getSummary } from "../lib/data.js";

export default function register(app, { route, fragment, redirect, seeOther }) {
  /**
   * Oturum kontrolü controller'ın ilk satırında. Ayrı bir middleware de
   * olabilirdi; örnekte açıkça görünmesi tercih edildi, çünkü asıl mesaj
   * "kullanıcıyı okuyan sayfa `private` olmalı".
   *
   * @param {import('express').Request} req
   */
  const requireUser = (req) => {
    const user = currentUser(req);
    if (!user) {
      // Kontrol akışı istisnası: `route()` yakalar ve yönlendirmeyi yazar.
      redirect(`/giris?next=${encodeURIComponent(req.originalUrl)}`);
    }
    return /** @type {NonNullable<ReturnType<typeof currentUser>>} */ (user);
  };

  app.get(
    "/panel",
    route(
      async ({ req, query }) => {
        const user = requireUser(req);
        const page = Number(query.sayfa ?? 1);

        return {
          view: "pages/overview",
          metadata: { title: "Panel", robots: { index: false, follow: false } },
          data: {
            user,
            ozet: getSummary(user.username),
            siparisler: getOrders(user.username, Number.isFinite(page) ? page : 1),
            notlar: getNotes(user.username),
            notHatasi: query.not === "hata" ? "Not kaydedilemedi." : null,
          },
        };
      },
      { private: true },
    ),
  );

  /**
   * Not ekleme. İki istemciyi birden karşılıyor:
   *
   *   - JS açık: `form.js` gövdeyi fetch ile gönderir, `X-Requested-With`
   *     başlığını taşır ve yalnızca güncellenen parçayı bekler.
   *   - JS kapalı: tarayıcı formu normal gönderir, yanıt 303 olur ve panel
   *     baştan render edilir.
   *
   * İkinci yolun çalışmaya devam etmesi bir tercih değil: panelin temel
   * işlevleri JS'e bağlı olmamalı.
   *
   * `fragment()` burada POST için kullanılıyor çünkü verdiği üç şeye
   * ihtiyaç var — layout'suz render, `no-store` ve istek bağlamı. Bağlam
   * olmadan yeniden basılan formun `csrfField()`i boş çıkar ve kullanıcının
   * ikinci denemesi 403 alır.
   */
  app.post(
    "/panel/notlar",
    fragment(async ({ req }) => {
      const user = currentUser(req);
      if (!user) seeOther("/giris?next=%2Fpanel");

      const result = addNote(user.username, req.body?.metin);

      if (req.get("X-Requested-With") !== "fragment") {
        seeOther(result.ok ? "/panel" : "/panel?not=hata");
      }

      // Hata durumunda formun kendisi, başarıda güncellenen liste döner;
      // `form.js` ikisini yanıt koduna bakarak doğru yere takıyor.
      return result.ok
        ? { view: "partials/note-list", data: { notlar: getNotes(user.username) } }
        : {
            view: "partials/note-form",
            data: { hata: result.error, metin: String(req.body?.metin ?? "") },
            status: 422,
          };
    }),
  );
}
