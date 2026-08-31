import { on } from "jskelet/client";

/**
 * Katlanmış sürüm kartlarını çapa bağlantısıyla açar.
 *
 * Kartlar `<details>` olduğu için kapalı bir kartın içine `#v0.1.1` ile
 * inildiğinde tarayıcı hedefi gösteremez: içerik render edilmiyor. Island
 * sayfa açılışında ve her hash değişiminde hedef kartı açıp ona kaydırıyor.
 * JS inmezse kart elle açılabildiği için bağlantı yine çalışır, sadece
 * otomatik açılmaz.
 *
 * @param {HTMLElement} element Sürüm kartlarını saran kapsayıcı
 * @returns {() => void}
 */
export function mount(element) {
  const reveal = (scroll) => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;

    const article = element.querySelector(`[id="${CSS.escape(id)}"]`);
    const details = article?.querySelector("details");
    if (!details) return;

    details.open = true;

    // Tarayıcı çapa kaydırmasını kart kapalıyken yaptı; açıldıktan sonra
    // hedefin yeri değiştiği için kaydırmayı tekrarlamak gerekiyor.
    if (scroll) article.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  reveal(false);

  const offHash = on(window, "hashchange", () => reveal(true));

  // Zaten hash'te olan sürüme tekrar tıklandığında `hashchange` çıkmıyor;
  // şerit bağlantısı o durumda da kartı açmalı.
  const offClick = on(document, "click", (event) => {
    const link =
      event.target instanceof Element ? event.target.closest('a[href^="#v"]') : null;
    if (link) setTimeout(() => reveal(true), 0);
  });

  return () => {
    offHash();
    offClick();
  };
}
