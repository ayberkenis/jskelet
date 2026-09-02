/**
 * Admin paneli mutasyonları. Cevap metin değil `{ ok, code, params }` —
 * i18n client'ta.
 */
import {
  clearHtmlCache,
  dropHtmlCacheKey,
  getHtmlCacheSize,
  invalidateHtmlCache,
} from "../html-cache.js";
import {
  clearDataCache,
  dropDataCacheKey,
} from "../data-cache.js";
import {
  getRedisStatus,
  inspectRedis,
  redisDropMatching,
} from "../redis.js";
import {
  clearCloudflareCacheReserve,
  purgeCloudflare,
  setCloudflareFeature,
  setCloudflareSetting,
  toCloudflareUrls,
} from "../cloudflare.js";
import { prewarm, prewarmProgress } from "../prewarm.js";

/**
 * @param {Record<string, any>} body
 * @param {import('express').Request} req
 * @returns {Promise<{ ok: boolean, code?: string,
 *   params?: Record<string, string | number>,
 *   parts?: ({ code: string, params?: Record<string, string | number> } | null)[] }>}
 */
export async function runAction(body, req) {
  const type = String(body?.type ?? "");

  switch (type) {
    case "html:clear": {
      const size = getHtmlCacheSize();
      clearHtmlCache();
      return { ok: true, code: "html.cleared", params: { count: size } };
    }

    case "data:clear": {
      const prefix = typeof body.prefix === "string" && body.prefix ? body.prefix : undefined;
      const removed = clearDataCache(prefix);
      return prefix
        ? { ok: true, code: "data.clearedPrefix", params: { count: removed, prefix } }
        : { ok: true, code: "data.cleared", params: { count: removed } };
    }

    case "html:invalidate": {
      const target = String(body.target ?? "");
      if (!target.startsWith("/")) {
        return { ok: false, code: "target.invalid" };
      }

      const hard = body.hard === true;
      const count = invalidateHtmlCache(target, { hard });
      return {
        ok: true,
        code: hard ? "html.dropped" : "html.marked",
        params: { count, target },
      };
    }

    case "html:drop": {
      const key = String(body.key ?? "");
      if (!key) return { ok: false, code: "key.missing" };
      const existed = dropHtmlCacheKey(key);
      return { ok: true, code: existed ? "entry.dropped" : "entry.absent", params: { key } };
    }

    case "data:drop": {
      const key = String(body.key ?? "");
      if (!key) return { ok: false, code: "key.missing" };
      const existed = dropDataCacheKey(key);
      return { ok: true, code: existed ? "entry.dropped" : "entry.absent", params: { key } };
    }

    case "redis:inspect": {
      const result = await inspectRedis();
      if (!result.ok) return { ok: false, code: "redis.unreachable" };

      return {
        ok: true,
        parts: [
          { code: "redis.htmlKeys", params: { count: result.html } },
          { code: "redis.dataKeys", params: { count: result.data } },
          result.totalKeys !== null
            ? { code: "redis.dbKeys", params: { count: result.totalKeys } }
            : null,
          result.usedMemory ? { code: "redis.memory", params: { value: result.usedMemory } } : null,
        ].filter(Boolean),
      };
    }

    case "redis:drop": {
      const kind = body.kind === "data" ? "data" : "html";
      const status = getRedisStatus();
      if (!status.connected) {
        return { ok: false, code: "redis.notConnected" };
      }

      const dropped = await redisDropMatching(kind);
      return {
        ok: true,
        code: kind === "data" ? "redis.droppedData" : "redis.droppedHtml",
        params: { count: dropped },
      };
    }

    case "cf:purge-everything": {
      const result = await purgeCloudflare({ everything: true });
      return result.ok
        ? { ok: true, code: "cf.purgedEverything" }
        : cloudflareFailure(result.error);
    }

    case "cf:purge-urls": {
      const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
      if (!paths.length) return { ok: false, code: "cf.noPaths" };

      const urls = toCloudflareUrls(paths, originOf(req));
      if (!urls.length) return { ok: false, code: "cf.noHostname" };

      const result = await purgeCloudflare({ files: urls });
      return result.ok
        ? {
            ok: true,
            code: "cf.purgedUrls",
            params: { count: result.purged, batches: result.batches },
          }
        : cloudflareFailure(result.error);
    }

    case "cf:purge-keys": {
      /** @type {"prefixes" | "hosts" | "tags"} */
      const kind =
        body.kind === "hosts" ? "hosts" : body.kind === "tags" ? "tags" : "prefixes";

      const values = String(body.values ?? "")
        .split(/[\s,]+/)
        .filter(Boolean);

      if (!values.length) return { ok: false, code: "cf.nothingToPurge" };

      const result = await purgeCloudflare({ [kind]: values });
      return result.ok
        ? { ok: true, code: "cf.purgedKeys", params: { count: result.purged, kind } }
        : cloudflareFailure(result.error);
    }

    case "cf:setting": {
      const result = await setCloudflareSetting(body.id, body.value);
      return result.ok
        ? {
            ok: true,
            code: "cf.settingChanged",
            params: { id: String(body.id), value: String(result.value) },
          }
        : cloudflareFailure(result.error);
    }

    case "cf:feature": {
      const value = body.value === "on" ? "on" : "off";
      const result = await setCloudflareFeature(body.feature, value);
      return result.ok
        ? {
            ok: true,
            code: "cf.featureChanged",
            params: { feature: String(body.feature), value },
          }
        : cloudflareFailure(result.error);
    }

    case "cf:clear-reserve": {
      const result = await clearCloudflareCacheReserve();
      return result.ok
        ? { ok: true, code: "cf.reserveClearing" }
        : cloudflareFailure(result.error);
    }

    case "prewarm": {
      if (prewarmProgress.active) {
        return { ok: false, code: "prewarm.busy" };
      }

      const requested = Array.isArray(body.paths) ? body.paths : [];
      const paths = requested.filter(
        (/** @type {unknown} */ value) =>
          typeof value === "string" && value.startsWith("/"),
      );

      prewarm({
        origin: `${req.protocol}://${req.get("host")}`,
        paths: paths.length ? paths : undefined,
      }).catch((error) => {
        console.error("[admin] prewarm failed", error);
      });

      return paths.length
        ? { ok: true, code: "prewarm.paths", params: { count: paths.length } }
        : { ok: true, code: "prewarm.all" };
    }

    default:
      return { ok: false, code: "action.unknown", params: { type } };
  }
}

/**
 * @param {string | undefined} error
 * @returns {{ ok: false, code: string, params: { error: string } }}
 */
function cloudflareFailure(error) {
  return { ok: false, code: "cf.failed", params: { error: error ?? "unknown error" } };
}

/**
 * @param {import('express').Request} req
 * @returns {string | undefined}
 */
function originOf(req) {
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : undefined;
}
