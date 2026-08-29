import { on } from "jskelet/client";

/**
 * Island sözleşmesi: `mount(element, props)` adlı named export. `props`
 * markup'taki `data-island-props` JSON'undan gelir.
 *
 * Dönen fonksiyon temizlik için ayrılmıştır (şu an çağrılmıyor, ama
 * listener'ları `on()` ile kurmak alışkanlığı ileride bedava kazanç).
 *
 * @param {HTMLElement} element
 * @param {{ start?: number }} props
 * @returns {() => void}
 */
export function mount(element, props) {
  let value = props.start ?? 0;

  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "rounded border border-slate-300 px-4 py-2 hover:bg-slate-50";

  const paint = () => {
    button.textContent = `Tıklama: ${value}`;
  };

  const off = on(button, "click", () => {
    value += 1;
    paint();
  });

  paint();
  element.append(button);

  return off;
}
