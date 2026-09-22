/**
 * onVisit-only prewarm: klasik alan yok, prewarmPaths yok.
 */
export default {
  cache: () => ({
    prewarm: {
      onVisit: { perPage: 5, concurrency: 2, rps: 1 },
    },
  }),
  navigation: {
    exclude: ["/cikis", "/panel/*"],
  },
  prewarmSkip: ["/api/", "/_fragment/", "/__jskelet/"],
};
