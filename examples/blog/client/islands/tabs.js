import { on, qsa } from "jskelet/client";

/**
 * Sekmeli panel. Sunucu yalnızca ilk paneli basar; diğerleri
 * `data-tab-src` adresinden layout'suz HTML olarak gelir ve bir kez
 * indirildikten sonra DOM'da kalır.
 *
 * Bu, "her şeyi sunucuda bas" ile "her şeyi client'ta çek" arasındaki orta
 * yol: ilk boyama tam, sonraki paneller ise ilk yükü büyütmüyor.
 *
 * @param {HTMLElement} element
 * @returns {() => void}
 */
export function mount(element) {
  const buttons = qsa("[data-tab]", element);
  const panels = qsa("[data-tab-panel]", element);
  const inFlight = new Map();

  const activate = async (name) => {
    buttons.forEach((button) => {
      button.dataset.active = String(button.dataset.tab === name);
    });

    panels.forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== name;
    });

    const panel = panels.find((item) => item.dataset.tabPanel === name);
    if (panel) await fill(panel);
  };

  /** @param {HTMLElement} panel */
  const fill = (panel) => {
    const src = panel.dataset.tabSrc;
    if (!src) return Promise.resolve();

    // Aynı panel için ikinci istek açılmasın: hover prefetch ile tıklama
    // aynı ana denk geldiğinde bu olur.
    const existing = inFlight.get(src);
    if (existing) return existing;

    const request = fetch(src, { headers: { "X-Requested-With": "fragment" } })
      .then((response) => {
        if (!response.ok) throw new Error(`fragment ${response.status}`);
        return response.text();
      })
      .then((html) => {
        panel.innerHTML = html;
        // Adresi silmek panelin "dolu" işareti; tekrar fetch edilmez.
        delete panel.dataset.tabSrc;
      })
      .catch(() => {
        panel.innerHTML =
          '<p class="py-3 text-sm text-red-600">Bu bölüm yüklenemedi.</p>';
      })
      .finally(() => {
        inFlight.delete(src);
      });

    inFlight.set(src, request);
    return request;
  };

  const offs = buttons.map((button) => {
    const name = button.dataset.tab;

    // Fare üstüne gelince önden çek: tıklama anında panel çoğu zaman hazır.
    const offEnter = on(button, "pointerenter", () => {
      const panel = panels.find((item) => item.dataset.tabPanel === name);
      if (panel) fill(panel);
    });

    const offClick = on(button, "click", () => {
      activate(name);
    });

    return () => {
      offEnter();
      offClick();
    };
  });

  // Sekmeler klavyeyle de gezilebilir olmalı.
  const offKeys = on(element, "keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

    const current = buttons.findIndex(
      (button) => button.dataset.active === "true",
    );
    if (current === -1) return;

    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = buttons[(current + delta + buttons.length) % buttons.length];
    next.focus();
    activate(next.dataset.tab);
  });

  return () => {
    offs.forEach((off) => off());
    offKeys();
  };
}
