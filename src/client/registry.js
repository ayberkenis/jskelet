/**
 * Island registry.
 *
 * Sunucu HTML'i tamdır; JS yalnızca davranış ekler. Bir element
 * `data-island="ad"` taşıdığında ilgili modül dinamik import edilir ve
 * `mount(element, props)` çağrılır.
 *
 * Hidrasyon **varsayılan olarak görünürlüğe bağlıdır**: her island bir
 * IntersectionObserver'a verilir, ekranda olanlar zaten ilk gözlemde tetiklenir,
 * ekran dışındakiler kaydırılana kadar hiç indirilmez. Ana sayfadaki grafik
 * kütüphanesi gibi ağır modüller böylece ilk yükten tamamen çıkar.
 *
 * `data-island-eager` görünürlükten bağımsız, hemen bağlanmayı zorlar
 * (header, çerez bandı gibi global davranışlar için).
 *
 * `data-island-idle` görünür olsa bile sayfa sakinleşene (load + boş zaman)
 * kadar bekletir. İlk ekranda görünen ama kritik olmayan ağır modüller
 * (ör. grafik kütüphanesi çeken mini grafik) LCP ile yarışmasın diye.
 *
 * `data-island-props` JSON ise parse edilip props olarak geçer.
 */

/** @typedef {(element: HTMLElement, props: object) => void | (() => void)} MountFn */

/** @type {Map<string, () => Promise<{ mount: MountFn }>>} */
const loaders = new Map();

/** @type {WeakMap<HTMLElement, Set<string>>} */
const mounted = new WeakMap();

/**
 * `mount()` bir temizlik fonksiyonu döndürebiliyor; DOM'dan çıkan island'ın
 * dinleyicilerini ve zamanlayıcılarını sökmek için saklanır.
 *
 * WeakMap: sökülmeden çöpe giden bir element (ör. tüm sayfa gezinmesi)
 * burada referans bırakmasın. Alt ağacı gezme işi DOM üzerinden yapılıyor,
 * bu yüzden ayrı bir element listesine gerek yok.
 *
 * @type {WeakMap<HTMLElement, (() => void)[]>}
 */
const cleanups = new WeakMap();

/**
 * @param {string} name
 * @param {() => Promise<{ mount: MountFn }>} loader
 */
export function register(name, loader) {
  loaders.set(name, loader);
}

/** @param {Record<string, () => Promise<{ mount: MountFn }>>} entries */
export function registerAll(entries) {
  for (const [name, loader] of Object.entries(entries)) {
    register(name, loader);
  }
}

/**
 * @param {HTMLElement} element
 * @returns {object}
 */
function readProps(element) {
  const raw = element.dataset.islandProps;
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(
      `[island] ${element.dataset.island}: invalid data-island-props`,
      error,
    );
    return {};
  }
}

/**
 * @param {HTMLElement} element
 * @returns {boolean}
 */
function isMounted(element) {
  const name = element.dataset.island;
  if (!name) return true;
  return mounted.get(element)?.has(name) ?? false;
}

/** @param {HTMLElement} element */
function markMounted(element) {
  const name = element.dataset.island;
  if (!name) return;

  let names = mounted.get(element);
  if (!names) {
    names = new Set();
    mounted.set(element, names);
  }
  names.add(name);
}

/** @param {HTMLElement} element */
async function mountIsland(element) {
  const name = element.dataset.island;
  if (!name || isMounted(element)) return;

  const loader = loaders.get(name);
  if (!loader) {
    console.warn(`[island] not registered: ${name}`);
    return;
  }

  markMounted(element);

  try {
    const module = await loader();
    const cleanup = module.mount(element, readProps(element));

    if (typeof cleanup === "function") {
      // Island bağlanırken DOM'dan çıkarılmış olabilir (hızlı bir fragment
      // takası). Temizliği saklamak yerine hemen çalıştırmak gerekiyor;
      // aksi hâlde artık görünmeyen bir elementin dinleyicileri hiç sökülmez.
      if (element.isConnected) {
        const list = cleanups.get(element) ?? [];
        list.push(cleanup);
        cleanups.set(element, list);
      } else {
        runCleanups(element, cleanup);
      }
    }

    element.dataset.islandReady = "true";
  } catch (error) {
    console.error(`[island] ${name} failed to load`, error);
  }
}

