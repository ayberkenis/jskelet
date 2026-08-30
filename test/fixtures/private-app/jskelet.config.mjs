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
    prewarm: { enabled: false },
  }),
};
