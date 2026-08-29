/**
 * Pazarlama sayfaları. Hepsi anonim ve içerik derleme zamanında bilindiği için
 * `revalidate` uzun; gerçek TTL'ler `jskelet.config.mjs` içindeki `cache().html`
 * tablosundan geliyor ve buradaki değerleri ezer. İkisini birlikte yazmanın
 * faydası: config'i olmayan bir kurulumda da makul bir davranış kalıyor.
 */
import {
  comparison,
  faq,
  fit,
  migration,
  pillars,
  pipeline,
} from "../lib/content.js";
import { getPayload } from "../lib/payload.js";

const HOUR = 3600;

export default function register(app, { route }) {
  app.get(
    "/",
    route(
      async () => ({
        view: "pages/home",
        metadata: {
          title: "Sunucuda tam HTML, gereken kadar JS",
          // Ana sayfada `titleTemplate` istenmiyor: "X · JSkelet · JSkelet"
          // olmasın diye başlık burada tam yazılır.
          titleTemplate: "%s · JSkelet",
          canonical: "/",
        },
        data: {
          pillars,
          payload: getPayload(),
          fit,
          faq: faq.slice(0, 4),
        },
      }),
      { revalidate: HOUR },
    ),
  );

  app.get(
    "/nasil-calisir",
    route(
      async () => ({
        view: "pages/how-it-works",
        metadata: {
          title: "Nasıl çalışır",
          description:
            "İstek Express'e girdiği andan island'ın hidre olduğu ana kadar beş adım: cache, controller, EJS, tek stylesheet, dinamik import.",
          canonical: "/nasil-calisir",
        },
        data: { pipeline, pillars },
      }),
      { revalidate: HOUR },
    ),
  );

  app.get(
    "/kiyaslama",
    route(
      async () => ({
        view: "pages/compare",
        metadata: {
          title: "Kıyaslama",
          description:
            "JSkelet, Next.js App Router, Astro ve elle yazılmış Express + EJS arasındaki mimari takaslar — kaybettiğimiz satırlar dahil.",
          canonical: "/kiyaslama",
        },
        data: { comparison, fit, payload: getPayload() },
      }),
      { revalidate: HOUR },
    ),
  );

  app.get(
    "/tasima",
    route(
      async () => ({
        view: "pages/migrate",
        metadata: {
          title: "Next.js'ten taşıma",
          description:
            "Karşılık tablosu: app router yerine route tablosu, RSC yerine island, ISR yerine HTML TTL cache.",
          canonical: "/tasima",
        },
        data: { migration, faq },
      }),
      { revalidate: HOUR },
    ),
  );
}