/**
 * @param {HTMLElement} element
 * @param {() => void} [extra] Henüz saklanmamış temizlik.
 */
function runCleanups(element, extra) {
  const stored = cleanups.get(element) ?? [];
  cleanups.delete(element);
  mounted.delete(element);
  delete element.dataset.islandReady;

  for (const cleanup of extra ? [...stored, extra] : stored) {
    try {
      cleanup();
    } catch (error) {
      console.error(`[island] ${element.dataset.island} cleanup failed`, error);
    }
  }
}

/**
 * Bir alt ağaçtaki island'ları söker.
 *
 * Fragment takasında çağrılması zorunlu: `innerHTML` ile değiştirilen bir
 * bölgenin island'ları DOM'dan çıkar ama `document`/`window` üzerine
 * kurdukları dinleyiciler ve `setInterval`'ları yaşamaya devam eder. Birkaç
 * takastan sonra aynı olay birden fazla kez işlenmeye başlar.
 *
 * Sökülen element yeniden bağlanabilir hâle gelir: `mounted` kaydı da
 * temizlenir, böylece aynı düğüm tekrar DOM'a girerse `hydrate()` onu
 * yeniden görür.
 *
 * @param {ParentNode} [root] Kökün kendisi de island olabilir.
 */
export function unmount(root = document) {
  const element = /** @type {HTMLElement} */ (root);

  if (element.dataset?.island) {
    lazyObserver?.unobserve(element);
    runCleanups(element);
  }

  for (const node of root.querySelectorAll?.("[data-island]") ?? []) {
    const child = /** @type {HTMLElement} */ (node);
    lazyObserver?.unobserve(child);
    runCleanups(child);
  }
}

/** @type {IntersectionObserver | null} */
let lazyObserver = null;

function getLazyObserver() {
  if (lazyObserver) return lazyObserver;

  lazyObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        lazyObserver.unobserve(entry.target);
        mountWhenReady(/** @type {HTMLElement} */ (entry.target));
      }
    },
    { rootMargin: "200px 0px" },
  );

  return lazyObserver;
}

/**
 * Bağlama işini boş zamana kaydır: aynı anda görünen çok sayıda island'ın
 * tek bir uzun task'a dönüşmesini engeller (TBT/INP).
 *
 * @param {() => void} fn
 */
function schedule(fn) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(fn, { timeout: 500 });
    return;
  }
  setTimeout(fn, 0);
}

/**
 * `load` tamamlanıp ana iş parçacığı boşalana kadar bekletir.
 *
 * @param {() => void} fn
 */
function afterLoad(fn) {
  if (document.readyState === "complete") {
    schedule(fn);
    return;
  }
  window.addEventListener("load", () => schedule(fn), { once: true });
}

/**
 * @param {HTMLElement} node
 */
function mountWhenReady(node) {
  if ("islandIdle" in node.dataset) {
    afterLoad(() => mountIsland(node));
    return;
  }
  schedule(() => mountIsland(node));
}

/** @param {ParentNode} [root] */
export function hydrate(root = document) {
  /** @type {HTMLElement[]} */
  const pending = [];

  for (const element of root.querySelectorAll("[data-island]")) {
    const node = /** @type {HTMLElement} */ (element);
    if (!isMounted(node)) pending.push(node);
  }

  if (!pending.length) return;

  // Ölçümler tek seferde okunur; araya yazma girmediği için tek reflow olur.
  const boxed = pending.map((node) => node.getClientRects().length > 0);

  pending.forEach((node, i) => {
    // `hidden` bir drawer/dialog'un düzen kutusu yoktur ve IntersectionObserver
    // onu asla bildirmez; bu yüzden gizli olanlar doğrudan bağlanır.
    if ("islandEager" in node.dataset || !boxed[i]) {
      mountIsland(node);
      return;
    }

    getLazyObserver().observe(node);
  });
}

/** Sonradan DOM'a eklenen island'ları da yakalar (infinite scroll, portal). */
export function observeDocument() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = /** @type {HTMLElement} */ (node);
        if (element.dataset?.island) hydrate(element.parentNode ?? document);
        if (element.querySelector?.("[data-island]")) hydrate(element);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}

export function start() {
  const run = () => {
    hydrate();
    observeDocument();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}
