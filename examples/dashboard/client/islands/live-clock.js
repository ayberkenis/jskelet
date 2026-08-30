/**
 * Saniyede bir güncellenen saat.
 *
 * Örnekteki işlevi süsten fazlası: `mount()` bir temizlik fonksiyonu
 * döndürüyor ve island sipariş tablosunun yanında duruyor. Tablo takas
 * edildiğinde `unmount()` bu temizliği çağırmasa her takas geride bir
 * `setInterval` bırakırdı — birkaç sayfa gezdikten sonra aynı iş onlarca kez
 * çalışır. Sızıntının en kolay gözden kaçan biçimi bu.
 */

/**
 * @param {HTMLElement} element
 * @returns {() => void}
 */
export function mount(element) {
  const render = () => {
    element.textContent = new Date().toLocaleTimeString("tr-TR");
  };

  render();
  const timer = setInterval(render, 1000);

  return () => clearInterval(timer);
}
