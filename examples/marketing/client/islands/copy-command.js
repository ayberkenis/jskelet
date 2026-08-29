import { on } from "jskelet/client";

/**
 * Kurulum komutunu panoya kopyalar.
 *
 * @param {HTMLElement} element
 * @param {{ text?: string }} props `data-island-props` üzerinden gelir
 * @returns {() => void}
 */
export function mount(element, props) {
  const text = props.text ?? "";
  const idle = element.textContent ?? "kopyala";
  let timer = 0;

  return on(element, "click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      element.textContent = "kopyalandı";
    } catch {
      // İzin verilmeyen bağlamda (http, izin reddi) kopyalama atar.
      element.textContent = "kopyalanamadı";
    }

    clearTimeout(timer);
    timer = setTimeout(() => {
      element.textContent = idle;
    }, 1600);
  });
}
