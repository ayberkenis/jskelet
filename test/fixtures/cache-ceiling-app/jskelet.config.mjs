/**
 * HTML / veri / onVisit tavanları: yazılan değer kesilir, site düşmez.
 */
export default {
  cache() {
    return {
      maxEntries: 2500,
      data: { maxEntries: 50000, staleFactor: 10 },
      prewarm: {
        onVisit: { perPage: 100, rps: 10, concurrency: 8 },
      },
    };
  },
};
