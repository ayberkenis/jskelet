/**
 * `jskelet.config.mjs` → `rewrites()` uygulayıcısı ve yeniden kullanılabilir
 * reverse proxy.
 *
 * Harici paket yok; native `fetch` ile stream eden ince bir proxy. `duplex:
 * "half"` gövdeli isteklerde şart, `redirect: "manual"` olmadan upstream'in
 * 302'si burada tüketilir ve tarayıcı hiç görmez.
 *
 * Tipik kullanım: `/api/*` yolunu backend'e taşımak. Bunu tarayıcı
 * same-origin çağırdığı için CORS ve third-party cookie sorunları oluşmaz.
 */
import { Readable } from "node:stream";
import { getConfig } from "../../config/index.js";
import { fillDestination, matchPattern } from "../../config/pattern.js";

/** Hop-by-hop header'lar proxy edilmez. */
const STRIPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

/**
 * Rewrite hedefini istek nesnesinde taşımak için; string bir alan adı
 * uygulamanın kendi alanlarıyla çakışabilir.
 */
const REWRITE_TARGET = Symbol("jskelet.rewriteTarget");

/**
 * @param {import('express').Request} req
 * @returns {Record<string, string>}
 */
function forwardHeaders(req) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (STRIPPED_REQUEST_HEADERS.has(key)) continue;
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

/**
 * Hedefi isteğe göre hesaplayan proxy üretir. `resolveTarget` fırlatırsa
 * istek proxy'lenmez ve zincire devam eder — hedef origin yapılandırılmamış
 * bir kurulumda 500 yerine normal 404 almak daha doğru.
 *
 * @param {(req: import('express').Request) => string} resolveTarget
 * @returns {import('express').RequestHandler}
 */
export function createProxy(resolveTarget) {
  return async (req, res, next) => {
    let target;
    try {
      target = resolveTarget(req);
    } catch {
      next();
      return;
    }

    if (!target) {
      next();
      return;
    }

    const hasBody = req.method !== "GET" && req.method !== "HEAD";

    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers: forwardHeaders(req),
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? "half" : undefined,
        redirect: "manual",
      });

      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) return;
        res.setHeader(key, value);
      });

      if (!upstream.body) {
        res.end();
        return;
      }

      Readable.fromWeb(upstream.body).pipe(res);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Config'teki `rewrites()` kuralları.
 *
 * Hedef mutlaksa (http/https) istek proxy ile dışa taşınır; göreliyse
 * yalnızca `req.url` değiştirilir ve istek kendi route tablosunda devam eder.
 * İki faz var: `beforeFiles` statik dosyalardan önce, `afterFiles` statik
 * denendikten sonra sayfalardan önce.
 *
 * @param {"beforeFiles" | "afterFiles"} phase
 * @returns {import('express').RequestHandler}
 */
export function configRewrites(phase) {
  const rules = getConfig().rewrites.filter((rule) => rule.phase === phase);
  if (!rules.length) return (req, res, next) => next();

  const proxy = createProxy((req) => req[REWRITE_TARGET]);

  return (req, res, next) => {
    for (const rule of rules) {
      const params = matchPattern(rule.pattern, req.path);
      if (!params) continue;

      const query = req.originalUrl.slice(req.path.length);
      const destination = fillDestination(rule.destination, params);

      if (/^https?:\/\//.test(destination)) {
        req[REWRITE_TARGET] = `${destination}${query}`;
        proxy(req, res, next);
        return;
      }

      req.url = `${destination}${query}`;
      break;
    }

    next();
  };
}
