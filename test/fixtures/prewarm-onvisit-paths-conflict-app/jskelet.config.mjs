/**
 * onVisit + prewarmPaths → loadConfig hata vermeli.
 */
export default {
  cache: () => ({
    prewarm: {
      onVisit: true,
    },
  }),
  hooks: {
    prewarmPaths() {
      return ["/"];
    },
  },
};
