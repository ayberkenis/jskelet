import { qsa } from "jskelet/client";

/**
 * Barları sıfırdan hedef genişliğine sürer. Progressive enhancement:
 * genişlik sunucudan `--bar` olarak zaten geliyor, island yalnızca animasyonu
 * ekliyor. Modül hiç inmezse barlar doğru değerde, animasyonsuz durur.
 *
 * Island varsayılan olarak görünürlükte hidre olduğu için animasyon tam olarak
 * bar ekrana girdiğinde başlar; ayrıca bir observer kurmaya gerek yok.
 *
 * @param {HTMLElement} element
 * @returns {void}
 */
export function mount(element) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const fills = qsa(element, "[data-bar]");

  for (const fill of fills) {
    fill.style.setProperty("--bar", "0%");
  }

  // İki kare bekleniyor: aynı kare içinde 0'a çekip hedefe yazmak geçişi
  // tamamen atlıyor, çünkü tarayıcı arada bir stil hesabı yapmıyor.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      fills.forEach((fill, index) => {
        fill.style.transitionDelay = `${index * 70}ms`;
        fill.style.setProperty("--bar", `${fill.dataset.bar}%`);
      });
    }),
  );
}
