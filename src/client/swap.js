/**
 * Sunucudan gelen bir parçayı DOM'a takar.
 *
 * Dashboard'un can damarı bu: tablo sayfası, filtre sonucu, yeniden hesaplanan
 * kart — hepsi sunucuda render edilip yerine konur, böylece işaretlemenin tek
 * kaynağı sunucuda kalır ve istemci ikinci bir şablon taşımaz.
 *
 * Taşıma katmanından bağımsız. Verinin ne zaman değiştiğini nasıl öğrendiğin
 * (SSE, WebSocket, aralıklı sorgu, kullanıcı tıklaması) uygulamanın kararı;
 * burada yalnızca "şu parçayı tazele" adımı var.
 *
 * Sırası önemli olan üç iş yapıyor:
 *   1. eski alt ağacın island'larını söker (yoksa dinleyici sızar),
 *   2. içeriği değiştirir,
 *   3. yeni alt ağacı hidre eder ve odağı kaybolmuşsa geri getirir.
 */
import { hydrate, unmount } from "./registry.js";

/**
 * @param {Element | string} target
 * @returns {HTMLElement | null}
 */
function resolveTarget(target) {
  if (typeof target === "string") {
    return /** @type {HTMLElement | null} */ (document.querySelector(target));
  }
  return /** @type {HTMLElement} */ (target);
}

/**
 * Odak takas edilen bölgenin içindeyse kaybolur ve klavye kullanıcısı
 * sayfanın başına düşer. Yeni içerikte aynı `id`'li bir element varsa oraya,
 * yoksa bölgenin kendisine dönüyoruz.
 *
 * @param {HTMLElement} element
 * @param {string | null} previousId
 */
function restoreFocus(element, previousId) {
  if (previousId) {
    const next = element.querySelector(`#${CSS.escape(previousId)}`);
    if (next instanceof HTMLElement) {
      next.focus();
      return;
    }
  }

  if (!element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
  }
  element.focus({ preventScroll: true });
}

/**
 * @typedef {object} SwapOptions
 * @property {string} [method] Varsayılan `GET`.
 * @property {BodyInit | null} [body]
 * @property {Record<string, string>} [headers]
 * @property {AbortSignal} [signal]
 * @property {boolean} [history] `true` → adres çubuğu `url` ile güncellenir.
 * @property {"replace" | "append"} [mode] Varsayılan `replace`.
 */

/**
 * @param {Element | string} target Takas edilecek bölge.
 * @param {string} url Parçayı döndüren uç.
 * @param {SwapOptions} [options]
 * @returns {Promise<boolean>} Başarılıysa `true`; hata durumunda mevcut
 *   içerik korunur ve `false` döner.
 */
export async function swap(target, url, options = {}) {
  const element = resolveTarget(target);
  if (!element) {
    console.warn(`[swap] target not found: ${String(target)}`);
    return false;
  }

  const activeId =
    document.activeElement instanceof HTMLElement &&
    element.contains(document.activeElement)
      ? document.activeElement.id || null
      : null;

  element.setAttribute("aria-busy", "true");

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      body: options.body ?? null,
      headers: {
        // Sunucu tam sayfa yerine parça döndürmeyi seçebilsin.
        "X-Requested-With": "fragment",
        ...(options.headers ?? {}),
      },
      // Oturum cookie'si olmadan kişiye özel parça gelmez.
      credentials: "same-origin",
      signal: options.signal,
    });

    // Sunucu yönlendirdiyse (ör. oturum düştü, login'e gidiliyor) parça değil
    // sayfa beklenir; alt ağaca bir login formu takmak anlamsız olurdu.
    if (response.redirected && response.url !== new URL(url, location.href).href) {
      location.assign(response.url);
      return false;
    }

    if (!response.ok) {
      element.dispatchEvent(
        new CustomEvent("jskelet:swap-error", {
          bubbles: true,
          detail: { url, status: response.status },
        }),
      );
      return false;
    }

    const html = await response.text();

    if (options.mode === "append") {
      const holder = document.createElement("div");
      holder.innerHTML = html;
      const added = [...holder.childNodes];
      element.append(...added);
      for (const node of added) {
        if (node instanceof HTMLElement) hydrate(node);
      }
    } else {
      unmount(element);
      element.innerHTML = html;
      hydrate(element);
      restoreFocus(element, activeId);
    }

    if (options.history) {
      history.pushState({}, "", url);
    }

    element.dispatchEvent(
      new CustomEvent("jskelet:swap", { bubbles: true, detail: { url } }),
    );

    return true;
  } catch (error) {
    // İptal edilen istek hata değil: kullanıcı hızlı yazıyor ya da sayfadan
    // ayrıldı.
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.error(`[swap] ${url}`, error);
      element.dispatchEvent(
        new CustomEvent("jskelet:swap-error", {
          bubbles: true,
          detail: { url, error },
        }),
      );
    }
    return false;
  } finally {
    element.removeAttribute("aria-busy");
  }
}

/**
 * `data-swap` taşıyan bağlantı ve butonları otomatik bağlar.
 *
 *   <a href="/_fragment/rows?page=2" data-swap="#rows" data-swap-history>…</a>
 *
 * Tek bir delege dinleyici: sonradan DOM'a giren bağlantılar da çalışır ve
 * her takastan sonra yeniden bağlama gerekmez.
 *
 * @param {ParentNode} [root]
 * @returns {() => void} Dinleyiciyi söken fonksiyon.
 */
export function startSwapLinks(root = document) {
  /** @param {Event} event */
  const onClick = (event) => {
    const origin = /** @type {HTMLElement | null} */ (event.target);
    const trigger = origin?.closest?.("[data-swap]");
    if (!(trigger instanceof HTMLElement)) return;

    const selector = trigger.dataset.swap;
    const url = trigger.getAttribute("href") ?? trigger.dataset.swapUrl;
    if (!selector || !url) return;

    event.preventDefault();
    void swap(selector, url, { history: "swapHistory" in trigger.dataset });
  };

  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
