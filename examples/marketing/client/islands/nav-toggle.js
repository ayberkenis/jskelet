import { on, toggleClass } from "jskelet/client";

/**
 * Mobil menü. Menünün kendisi sunucudan tam olarak geliyor; island yalnızca
 * `hidden` sınıfını çeviriyor. JS inmezse menü kapalı kalır ama bağlantılar
 * footer'da da olduğu için hiçbir sayfa erişilemez hâle gelmiyor.
 *
 * @param {HTMLElement} element
 * @returns {() => void}
 */
export function mount(element) {
  const target = document.getElementById(
    element.getAttribute("aria-controls") ?? "",
  );
  if (!target) return () => {};

  const close = () => setOpen(false);

  const setOpen = (open) => {
    toggleClass(target, "hidden", !open);
    toggleClass(target, "flex", open);
    element.setAttribute("aria-expanded", String(open));
  };

  const offClick = on(element, "click", () => {
    setOpen(element.getAttribute("aria-expanded") !== "true");
  });

  // Bir bağlantıya basıldığında menü açık kalmasın; aynı sayfa içi çapa
  // bağlantılarında navigasyon olmadığı için bu elle kapatılmak zorunda.
  const offNav = on(target, "click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) close();
  });

  const offEscape = on(document, "keydown", (event) => {
    if (event.key === "Escape") close();
  });

  return () => {
    offClick();
    offNav();
    offEscape();
  };
}
