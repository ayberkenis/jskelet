/**
 * ISR ikamesi: route + query anahtarlı, TTL'li LRU HTML cache.
 *
 * TTL dolduğunda girdi hemen atılmaz: `stale` pencerede eski HTML anında
 * döner ve tazeleme arkada çalışır. Böylece ilk ısıtmadan sonra hiçbir istek
 * render'ı beklemez; buna karşılık HTML'deki veri en fazla `revalidate + bir
 * tazeleme turu` kadar geride olabilir. Fiyat gibi canlı alanlar istemcide
 * WebSocket'ten güncellendiği için bu gecikme ekranda görünmez.
 *
 * TTL dolmadan önce de tazelenir (**erken tazeleme**): son başarılı üretimin
 * süresi (`produceMs`) kadar önden arka plan refresh başlar, böylece yavaş
 * bir sayfa TTL anında hâlâ soğuk render'a düşmez. Trafik yoksa sweeper
 * girdiyi soft-bayatlatır ve ısıtma kuyruğuna alır.
 *
 * TTL'in yanında ikinci bir tazelik kaynağı daha var: **hedefli
 * invalidation**. Bir içerik güncellendiğinde tüm önbelleği boşaltmak
 * (`clearHtmlCache()`) o an sıcak olan her sayfayı soğuk render'a çevirir;
 * TTL'i beklemek ise güncellemeyi dakikalarca geciktirir.
 * `invalidateHtmlCache()` ikisinin arasını açar ve varsayılan davranışı
 * **bayatlatmaktır**: girdi silinmez, süresi geçmiş sayılır. Ziyaretçi eski
 * HTML'i beklemeden alır, tazeleme arkada tek seferde koşar.
 *
 * ## Paylaşımlı kademe
 *
 * `cache.redis` açıkken store'un ikinci bir kademesi olur. Bellek içi store
 * (L1) **birincil kalır**: `read()` senkron, sıkıştırılmış gövdeler girdiyle
 * birlikte ve tutarlılık makinesi (`tokens`, `purgedDeps`) tek proseste. Redis
 * yalnızca L1'de bulunmayan bir yol için render'ı atlatır ve invalidation'ı
 * diğer node'lara duyurur. Redis erişilemez olduğunda bu modül birebir eskisi
 * gibi çalışır.
 */
export type HtmlEntry = {
    html: string;
    status: number;
    expiresAt: number;
    staleUntil: number;
    encoded: Map<string, Buffer>;
    deps: Set<string>;
    storedAt: number;
    sharedEncodings: number;
    produceMs: number;
};
/**
 * Erken tazeleme lead'i: son render süresinin 2 katı (en az 250 ms), TTL'in
 * yarısından fazla olamaz — kısa TTL'lerde sürekli refresh döngüsü olmasın.
 *
 * @param {number} produceMs
 * @param {number} ttlMs
 * @returns {number}
 */
export declare function earlyRefreshLeadMs(produceMs: number, ttlMs: number): number;
/**
 * @param {string} key
 * @param {number} ttlSeconds 0 → cache yok
 * @param {() => Promise<{ html: string, status: number }>} producer
 * @returns {Promise<{ html: string, status: number, cached: boolean,
 *   stale?: boolean, early?: boolean, encoded?: Map<string, Buffer> }>}
 */
export declare function withHtmlCache(key: string, ttlSeconds: number, producer: () => Promise<{
    html: string;
    status: number;
}>): Promise<{
    html: string;
    status: number;
    cached: boolean;
    stale?: boolean;
    early?: boolean;
    encoded?: Map<string, Buffer>;
}>;
/**
 * Store'u tamamen boşaltır. Dev sunucusu manifest her değiştiğinde bunu
 * çağırır: saklanan HTML artık var olmayan hash'li varlıkları işaret ediyor,
 * yani gerçekten **geçersiz** — bayatlatmak yetmez.
 */
