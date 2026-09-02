import { qs } from "jskelet/client";

/**
 * Aynı şablonu üreten iki ucu ölçer. Üretici bilinçli bir upstream gecikmesi
 * taşır; HIT onu atlar. Toplam süre RTT içerir, bu yüzden `Server-Timing`
 * içindeki `produce` süresi de basılır — asıl fark orada.
 *
 * @param {HTMLElement} element
 * @param {{ runs?: number, cachedUrl?: string, freshUrl?: string,
 *   done?: string, failed?: string, bytesLabel?: string,
 *   produceLabel?: string, upstreamMs?: number }} props
 * @returns {void}
 */
export function mount(element, props) {
  const status = qs(element, "[data-latency-status]");
  const runs = Number(props.runs ?? 6);
  const bytesLabel = props.bytesLabel ?? "%s transferred";
  const produceLabel = props.produceLabel ?? "produce %s";
  const upstreamMs = Number(props.upstreamMs ?? 80);

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

  /** @type {Record<string, number>} */
  const totals = {};

  void (async () => {
    try {
      for (const target of targets) {
        await time(target.url);

        const samples = [];
        for (let index = 0; index < runs; index += 1) {
          samples.push(await time(target.url));
        }

        const ms = median(samples.map((sample) => sample.ms));
        const produce = median(samples.map((sample) => sample.produceMs));
        totals[target.key] = ms;
        write(element, target.key, {
          ms,
          produce,
          samples,
          bytesLabel,
          produceLabel,
        });
      }

      if (status) {
        const saved = Math.max(0, Math.round((totals.fresh ?? 0) - (totals.cached ?? 0)));
        const done = (props.done ?? "%s requests, median.")
          .replace("%s", String(runs))
          .replace("%u", String(upstreamMs))
          .replace("%d", String(saved));
        status.textContent = done;
      }
    } catch {
      if (status && props.failed) status.textContent = props.failed;
    }
  })();
}

/**
 * @param {string} url
 * @returns {Promise<{ ms: number, cache: string, bytes: number, produceMs: number }>}
 */
async function time(url) {
  const start = performance.now();
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.text();

  return {
    ms: performance.now() - start,
    cache: response.headers.get("x-jskelet-cache") ?? "-",
    bytes: new TextEncoder().encode(body).length,
    produceMs: readProduceMs(response.headers.get("server-timing")),
  };
}

/**
 * @param {string | null} header
 * @returns {number}
 */
function readProduceMs(header) {
  if (!header) return 0;
  const match = /(?:^|,)\s*produce;dur=([\d.]+)/i.exec(header);
  return match ? Number(match[1]) : 0;
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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
 * @param {{ ms: number, produce: number,
 *   samples: Array<{ cache: string, bytes: number }>,
 *   bytesLabel: string, produceLabel: string }} data
 * @returns {void}
 */
function write(element, key, data) {
  const value = qs(element, `[data-latency-value="${key}"]`);
  const meta = qs(element, `[data-latency-cache="${key}"]`);
  const size = qs(element, `[data-latency-bytes="${key}"]`);
  const produce = qs(element, `[data-latency-produce="${key}"]`);
  const last = data.samples.at(-1);

  if (value) value.textContent = `${data.ms.toFixed(1)} ms`;
  if (meta) meta.textContent = `X-JSkelet-Cache: ${last?.cache ?? "-"}`;
  if (size && last) {
    size.textContent = data.bytesLabel.replace("%s", formatBytes(last.bytes));
  }
  if (produce) {
    produce.textContent = data.produceLabel.replace(
      "%s",
      `${data.produce.toFixed(0)} ms`,
    );
  }
}
