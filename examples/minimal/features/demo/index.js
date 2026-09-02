/**
 * Feature-first örnek: route kaydı + sayfa aynı feature altında.
 * URL hâlâ açıkça yazılır; filesystem routing yoktur.
 */
export default function register(app, { route }) {
  app.get(
    "/demo",
    route(async () => ({
      view: "pages/demo",
      metadata: { title: "Demo feature" },
      data: {
        message: "Bu sayfa features/demo altında yaşıyor.",
      },
    })),
  );
}
