import { qsa } from "jskelet/client";

/**
 * "Bu sayfada" listesinde okunan bölümü işaretler.
 *
 * Sunucu hangi başlığın ekranda olduğunu bilemez, dolayısıyla bu tamamen
 * client'a ait bir davranış. Island olmasının karşılığı da net: liste JS
 * inmeden de çalışan bir bağlantı kümesi, island yalnızca hangisinin etkin
 * olduğunu ekliyor.
 *
 * `scroll` dinleyip her karede pozisyon hesaplamak yerine
 * `IntersectionObserver`: kaydırma sırasında ana iş parçacığında hiç iş
 * yapılmıyor, tarayıcı yalnızca eşik geçildiğinde haber veriyor.
 *
 * @param {HTMLElement} element
 * @returns {() => void}
 */
export function mount(element) {
  const links = qsa(element, "[data-toc-link]");
  if (!links.length) return () => {};

  /** @type {Map<string, HTMLElement>} */
  const byId = new Map();
  /** @type {HTMLElement[]} */
  const headings = [];

  for (const link of links) {
    const id = link.dataset.tocLink;
    if (!id) continue;

    const heading = document.getElementById(id);
    if (!heading) continue;

    byId.set(id, link);
    headings.push(heading);
  }

  if (!headings.length) return () => {};

  /** Görünür başlıkların id'leri; belge sırasını korumak için Set değil dizi. */
  const visible = new Set();
  let current = "";

  const paint = () => {
    // Ekranda birden fazla başlık olabiliyor; en üstteki doğru cevap, çünkü
    // okuyucu o bölümün içinde.
    const next =
      headings.find((heading) => visible.has(heading.id))?.id ?? current;

    if (next === current) return;

    byId.get(current)?.removeAttribute("data-active");
    byId.get(next)?.setAttribute("data-active", "true");
    current = next;
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }

      paint();
    },
    {
      /**
       * Üstte header yüksekliği kadar, altta ekranın büyük bölümü kadar pay:
       * böylece "etkin bölüm" ekranın üst şeridine giren başlık oluyor ve
       * sayfanın altındaki başlıklar sırayı çalmıyor.
       */
      rootMargin: "-88px 0px -70% 0px",
    },
  );

  for (const heading of headings) observer.observe(heading);

  // İlk boyama: sayfa bir anchor ile açıldıysa hedef bölüm zaten etkin olmalı.
  const initial = decodeURIComponent(location.hash.slice(1));
  if (initial && byId.has(initial)) {
    byId.get(initial)?.setAttribute("data-active", "true");
    current = initial;
  }

  return () => observer.disconnect();
}
