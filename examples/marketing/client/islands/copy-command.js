import { on } from "jskelet/client";

/**
 * Kurulum komutunu panoya kopyalar.
 *
 * Geri bildirim metinleri props olarak geliyor, bundle'a gömülü değil: site
 * iki dilli ve client tarafında dil bilmenin tek yolu ya iki bundle üretmek
 * ya da metni sunucudan taşımak. İkincisi bedava.
 *
 * @param {HTMLElement} element
 * @param {{ text?: string, done?: string, failed?: string }} props
 * @returns {() => void}
 */
export function mount(element, props) {
  const text = props.text ?? "";
  const idle = element.textContent ?? "copy";
  let timer = 0;

  return on(element, "click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      element.textContent = props.done ?? "copied";
    } catch {
      // İzin verilmeyen bağlamda (http, izin reddi) kopyalama atar.
      element.textContent = props.failed ?? "failed";
    }

    clearTimeout(timer);
    timer = setTimeout(() => {
      element.textContent = idle;
    }, 1600);
  });
}
