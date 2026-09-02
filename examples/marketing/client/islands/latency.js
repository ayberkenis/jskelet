import { qs } from "jskelet/client";

/**
 * Sayfadaki tek "hız" iddiası: uydurma bir benchmark yerine, tarayıcının
 * kendisi ölçer. Aynı şablonu üreten iki uç çekilir —
 *
 *   - `/_fragment/render-demo-cached` : HTML TTL cache'inde, bellekten
 *   - `/_fragment/render-demo` : `no-store`, her istekte yeniden render
 *
 * Payload boyutu aynı olduğu için transfer süresi kıyaslamayı bulandırmaz;
 * aradaki fark cache'in kendisi. Bayt sayısı da yazılır: "neden HIT daha
 * yavaş göründü" sorusu genelde farklı boyutlu uçlardan gelir.
 *
 * @param {HTMLElement} element
 * @param {{ runs?: number, cachedUrl?: string, freshUrl?: string,
 *   done?: string, failed?: string, bytesLabel?: string }} props
 * @returns {void}
 */
export function mount(element, props) {
  const status = qs(element, "[data-latency-status]");
  const runs = Number(props.runs ?? 6);
  const bytesLabel = props.bytesLabel ?? "%s transferred";

  const targets = [
    {
      key: "cached",
      url: props.cachedUrl ?? "/_fragment/render-demo-cached",
    },
    {
      key: "fresh",
      url: props.freshUrl ?? "/_fragment/render-demo",
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

        write(element, target.key, median(samples), samples, bytesLabel);
      }

      if (status && props.done) {
        status.textContent = props.done.replace("%s", String(runs));
      }
    } catch {
      if (status && props.failed) status.textContent = props.failed;
    }
  })();
}

/**
 * @param {string} url
 * @returns {Promise<{ ms: number, cache: string, bytes: number }>}
 */
async function time(url) {
  const start = performance.now();
  // `cache: "no-store"` tarayıcı önbelleğini devre dışı bırakır; ölçülmek
  // istenen şey sunucunun HTML önbelleği, tarayıcının diski değil.
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.text();

  return {
    ms: performance.now() - start,
    cache: response.headers.get("x-jskelet-cache") ?? "-",
    bytes: new TextEncoder().encode(body).length,
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
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * @param {HTMLElement} element
 * @param {string} key
 * @param {number} ms
 * @param {Array<{ cache: string, bytes: number }>} samples
 * @param {string} bytesLabel
 * @returns {void}
 */
function write(element, key, ms, samples, bytesLabel) {
  const value = qs(element, `[data-latency-value="${key}"]`);
  const meta = qs(element, `[data-latency-cache="${key}"]`);
  const size = qs(element, `[data-latency-bytes="${key}"]`);
  const last = samples.at(-1);

  if (value) value.textContent = `${ms.toFixed(1)} ms`;
  if (meta) meta.textContent = `X-JSkelet-Cache: ${last?.cache ?? "-"}`;
  if (size && last) {
    size.textContent = bytesLabel.replace("%s", formatBytes(last.bytes));
  }
}
