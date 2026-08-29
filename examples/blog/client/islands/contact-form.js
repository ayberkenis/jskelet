import { on, qs } from "jskelet/client";

const MIN_LENGTH = 10;

/**
 * Form iyileştirmesi. Form JS olmadan da POST edip çalışır; bu island
 * yalnızca gönderim öncesi doğrulama ve çift gönderim engeli ekler.
 *
 * @param {HTMLFormElement} element
 * @returns {() => void}
 */
export function mount(element) {
  const field = qs("textarea", element);
  const error = qs("[data-form-error]", element);
  const submit = qs("button[type=submit]", element);

  return on(element, "submit", (event) => {
    const value = field?.value.trim() ?? "";

    if (value.length < MIN_LENGTH) {
      event.preventDefault();
      show(`Mesaj en az ${MIN_LENGTH} karakter olmalı.`);
      field?.focus();
      return;
    }

    show("");
    // Sunucu 303 ile yönlendirdiğinde sayfa değişir; buton kilidi
    // yalnızca o ana kadar sürer.
    if (submit) submit.disabled = true;
  });

  /** @param {string} message */
  function show(message) {
    if (!error) return;
    error.textContent = message;
    error.classList.toggle("hidden", !message);
  }
}
