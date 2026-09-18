/**
 * Framework'ün kendi hata sayfaları (404, 500, 503…).
 *
 * Uygulama kendi sayfasını vermediğinde ziyaretçinin Express'in düz metin
 * "Internal Server Error" çıktısını görmesi istenmiyor; bu yüzden framework
 * şablonsuz, tek dosyada duran minimal bir HTML üretir.
 *
 * Production metni bilinçli olarak yalın: yalnızca bir şeyin ters gittiğini
 * söyler. Marka adı, ürün tanıtımı ya da hata ayrıntısı yok — hata sayfası
 * ziyaretçiye bir şey satmaz ve sunucunun içini dışa açmaz. Development'ta
 * 5xx için ayrıntılı teşhis sayfası üretilir (aşağıya bak).
 *
 * Ezme yolları (öncelik sırasıyla; development 5xx hariç):
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
 * Development'ta 5xx yanıtları `hooks.error` ve gömülü 500 sayfasını atlar;
 * yığın izini içeren bir teşhis sayfası döner. Production'da ayrıntı
 * gösterilmez — sunucu içi ziyaretçiye açılmaz.
 *
 * @param {number} status
 * @param {{ error?: unknown }} [options]
 * @returns {Promise<string>}
 */
export async function renderStatusPage(status, options = {}) {
  if (process.env.NODE_ENV === "development" && status >= 500) {
    return developmentErrorPage(status, options.error);
  }

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
    console.error(`[render] failed to render the ${status} page`, error);
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

/**
 * Development teşhis sayfası: mesaj + yığın izi. Yalnızca
 * `NODE_ENV=development` iken `renderStatusPage` üzerinden çağrılır;
 * production yolu buraya hiç girmez.
 *
 * @param {number} status
 * @param {unknown} [error]
 * @returns {string}
 */
function developmentErrorPage(status, error) {
  const name =
    error instanceof Error && error.name ? error.name : "Error";
  const message =
    error instanceof Error
      ? error.message || "(no message)"
      : error == null
        ? "(no error object)"
        : String(error);
  const body = serializeError(error);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${status} — ${esc(name)}: ${esc(message)}</title>
<style>
:root { color-scheme: light dark; --fg: #18181b; --muted: #71717a; --bg: #fafafa; --panel: #fff; --border: #e4e4e7; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #f4f4f5; --muted: #a1a1aa; --bg: #09090b; --panel: #18181b; --border: #27272a; }
}
html, body { margin: 0; background: var(--bg); color: var(--fg); }
body {
  padding: 1.5rem; max-width: 56rem; margin: 0 auto;
  font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.banner {
  display: inline-block; margin: 0 0 1rem; padding: 0.2rem 0.5rem;
  font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--muted); border: 1px solid var(--border);
}
.code { font-size: 2.5rem; font-weight: 600; letter-spacing: -0.02em; margin: 0; }
h1 { font-size: 1.25rem; font-weight: 600; margin: 0.5rem 0 0; word-break: break-word; }
pre {
  margin: 1.25rem 0 0; padding: 1rem; overflow: auto;
  background: var(--panel); border: 1px solid var(--border);
  font: 0.8125rem/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap; word-break: break-word;
}
</style>
</head>
<body>
<p class="banner">Development only — not shown in production</p>
<p class="code">${status}</p>
<h1>${esc(name)}: ${esc(message)}</h1>
<pre>${esc(body)}</pre>
</body>
</html>`;
}

/**
 * Hata nesnesini yığın izi + `cause` zinciriyle metne çevirir.
 *
 * @param {unknown} error
 * @returns {string}
 */
function serializeError(error) {
  if (error == null) return "(no error object)";

  /** @type {string[]} */
  const parts = [];
  /** @type {unknown} */
  let current = error;
  let depth = 0;

  while (current != null && depth < 6) {
    if (depth > 0) parts.push("\nCaused by:");

    if (current instanceof Error) {
      parts.push(current.stack || `${current.name}: ${current.message}`);
      current = "cause" in current ? current.cause : undefined;
    } else {
      parts.push(String(current));
      break;
    }
    depth += 1;
  }

  return parts.join("\n");
}
