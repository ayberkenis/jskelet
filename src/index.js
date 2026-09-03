/**
 * JSkelet sunucu tarafı genel API'si.
 *
 * `import { route, notFound } from "jskelet"` — route dosyaları ve
 * controller'lar bu yüzeyi kullanır. Alt yollardan (`jskelet/server`)
 * ithal etmek de mümkün; buradaki liste "kararlı" sayılan yüzeydir.
 */
export {
  route,
  fragment,
  renderPage,
  renderView,
  renderNotFound,
} from "./server/render.js";
export { renderStatusPage, statusFromError } from "./server/status-page.js";
export { createApp, startServer } from "./server/create-app.js";
export {
  notFound,
  redirect,
  permanentRedirect,
  seeOther,
  isNotFoundError,
  isRedirectError,
  NotFoundError,
  RedirectError,
} from "./http/control-flow.js";
export { cache, withRequestCache } from "./http/request-cache.js";
export {
  clearCookie,
  getSignedCookie,
  parseCookies,
  randomToken,
  safeEqual,
  serializeCookie,
  setCookie,
  setSignedCookie,
} from "./http/cookies.js";
export { reportUpstreamFailure } from "./server/upstream-tracking.js";
export { asset, hasAsset, optimizedImage, getSpriteIds } from "./server/assets.js";
export { remoteImageUrl, parseAllowedRemoteUrl } from "./server/image-optimizer.js";
export { headHints } from "./server/head-hints.js";
export { renderHeadMeta } from "./server/metadata.js";
export {
  clearHtmlCache,
  dropHtmlCacheKey,
  getHtmlCacheEntries,
  getHtmlCacheSize,
  invalidateHtmlCache,
  withHtmlCache,
} from "./server/html-cache.js";
export {
  clearDataCache,
  dataCache,
  dropDataCacheKey,
  getDataCacheEntries,
  getDataCacheSize,
  getDataCacheStats,
  withDataCache,
} from "./server/data-cache.js";
// Paylaşımlı önbellek kademesinin durumu. Bağlantı kurulmamışken de güvenle
// çağrılır; healthcheck uçları bunu okuyor.
// `getRedisDetails()` bağlantının nereye kurulduğunu ve hangi türleri
// paylaştığını söyler (şifre asla dönmez); `inspectRedis()` tür başına anahtar
// sayar — bir `SCAN` turu olduğu için istek yolunda çağrılmamalı.
export { getRedisDetails, getRedisStatus, inspectRedis } from "./server/redis.js";
// CDN kademesi. JSkelet'in önbelleği origin önbelleği; ziyaretçinin gördüğü
// kopya edge'de duruyor. Bir içeriği gerçekten tazelemek için ikisini birlikte
// düşürmek gerekiyor: `invalidateHtmlCache()` + `purgeCloudflare()`.
export {
  cloudflareConfigured,
  fetchCacheAnalytics,
  fetchCloudflareOverview,
  fetchPathEdges,
  getCloudflareStatus,
  purgeCloudflare,
  toCloudflareUrls,
} from "./server/cloudflare.js";
// Upstream hız freninin host başına durumu: healthcheck ve teşhis uçları için.
export { getUpstreamLimiterStatus } from "./server/upstream-limiter.js";
export { prewarm, prewarmProgress, extractSameOriginLinks, isOnVisitPrewarm } from "./server/prewarm.js";
export { createProxy } from "./server/middleware/upstream-proxy.js";
export { getConfig, loadConfig } from "./config/index.js";
export { attrs, cn, cx, esc, jsonScript } from "./views/helpers/html.js";
export { csrfField, icon, image, link, preloadImage } from "./views/helpers/tags.js";
