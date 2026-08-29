import { on } from "jskelet/client";

const STORAGE_KEY = "jskelet-theme";

/**
 * Tema anahtarı. Sunucu HTML'i cache'lendiği için tema **sunucuda**
 * belirlenemez: aynı HTML herkese gider. Bu yüzden seçim localStorage'da
 * tutulur ve sınıf client'ta uygulanır.
 *
 * @param {HTMLElement} element
 * @returns {() => void}
 */
export function mount(element) {
  const apply = (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    element.setAttribute("aria-pressed", String(theme === "dark"));
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
