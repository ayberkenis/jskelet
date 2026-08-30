/**
 * Framework'ün kendi hata sayfaları (404, 500, 503…).
 *
 * Uygulama kendi sayfasını vermediğinde ziyaretçinin Express'in düz metin
 * "Internal Server Error" çıktısını görmesi istenmiyor; bu yüzden framework
 * şablonsuz, tek dosyada duran minimal bir HTML üretir.
 *
 * Metin bilinçli olarak yalın: yalnızca bir şeyin ters gittiğini söyler.
 * Marka adı, ürün tanıtımı ya da hata ayrıntısı yok — hata sayfası
 * ziyaretçiye bir şey satmaz ve sunucunun içini dışa açmaz.
 *
 * Ezme yolları (öncelik sırasıyla):
 *   1. `hooks.notFound()` — yalnızca 404 için, geriye dönük uyumluluk.
 *   2. `hooks.error({ status })` — tüm durumlar için; sayfa tanımı ya da
 *      doğrudan HTML string döner.
 *   3. Aşağıdaki gömülü HTML.
 */
import { getConfig, hook } from "../config/index.js";
import { esc } from "../views/helpers/html.js";

/**
 * Durum koduna karşılık gelen sayfayı üretir. Hiçbir koşulda fırlatmaz:
 * hata sayfasının kendisi patlarsa ziyaretçi boş yanıt görür, bu yüzden her
 * başarısızlık gömülü HTML'e düşer.
 *
 * @param {number} status
 * @param {{ error?: unknown }} [options]
 * @returns {Promise<string>}
 */
export async function renderStatusPage(status, options = {}) {
  const page =
    (status === 404 ? await hook("notFound", null) : null) ??
    (await hook("error", null, { status, error: options.error }));

  if (typeof page === "string") return page;
  if (!page) return fallbackPage(status);

  try {
    // Dinamik import: render.js bu modülü kendisi kullanıyor, statik ithal
    // iki modül arasında döngü kurardı.
    const { renderPage } = await import("./render.js");
    return await renderPage({ pathname: `/${status}`, ...page });
  } catch (error) {
    console.error(`[render] ${status} sayfası render edilemedi`, error);
    return fallbackPage(status);
  }
}

/**
 * Bir hatadan HTTP durum kodu çıkarır. Uygulama kodu `error.statusCode` ya da
 * `error.status` ile kendi kodunu bildirebilir; tanınmayan her şey 500'dür.
 *
 * @param {unknown} error
 * @returns {number}
 */
export function statusFromError(error) {
  const raw =
    error && typeof error === "object"
      ? /** @type {{ statusCode?: unknown, status?: unknown }} */ (error).statusCode ??
        /** @type {{ status?: unknown }} */ (error).status
      : undefined;

  const status = Number(raw);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

/**
 * Durum başlıkları. Yalnızca framework'ün kendi ürettiği yanıtlar için;
 * uygulamanın diline ait metinler `hooks.error()` üzerinden gelir.
 *
 * @type {Record<string, Record<number | "4xx" | "5xx", [string, string]>>}
 */
const MESSAGES = {
  tr: {
    400: ["Geçersiz istek", "İstek anlaşılamadı."],
    401: ["Yetki gerekiyor", "Bu sayfayı görmek için oturum açmanız gerekiyor."],
    403: ["Erişim yok", "Bu sayfaya erişim izniniz yok."],
    404: ["Sayfa bulunamadı", "Aradığınız sayfa burada değil."],
    408: ["İstek zaman aşımına uğradı", "Lütfen tekrar deneyin."],
    410: ["Sayfa kaldırıldı", "Bu sayfa artık yayında değil."],
    429: ["Çok fazla istek", "Kısa bir süre sonra tekrar deneyin."],
    500: ["Bir hata oluştu", "Lütfen daha sonra tekrar deneyin."],
    503: ["Servis kullanılamıyor", "Lütfen daha sonra tekrar deneyin."],
    "4xx": ["İstek karşılanamadı", "Lütfen adresi kontrol edin."],
    "5xx": ["Bir hata oluştu", "Lütfen daha sonra tekrar deneyin."],
  },
  en: {
    400: ["Bad request", "The request could not be understood."],
    401: ["Sign in required", "You need to sign in to view this page."],
    403: ["No access", "You do not have permission to view this page."],
    404: ["Page not found", "The page you are looking for is not here."],
    408: ["Request timed out", "Please try again."],
    410: ["Page removed", "This page is no longer available."],
    429: ["Too many requests", "Please try again in a moment."],
    500: ["Something went wrong", "Please try again later."],
    503: ["Service unavailable", "Please try again later."],
    "4xx": ["Request failed", "Please check the address."],
    "5xx": ["Something went wrong", "Please try again later."],
  },
};

/**
 * @param {number} status
 * @returns {{ lang: string, title: string, detail: string }}
 */
function statusText(status) {
  // Config yüklenmeden de çağrılabilir (ör. loadConfig() patladıysa);
  // hata sayfası bu yüzden getConfig()'in fırlatmasına dayanmaz.
  let lang = "en";
  try {
    lang = getConfig().brand.lang ?? "en";
  } catch {
    /* varsayılan kalır */
  }

  const table = MESSAGES[lang.slice(0, 2).toLowerCase()] ?? MESSAGES.en;
  const [title, detail] =
    table[status] ?? table[status >= 500 ? "5xx" : "4xx"];

  return { lang, title, detail };
}

/**
 * Şablonsuz, varlıksız hata sayfası: tek istekte biter, build çıktısına ve
 * uygulamanın layout'una bağlı değildir. `noindex` bilinçli — hata sayfası
 * arama sonuçlarında görünmemeli.
 *
 * @param {number} status
 * @returns {string}
 */
function fallbackPage(status) {
  const { lang, title, detail } = statusText(status);

  return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${status} — ${esc(title)}</title>
<style>
:root { color-scheme: light dark; --fg: #18181b; --muted: #71717a; --bg: #fafafa; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #f4f4f5; --muted: #a1a1aa; --bg: #09090b; }
}
html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); }
body {
  display: grid; place-items: center; padding: 2rem; text-align: center;
  font: 1rem/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.code { font-size: 3.5rem; font-weight: 600; letter-spacing: -0.02em; margin: 0; }
h1 { font-size: 1.125rem; font-weight: 600; margin: 0.75rem 0 0; }
p { margin: 0.375rem 0 0; color: var(--muted); }
</style>
</head>
<body>
<main>
<p class="code">${status}</p>
<h1>${esc(title)}</h1>
<p>${esc(detail)}</p>
</main>
</body>
</html>`;
}
