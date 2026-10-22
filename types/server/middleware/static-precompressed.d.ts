/**
 * `express.static`i yalnızca diskte dosyası olan yollarda çalıştırır.
 *
 * `send`, bulamadığı her yol (yani her sayfa isteği) ve her dizin için
 * stack trace'li bir `http-errors` 404'ü üretip sonra `next()` diyor. Yük
 * altında HIT yanıtının CPU'sunun ~%15'i bu hataları kurmaya gidiyordu. Aynı
 * `stat` burada hatasız yapılır; dizinler `index: false` ile zaten hiç
 * servis edilmiyor. Sonuç önbelleğe alınmaz: çalışırken `public/`e eklenen
 * dosya hemen görünür.
 *
 * @param {string} publicDir
 * @param {import('express').RequestHandler} serve
 * @returns {import('express').RequestHandler}
 */
export declare function existingFilesOnly(publicDir: string, serve: import('express').RequestHandler): import('express').RequestHandler;
/**
 * @param {string} publicDir
 * @returns {import('express').RequestHandler}
 */
export declare function staticPrecompressed(publicDir: string): import('express').RequestHandler;