export declare function clearHtmlCache(): void;
export declare function getHtmlCacheSize(): number;
/**
 * Hedefli invalidation: TTL'i beklemeden, ama tüm önbelleği boşaltmadan.
 *
 * Varsayılan **yumuşaktır** (`hard: false`): girdi silinmez, süresi geçmiş
 * sayılır. Bir webhook beş yüz sayfayı birden düşürdüğünde sert silme, tam da
 * içeriğin güncellendiği anda beş yüz soğuk render başlatır ve upstream'i
 * döver. Bayatlatmada ise ziyaretçi eski HTML'i beklemeden alır, tazeleme
 * arkada ve anahtar başına tek seferde koşar. `hard: true` yalnızca eski
 * HTML'in gerçekten geçersiz olduğu durumlar için.
 *
 * Anahtar `yol?query` (isteğe bağlı `vary|` önekiyle) olduğundan eşleştirme
 * **yol kısmına** yapılır: bir yolun bütün query / host varyantları tek
 * çağrıyla düşer.
 *
 * @param {string | RegExp | (string | RegExp)[]} target
 * @param {{ hard?: boolean }} [options]
 * @returns {number} Etkilenen girdi sayısı (uçuştaki render'lar dahil).
 */
export declare function invalidateHtmlCache(target: string | RegExp | (string | RegExp)[], options?: {
    hard?: boolean;
}): number;
/**
 * Verilen veri anahtarlarını render sırasında okumuş sayfaları bayatlatır.
 * `clearDataCache()` bunu çağırır; uygulamanın hiçbir şey bildirmesi gerekmez.
 *
 * Burada **yayın yapılmaz**: çağıran `clearDataCache()` zaten bir
 * `data:clear` olayı yayınlıyor ve uzak node'lar aynı zinciri kendi ters
 * indeksleri üzerinden çalıştırıyor. Ters indeks node'a özel olduğu için
 * doğru olan da bu — bir sayfa yalnızca onu render etmiş node'da kayıtlı.
 *
 * @param {Iterable<string>} dataKeys
 * @returns {number} Etkilenen HTML girdisi sayısı.
 */
export declare function invalidateHtmlByDependency(dataKeys: Iterable<string>): number;
/**
 * Tek bir önbellek **anahtarını** düşürür.
 *
 * `invalidateHtmlCache()` yol deseniyle çalışıyor ve bir yolun bütün query
 * varyantlarını birlikte düşürüyor. Yönetim paneli listedeki tek satırı
 * silebilmek istiyor: `/liste?sayfa=2` düşerken `/liste?sayfa=3` sıcak
 * kalmalı. Desen sözdiziminde `?` kaçırılamadığı için ayrı bir yüzey.
 *
 * @param {string} key `yol?query` biçiminde tam anahtar.
 * @returns {boolean} Girdi var mıydı.
 */
export declare function dropHtmlCacheKey(key: string): boolean;
/**
 * Invalidate edilmiş ve henüz kimsenin istemediği yolları döner ve kuyruğu
 * boşaltır. Isıtma turu bunları başa alır; iki tur aynı yolu tekrar
 * ısıtmasın diye okuma yıkıcıdır.
 *
 * Vary öneki (`h=…|`) düşülür — HTTP ısıtması yalnızca yolu ister; host
 * ayrımı `prewarm.origins` / istek Host'u ile yapılır.
 *
 * @returns {string[]}
 */
export declare function takeInvalidatedPaths(): string[];
/**
 * Dev raporu için önbellek dökümü: hangi sayfa ne kadar HTML tutuyor, ne
 * zaman bayatlıyor, kaç veri anahtarına bağlı. HTML gövdesi dönmez, yalnızca
 * boyutu.
 *
 * @returns {{ key: string, bytes: number, status: number, stale: boolean,
 *   expiresIn: number, encodings: string[], deps: number }[]}
 */
export declare function getHtmlCacheEntries(): {
    key: string;
    bytes: number;
    status: number;
    stale: boolean;
    expiresIn: number;
    encodings: string[];
    deps: number;
}[];
/**
 * Yol (query'siz) için taze bir HTML girdisi var mı? Ziyaret ısıtması yalnızca
 * soğuk / bayat hedefleri kuyruğa alır; HIT'leri yeniden çekmez.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export declare function isHtmlCacheFresh(pathname: string): boolean;
/**
 * Erken tazeleme penceresine girmiş (veya TTL'i dolmuş) trafiksiz girdileri
 * soft-bayatlatır ve ısıtma kuyruğuna alır. HTTP ısıtması producer'sız
 * çalıştığı için soft-bayat şart: taze HIT yenileme tetiklemez.
 *
 * @returns {number} İşaretlenen girdi sayısı.
 */
export declare function sweepEarlyExpiry(): number;
/**
 * Trafiksiz sayfaların TTL öncesi soft-bayatlatılması. `startPrewarm` açar;
 * `PREWARM=0` iken hiç kurulmaz. `unref` — süreç kapanışını geciktirmez.
 *
 * @returns {void}
 */
export declare function startEarlyExpirySweep(): void;
