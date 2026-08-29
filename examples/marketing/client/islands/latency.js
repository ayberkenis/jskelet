import { qs } from "jskelet/client";

/**
 * Sayfadaki tek "hız" iddiası: uydurma bir benchmark yerine, tarayıcının
 * kendisi ölçer. Aynı sunucudan iki uç çekilir —
 *
 *   - `/` : HTML TTL cache'inde duran, bellekten dönen sayfa
 *   - `/_fragment/render-demo` : `revalidate` verilmediği için her istekte
 *     yeniden render edilen, aynı bileşenleri kullanan bir parça
 *
 * İkisi de aynı ağı, aynı süreci ve aynı şablon motorunu kullanıyor, yani
 * aradaki fark cache'in kendisi. Ölçüm ziyaretçinin makinesinde ve ağında
 * yapıldığı için mutlak sayılar herkeste farklı çıkar; anlamlı olan oran.
 *
 * @param {HTMLElement} element
 * @returns {void}
 */
export function mount(element) {
  const status = qs(element, "[data-latency-status]");
  const runs = Number(element.dataset.runs ?? 6);

  const targets = [
    { key: "cached", url: element.dataset.cachedUrl ?? "/" },
    {
      key: "fresh",
      url: element.dataset.freshUrl ?? "/_fragment/render-demo",
    },
  ];

  void (async () => {
    try {
      for (const target of targets) {
        // Isınma isteği ölçüme girmez: ilk istek bağlantı kurulumunu ve
        // (cache'li uçta) olası bir MISS'i üstlenir.
        await time(target.url);

        const samples = [];
        for (let index = 0; index < runs; index += 1) {
          samples.push(await time(target.url));
        }

        write(element, target.key, median(samples), samples);
      }

      if (status) {
        status.textContent = `${runs} istek, medyan. Bu tarayıcıda ve bu ağda ölçüldü.`;
      }
    } catch {
      if (status) status.textContent = "Ölçüm yapılamadı.";
    }
  })();
}

/**
 * @param {string} url
 * @returns {Promise<{ ms: number, cache: string }>}
 */
async function time(url) {
  const start = performance.now();
  // `cache: "no-store"` tarayıcı önbelleğini devre dışı bırakır; ölçülmek
  // istenen şey sunucunun HTML önbelleği, tarayıcının diski değil.
  const response = await fetch(url, { cache: "no-store" });
  await response.text();

  return {
    ms: performance.now() - start,
    cache: response.headers.get("x-jskelet-cache") ?? "-",
  };
}

/**
 * @param {Array<{ ms: number }>} samples
 * @returns {number}
 */
function median(samples) {
  const values = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

/**
 * @param {HTMLElement} element
 * @param {string} key
 * @param {number} ms
 * @param {Array<{ cache: string }>} samples
 * @returns {void}
 */
function write(element, key, ms, samples) {
  const value = qs(element, `[data-latency-value="${key}"]`);
  const meta = qs(element, `[data-latency-cache="${key}"]`);

  if (value) value.textContent = `${ms.toFixed(1)} ms`;
  if (meta) meta.textContent = `X-JSkelet-Cache: ${samples.at(-1)?.cache ?? "-"}`;
}
