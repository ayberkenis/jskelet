/**
 * Form gönderimini sayfa yenilemeden yürütür — ama yenilemeyi de bozmadan.
 *
 * Sözleşme bilinçli olarak "progressive enhancement": form normal bir
 * `<form method="post" action="…">`. JS yüklenmemişse, hata verdiyse ya da
 * kullanıcı kapattıysa tarayıcı formu kendisi gönderir ve sunucu yönlendirme
 * ile cevap verir. Bu dosya yalnızca aradaki tam sayfa turunu kaldırıyor.
 *
 * Sunucudan üç cevaptan biri beklenir:
 *   - yönlendirme  → `location.assign` ile izlenir (başarılı mutasyon)
 *   - 4xx + parça  → formun yerine takılır (alan bazlı doğrulama hataları)
 *   - 2xx + parça  → hedef bölgeye takılır (güncellenen liste, kart)
 *
 * CSRF token'ı `csrfField()` tarafından basılan gizli alanda; `FormData`
 * onu kendiliğinden taşıdığı için burada ek bir iş yok.
 */
import { hydrate, unmount } from "./registry.js";

/**
 * @param {HTMLFormElement} form
 * @param {boolean} busy
 */
function setBusy(form, busy) {
  form.toggleAttribute("data-submitting", busy);

  for (const element of form.elements) {
    if (
      element instanceof HTMLButtonElement ||
      (element instanceof HTMLInputElement && element.type === "submit")
    ) {
      element.disabled = busy;
    }
  }
}

/**
 * @param {HTMLElement} element
 * @param {string} html
 */
function replaceContent(element, html) {
  unmount(element);
  element.innerHTML = html;
  hydrate(element);
}

/**
 * @param {HTMLFormElement} form
 * @param {string} html
 */
function replaceForm(form, html) {
  const holder = document.createElement("div");
  holder.innerHTML = html;

  const replacement = holder.firstElementChild;
  if (!replacement) return;

  unmount(form);
  form.replaceWith(replacement);
  hydrate(replacement);

  // Doğrulama hatasında odak ilk hatalı alana gitmeli; klavye kullanıcısı
  // aksi hâlde hatanın nerede olduğunu bulmak için baştan geziyor.
  const invalid = replacement.querySelector("[aria-invalid='true'], [data-field-error]");
  if (invalid instanceof HTMLElement) invalid.focus();
}

/**
 * @param {HTMLFormElement} form
 * @param {HTMLElement | null} submitter
 */
async function submitForm(form, submitter) {
  setBusy(form, true);

  const method = (form.method || "post").toUpperCase();
  const action = form.action || location.href;
  const data = new FormData(form);

  // Gönderen butonun `name`/`value`'su `FormData`'ya girmez; hangi eylemin
  // tetiklendiğini ayırt eden formlar (kaydet / sil) buna güveniyor.
  if (
    (submitter instanceof HTMLButtonElement ||
      submitter instanceof HTMLInputElement) &&
    submitter.name
  ) {
    data.append(submitter.name, submitter.value);
  }

  try {
    const isGet = method === "GET";
    const query = new URLSearchParams();
    if (isGet) {
      for (const [key, value] of data.entries()) {
        if (typeof value === "string") query.append(key, value);
      }
    }

    const response = await fetch(isGet ? `${action.split("?")[0]}?${query}` : action, {
      method,
      body: isGet ? null : data,
      headers: { "X-Requested-With": "fragment" },
      credentials: "same-origin",
    });

    if (response.redirected) {
      location.assign(response.url);
      return;
    }

    const html = await response.text();
    const target = form.dataset.target
      ? document.querySelector(form.dataset.target)
      : null;

    if (!response.ok || !target) {
      replaceForm(form, html);
    } else {
      replaceContent(/** @type {HTMLElement} */ (target), html);
      form.reset();
    }

    form.dispatchEvent(
      new CustomEvent("jskelet:submitted", {
        bubbles: true,
        detail: { ok: response.ok, status: response.status },
      }),
    );
  } catch (error) {
    console.error("[form] submit failed", error);
    // Ağ hatasında formu kilitli bırakmıyoruz: kullanıcı tekrar denesin.
    form.dispatchEvent(
      new CustomEvent("jskelet:submit-error", { bubbles: true, detail: { error } }),
    );
  } finally {
    setBusy(form, false);
  }
}

/**
 * @param {SubmitEvent} event
 * @param {HTMLFormElement} form
 */
function onSubmit(event, form) {
  // Tarayıcının kendi doğrulaması geçmediyse hiç ağa çıkmıyoruz; hata
  // balonlarını da tarayıcı gösterir.
  if (!form.checkValidity()) return;
  if (form.hasAttribute("data-submitting")) {
    event.preventDefault();
    return;
  }

  event.preventDefault();
  void submitForm(form, /** @type {HTMLElement | null} */ (event.submitter));
}

/**
 * Tek bir formu bağlar.
 *
 * `data-target` verilirse başarılı yanıtın gövdesi o bölgeye takılır; yoksa
 * yanıt formun kendisini değiştirir (doğrulama hatalarının geldiği yol).
 *
 * @param {HTMLFormElement} form
 * @returns {() => void} Dinleyiciyi söken fonksiyon.
 */
export function enhanceForm(form) {
  /** @param {Event} event */
  const listener = (event) => onSubmit(/** @type {SubmitEvent} */ (event), form);

  form.addEventListener("submit", listener);
  return () => form.removeEventListener("submit", listener);
}

/**
 * `data-enhance` taşıyan formları tek bir delege dinleyiciyle bağlar.
 * `submit` olayı köpürdüğü için sonradan DOM'a giren (fragment ile gelen)
 * formlar da kapsanır ve her takastan sonra yeniden bağlama gerekmez.
 *
 * @param {ParentNode} [root]
 * @returns {() => void}
 */
export function startForms(root = document) {
  /** @param {Event} event */
  const listener = (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!("enhance" in form.dataset)) return;

    onSubmit(/** @type {SubmitEvent} */ (event), form);
  };

  root.addEventListener("submit", listener);
  return () => root.removeEventListener("submit", listener);
}
