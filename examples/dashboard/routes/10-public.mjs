/**
 * Public yüzey: tanıtım sayfası, giriş formu ve çıkış.
 *
 * Ana sayfa ve giriş sayfası cache'lenebilir — ikisi de herkese aynı gidiyor.
 * Giriş **formunun** kendisi cache'lenebilir ama CSRF token'ı basıldığı anda
 * `csrfField()` render'ı işaretliyor ve sayfa otomatik olarak cache dışına
 * çıkıyor. Bu, korumanın işlediğini gösteren küçük ama önemli bir ayrıntı:
 * cache'ten dönen bir sayfa tüm ziyaretçilere aynı token'ı verirdi.
 */
import { endSession, startSession, verify } from "../lib/auth.js";

export default function register(app, { route, redirect }) {
  app.get(
    "/",
    route(async () => ({
      view: "pages/home",
      metadata: { title: "Ana sayfa", canonical: "/" },
    })),
  );

  app.get(
    "/giris",
    route(async ({ query, req }) => ({
      view: "pages/login",
      metadata: { title: "Giriş", canonical: "/giris" },
      data: {
        hata: query.hata === "1" ? "Kullanıcı adı ya da parola hatalı." : null,
        // Girişten sonra kullanıcıyı istediği sayfaya götürmek için. Yalnızca
        // kendi sitemizdeki yollar kabul edilir: dışarıdan gelen bir `next`
        // değeri açık yönlendirme (open redirect) demek olurdu.
        next: safeNext(query.next),
        cikti: query.cikti === "1",
        // `req` burada yalnızca token cookie'sinin yazılabilmesi için akışta;
        // şablon `csrfField()` çağırıyor.
        istek: Boolean(req),
      },
    })),
  );

  app.post("/giris", (req, res) => {
    const user = verify(String(req.body?.kullanici ?? ""), String(req.body?.parola ?? ""));

    if (!user) {
      // Hangi alanın hatalı olduğunu söylemiyoruz: var olan kullanıcı adlarını
      // sızdırmamak için tek ve aynı mesaj.
      res.redirect(303, "/giris?hata=1");
      return;
    }

    startSession(res, user.username);
    res.redirect(303, safeNext(req.body?.next) ?? "/panel");
  });

  /**
   * Çıkış POST: GET olsaydı bir görsel etiketi ya da önden getirme
   * kullanıcıyı sessizce oturumdan atabilirdi.
   */
  app.post("/cikis", (req, res) => {
    endSession(res);
    res.redirect(303, "/giris?cikti=1");
  });

  app.get("/cikis", () => {
    redirect("/panel");
  });

  app.get("/api/healthcheck", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, uptime: process.uptime() });
  });
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function safeNext(value) {
  const raw = typeof value === "string" ? value : "";
  // Tek eğik çizgiyle başlayan, protokol içermeyen yollar: `//evil.com`
  // tarayıcıda protokol-göreli mutlak URL olarak çözülür, o yüzden dışarıda.
  return /^\/(?!\/)[\w\-./?=&%]*$/.test(raw) ? raw : null;
}
