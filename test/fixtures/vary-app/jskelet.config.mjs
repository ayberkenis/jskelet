/**
 * Host / locale vary test kalıbı.
 */
export default {
  cache: () => ({
    html: { "/:path*": 60 },
    vary: {
      host: true,
      fn: (req) => {
        const host = String(req.get?.("host") ?? req.headers?.host ?? "");
        return host.startsWith("tr.") ? "l=tr" : "l=en";
      },
    },
    prewarm: { enabled: false },
  }),
};
