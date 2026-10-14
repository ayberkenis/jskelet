/**
 * Test kalıbı: cache kuralı bilinçli olarak **her yolu** kapsıyor.
 *
 * Amaç, `private: true` kilidinin tek yönlü olduğunu doğrulamak — `/:path*`
 * gibi her şeyi kapsayan bir desen kişiye özel bir sayfayı önbelleğe
 * alınabilir hâle getirmemeli.
 */
export default {
  cache: () => ({
    html: { "/:path*": 60 },
    // Query kuralları: izin listesi, "hepsi" ve "hiçbiri" biçimlerinin üçü de
    // temsil edilsin ki `cache-query.test.mjs` her dalı sınayabilsin.
    query: { "/search": ["q", "page"], "/all": true, "/ignore": [] },
    prewarm: { enabled: false },
    // Senkron retry sözleşmesini sınayan testler için; prod varsayılanı
    // `background: true` (hemen 503).
    transientRetry: { attempts: 1, delayMs: 300, background: false },
  }),
};
