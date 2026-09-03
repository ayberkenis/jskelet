/**
 * onVisit-only prewarm: klasik alan yok, prewarmPaths yok.
 */
export default {
  cache: () => ({
    prewarm: {
      onVisit: { perPage: 5, concurrency: 2, rps: 3 },
    },
  }),
  navigation: {
    exclude: ["/cikis", "/panel/*"],
  },
  prewarmSkip: ["/api/", "/_fragment/", "/__jskelet/"],
};
