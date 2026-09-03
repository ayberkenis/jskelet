/**
 * onVisit + klasik alan → loadConfig hata vermeli.
 */
export default {
  cache: () => ({
    prewarm: {
      onVisit: true,
      max: 100,
    },
  }),
};
