/**
 * Test kalıbı: ısıtma sırası. `priority` iki biçimi birlikte kullanıyor —
 * desen sözdizimi ve doğrudan `RegExp`.
 */
export default {
  cache: () => ({
    prewarm: {
      enabled: false,
      priority: ["/", "/piyasalar/:path*", /^\/haberler\//],
    },
  }),
};
