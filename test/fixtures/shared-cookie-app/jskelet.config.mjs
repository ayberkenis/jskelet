/**
 * Paylaşımlı cookie + handoff test kalıbı.
 */
export default {
  brand: {
    sharedCookieRoots: [".investvio.com", ".localhost"],
  },
  auth: {
    crossSubdomainHandoff: {
      allowedCookieNames: ["sid"],
    },
  },
  cache: () => ({
    prewarm: { enabled: false },
  }),
};
