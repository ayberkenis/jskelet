export type DataEntry = {
    value: unknown;
    expiresAt: number;
    staleUntil: number;
};
/**
 * Süreç ömrü boyunca biriken sayaçlar.
 *
 * Isıtma turunun kotayı ne kadar harcadığı ancak buradan görülüyor: tur
 * bittiğinde `produced` kaç gerçek upstream çağrısı yapıldığını, `hits` kaçının
 * hiç gitmediğini söyler. Oran düşükse çözüm hız freni değil, TTL'i uzatmak —
 * fren çağrıları yavaşlatır, sayısını azaltmaz.
 */
declare const stats: {
    /** Taze girdiden servis edildi. */
    hits: number;
    /** Bayat girdiden servis edildi; tazeleme arkada koştu. */
    stale: number;
    /** Girdi yoktu, çağıran bekledi. */
    misses: number;
    /** Aynı anahtarı eşzamanlı isteyen çağrılar tek üretime düştü. */
    coalesced: number;
    /** Paylaşımlı kademeden geldi; upstream'e gitmedi. */
    shared: number;
    /** `producer` gerçekten çalıştı — kotaya yazılan tek sayı. */
    produced: number;
    /** `ttlSeconds: 0` ile önbellek tamamen atlandı. */
    bypassed: number;
};
/**
 * Veriyi önbellekten döner, gerekiyorsa `producer` ile üretir.
 *
 * @param {string} key Anahtar tamamen uygulamanın; sürüm/dil gibi ayrımlar
 *   anahtara yazılır (`quote:v2:${symbol}`).
 * @param {number} ttlSeconds 0 → önbellek yok, `producer` her çağrıda çalışır.
 * @param {() => Promise<T>} producer
 * @param {{ storeEmpty?: boolean, staleFactor?: number }} [options]
 *   `storeEmpty` boş cevabı da saklar, `staleFactor` bu anahtar için bayat
 *   penceresini ayarlar (0 → bayat servis yok).
 * @returns {Promise<T>}
 * @template T
 */
export declare function withDataCache<T>(key: string, ttlSeconds: number, producer: () => Promise<T>, options?: {
    storeEmpty?: boolean;
    staleFactor?: number;
}): Promise<T>;
/**
 * `withDataCache`'in fonksiyon sarmalayıcısı: argümanlardan anahtar üretir.
 * `cache()` (istek içi memoizasyon) ile aynı kullanım biçimi, ama istekler
 * arasında ve TTL'li.
 *
 * @param {F} fn
 * @param {{ key: string, revalidate: number, storeEmpty?: boolean,
 *   staleFactor?: number }} options `key` önektir; argümanlar sonuna eklenir.
 * @returns {F}
 * @template {(...args: any[]) => Promise<any>} F
 */
export declare function dataCache<F extends (...args: any[]) => Promise<any>>(fn: F, options: {
    key: string;
    revalidate: number;
    storeEmpty?: boolean;
    staleFactor?: number;
}): F;
/**
 * Bir anahtarı ya da önek eşleşen tüm anahtarları düşürür. Webhook ile
 * "bu haber güncellendi" bilgisi geldiğinde kullanılır.
 *
 * Düşen anahtarları **render sırasında okumuş** HTML girdileri de bayatlar:
 * uygulamanın ayrıca `invalidateHtmlCache()` çağırması gerekmez ve aynı veriyi
 * gösteren liste sayfalarını unutmak mümkün değildir (bkz. `cache-deps.js`).
 *
 * `cache.redis` açıkken çağrı ayrıca paylaşımlı kademeden siler ve diğer
 * node'lara duyurulur — bugün bir webhook yalnızca isteği alan node'un
 * önbelleğini tazeliyor, diğerleri TTL'i bekliyordu.
 *
 * @param {string} [prefix] Verilmezse tüm önbellek boşaltılır.
 * @returns {number} Silinen girdi sayısı.
 */
export declare function clearDataCache(prefix?: string): number;
/**
 * Tek bir veri anahtarını düşürür.
 *
 * `clearDataCache()` **önek** eşleştiriyor: `quote:v2:AAPL` verildiğinde
 * `quote:v2:AAPLX` de düşer. Yönetim panelinde listeden seçilen satır tam
 * olarak o anahtar olmalı, komşusu değil.
 *
 * @param {string} key
 * @returns {boolean} Girdi var mıydı.
 */
export declare function dropDataCacheKey(key: string): boolean;
/** @returns {number} */
export declare function getDataCacheSize(): number;
/**
 * Süreç başından beri biriken sayaçlar. `produced` kotaya yazılan tek sayıdır:
 * geri kalan her şey upstream'e hiç gitmemiş bir okuma.
 *
 * @returns {typeof stats & { reads: number, hitRatio: number }}
 *   `reads` önbellekten geçen toplam okuma, `hitRatio` bunların kaçının
 *   upstream'e gitmediği (0–1).
 */
export declare function getDataCacheStats(): typeof stats & {
    reads: number;
    hitRatio: number;
};
/**
 * Dev raporu ve yönetim uçları için döküm. Değerin kendisi dönmez: JSON'un
 * tamamını bir teşhis ucundan dışa vermek istenmez.
 *
 * @returns {{ key: string, stale: boolean, expiresIn: number }[]}
 */
export declare function getDataCacheEntries(): {
    key: string;
    stale: boolean;
    expiresIn: number;
}[];
export {};
