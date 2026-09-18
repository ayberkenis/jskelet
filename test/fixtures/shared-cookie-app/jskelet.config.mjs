/**
 * Paylaşımlı cookie + handoff test kalıbı.
 */
export default {
  brand: {
    sharedCookieRoots: [".investvio.com", ".localhost"],
  },
  auth: {
    crossSubdomainHandoff: true,
  },
  cache: () => ({
    prewarm: { enabled: false },
  }),
};
