import { on, qs } from "jskelet/client";

const STORAGE_KEY = "jskelet-theme";

/**
 * Tema anahtarı. Sunucu HTML'i cache'lendiği için tema sunucuda
 * belirlenemez — aynı HTML herkese gider. Seçim localStorage'da tutulur ve
 * sınıf client'ta uygulanır; ilk boyamada beyaz bir kare görünmesin diye
 * `layout.ejs` içindeki satır içi script sınıfı zaten yazmış olur. Bu island
 * yalnızca düğmenin durumunu ve tıklamayı devralır.
 *
 * @param {HTMLElement} element
 * @returns {() => void}
 */
export function mount(element) {
  const darkIcon = qs(element, '[data-theme-icon="dark"]');
  const lightIcon = qs(element, '[data-theme-icon="light"]');

  const apply = (theme) => {
    const dark = theme === "dark";
    document.documentElement.classList.toggle("dark", dark);
    element.setAttribute("aria-pressed", String(dark));
    // Düğme bir sonraki duruma geçişi anlatır: koyu temadayken güneş gösterir.
    if (darkIcon) darkIcon.hidden = dark;
    if (lightIcon) lightIcon.hidden = !dark;
  };

  apply(read());

  return on(element, "click", () => {
    const next = read() === "dark" ? "light" : "dark";
    write(next);
    apply(next);
  });
}

/** @returns {"dark" | "light"} */
function read() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Private mode'da localStorage erişimi atar; sessiz düşmek doğru davranış.
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** @param {"dark" | "light"} theme */
function write(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Yoksay: tema yine de bu oturum için uygulanmış olur.
  }
}
