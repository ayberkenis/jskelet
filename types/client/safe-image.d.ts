/**
 * Yüklenemeyen görseller için tek bir belge dinleyicisi.
 *
 * Bu iş bilinçli olarak **island değil**. Görsel ağırlıklı bir sayfada 80+
 * `<img>` olabiliyor ve her birine ayrı island bağlamak (gözlemci + dinamik
 * import + mount) sırf hata ihtimali için ciddi bir hidrasyon yükü. `error`
 * olayı kabarmaz ama yakalama fazında görülebilir, bu yüzden tek dinleyici
 * hepsini karşılar ve sonradan DOM'a eklenen görseller de kendiliğinden
 * kapsanır.
 *
 * Kullanım: görsele `data-safe-image` ekleyin. Kendi hata görünümünüzü
 * vermek için görseli `data-safe-image-host` taşıyan bir sarmalayıcıya alın
 * ve içine `<template data-safe-image-fallback>` koyun — framework hiçbir
 * stil dayatmaz, yalnızca değiştirme işini yapar.
 */
/**
 * @returns {void}
 */
export declare function startSafeImages(): void;
