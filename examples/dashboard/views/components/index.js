/**
 * Şablon local'leri.
 *
 * `views/components/**` altındaki her named export otomatik olarak şablon
 * local'i olur; barrel'ın tek işi `lib/` içindeki yardımcıları o listeye
 * sokmak. Böylece `formatTutar()` her şablonda import'suz kullanılabiliyor.
 */
export { formatTutar } from "../../lib/data.js";
