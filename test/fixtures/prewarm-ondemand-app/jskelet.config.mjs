/**
 * On-demand: prewarm kapalı; yalnızca ziyaret yazımı (html TTL + L2).
 */
export default {
  cache: () => ({
    html: { "/": 60, "/haber/:slug": 300 },
    prewarm: false,
  }),
};
