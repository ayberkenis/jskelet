import { animate, stagger } from "motion";
import { qsa, qs } from "jskelet/client";

/**
 * Ops hikâyesi: sekme geçişleri + diyagram giriş animasyonları.
 * `motion` (Framer Motion ekibinin vanilla API'si) — React yok.
 *
 * Progressive enhancement: JS inmezse ilk sekme zaten sunucuda açık;
 * animasyonlar yalnızca görünürlükte ve reduced-motion dışında çalışır.
 *
 * @param {HTMLElement} element
 * @returns {() => void}
 */
export function mount(element) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tabs = qsa(element, "[data-ops-tab]");
  const panels = qsa(element, "[data-ops-panel-story]");

  /** @type {{ stop: () => void }[]} */
  let running = [];

  function stopRunning() {
    for (const anim of running) {
      try {
        anim.stop();
      } catch {
        /* ignore */
      }
    }
    running = [];
  }

  /**
   * @param {string} id
   */
  function show(id) {
    stopRunning();

    for (const tab of tabs) {
      const on = tab.dataset.opsTab === id;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-pressed", on ? "true" : "false");
    }

    for (const panel of panels) {
      const on = panel.dataset.opsPanelStory === id;
      panel.classList.toggle("is-active", on);
      panel.hidden = !on;
      panel.setAttribute("aria-hidden", on ? "false" : "true");
      if (on && !reduced) playScene(panel);
    }
  }

  /**
   * @param {HTMLElement} panel
   */
  function playScene(panel) {
    const scene = qs(panel, "[data-ops-scene]");
    if (!scene) return;

    const kind = scene.dataset.opsScene;

    if (kind === "redis") {
      const tiers = qsa(scene, "[data-ops-tier]");
      const packets = qsa(scene, "[data-ops-packet]");
      running.push(
        animate(
          tiers,
          { opacity: [0, 1], y: [18, 0], scale: [0.96, 1] },
          { delay: stagger(0.08), duration: 0.45, easing: [0.22, 1, 0.36, 1] },
        ),
      );
      for (const packet of packets) {
        running.push(
          animate(
            packet,
            { x: ["0%", "220%"], opacity: [0, 1, 1, 0] },
            { duration: 1.35, delay: 0.35, easing: "linear", repeat: Infinity },
          ),
        );
      }
      return;
    }

    if (kind === "admin") {
      running.push(
        animate(
          qsa(scene, "[data-ops-nav-item], [data-ops-stat], [data-ops-log-row]"),
          { opacity: [0, 1], y: [10, 0] },
          { delay: stagger(0.045), duration: 0.35, easing: [0.22, 1, 0.36, 1] },
        ),
      );
      return;
    }

    if (kind === "cloudflare") {
      running.push(
        animate(
          qsa(scene, "[data-ops-flow-step], [data-ops-flow-arrow]"),
          { opacity: [0, 1], y: [14, 0] },
          { delay: stagger(0.07), duration: 0.4, easing: [0.22, 1, 0.36, 1] },
        ),
      );
      const beam = qs(scene, "[data-ops-beam]");
      if (beam) {
        running.push(
          animate(
            beam,
            { x: ["-20%", "120%"], opacity: [0, 1, 1, 0] },
            {
              duration: 1.6,
              delay: 0.4,
              easing: "ease-in-out",
              repeat: Infinity,
            },
          ),
        );
      }
    }
  }

  /** @type {(() => void)[]} */
  const cleanups = [];

  for (const tab of tabs) {
    /** @param {Event} event */
    const onClick = (event) => {
      event.preventDefault();
      const id = tab.dataset.opsTab;
      if (id) show(id);
    };
    tab.addEventListener("click", onClick);
    cleanups.push(() => tab.removeEventListener("click", onClick));
  }

  const first = panels.find((p) => p.classList.contains("is-active")) ?? panels[0];
  if (first && !reduced) playScene(first);

  return () => {
    stopRunning();
    for (const off of cleanups) off();
  };
}
