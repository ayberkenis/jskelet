import { debounce, on, qs, qsa } from "jskelet/client";

/**
 * İstemci tarafı filtreleme. Sunucu tam listeyi bastığı için JS gelmeden de
 * sayfa okunabilir; island yalnızca filtre ekler.
 *
 * Arama sunucuya gitmez: liste zaten DOM'da ve bu örnekte küçük. Gerçek bir
 * projede eşik aşıldığında `/_fragment/search?q=` ucuna geçilir.
 *
 * @param {HTMLElement} element
 * @returns {() => void}
 */
export function mount(element) {
  const input = qs("[data-search-input]", element);
  const empty = qs("[data-search-empty]", element);
  const cards = qsa("article", qs("[data-search-list]", element) ?? element);

  if (!input) return () => {};

  // Her karta bir kez normalize edilmiş metin yazılır; her tuş vuruşunda
  // yeniden `toLocaleLowerCase()` çağırmak boşa iş.
  const haystacks = cards.map((card) => ({
    card,
    text: card.textContent.toLocaleLowerCase("tr"),
  }));

  const filter = () => {
    const term = input.value.trim().toLocaleLowerCase("tr");
    let visible = 0;

    haystacks.forEach(({ card, text }) => {
      const match = !term || text.includes(term);
      card.hidden = !match;
      if (match) visible += 1;
    });

    if (empty) empty.classList.toggle("hidden", visible > 0);
  };

  // 120 ms: yazarken her karakterde tüm listeyi gezmemek için, ama
  // gecikme hissedilmeyecek kadar kısa.
  const offInput = on(input, "input", debounce(filter, 120));

  const offEscape = on(input, "keydown", (event) => {
    if (event.key !== "Escape") return;
    input.value = "";
    filter();
  });

  // Tarayıcı formu geri gelen sayfada doldurmuş olabilir.
  if (input.value) filter();

  return () => {
    offInput();
    offEscape();
  };
}
