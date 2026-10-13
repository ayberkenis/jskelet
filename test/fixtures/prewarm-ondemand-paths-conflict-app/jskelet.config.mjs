/**
 * prewarm: false + prewarmPaths → loadConfig hata vermeli.
 */
export default {
  cache: () => ({
    prewarm: false,
  }),
  hooks: {
    prewarmPaths() {
      return ["/"];
    },
  },
};
