export type RedisConfig = import('../config/index.js').RedisConfig;
export type CacheEvent = {
    type: string;
    [key: string]: unknown;
};
/**
 * Bağlantıyı kurar. `createApp()` config yüklendikten sonra bir kez çağırır.
 *
 * `ioredis` opsiyonel peer bağımlılık ve **uygulamanın** node_modules'ünden
 * çözülür: framework `file:`/workspace bağlantısıyla kuruluysa düz bir
 * `import "ioredis"` framework'ün kendi ağacına bakar.
 *
 * @param {import('../config/index.js').ResolvedConfig} config
 * @returns {Promise<boolean>} Bağlantı kuruldu mu.
 */
export declare function connectRedis(config: import('../config/index.js').ResolvedConfig): Promise<boolean>;
/**
 * Önbellek olaylarına abone olur. Önbellek modülleri yükleme anında çağırır;
 * bağlantı sonradan kurulsa da kayıt geçerli kalır.
 *
 * Dinleyici **yalnızca yerel** işi yapmalı: yeniden yayın yapan bir dinleyici
 * iki node arasında sonsuz mesaj döngüsü üretir.
 *
 * @param {(event: CacheEvent) => void} listener
 */
export declare function onCacheEvent(listener: (event: CacheEvent) => void): void;
/**
 * Olayı diğer node'lara duyurur. Ateşle-unut: yayın hatası çağıranı
 * etkilemez, yerel invalidation zaten yapıldı.
 *
 * @param {CacheEvent} event
 */
export declare function publishCacheEvent(event: CacheEvent): void;
/**
 * Bu tür için paylaşım açık mı. `html`/`data` ayrı ayrı kapatılabiliyor:
 * veri önbelleğini paylaşmak neredeyse her zaman kazançlı, HTML gövdelerini
 * paylaşmak girdi başına yüz kilobayt trafik demek.
 *
 * @param {"html" | "data"} kind
 * @returns {boolean}
 */
export declare function redisShares(kind: "html" | "data"): boolean;
/** @returns {boolean} */
export declare function redisSharesEncoded(): boolean;
/**
 * @param {"html" | "data"} kind
 * @param {string} key
 * @returns {string}
 */
export declare function cacheKey(kind: "html" | "data", key: string): string;
/**
 * @param {string} key
 * @returns {Promise<any | null>} Girdi yoksa, ayrıştırılamıyorsa ya da Redis
 *   hata verirse `null` — hepsi "miss" sayılır.
 */
export declare function redisGetJson(key: string): Promise<any | null>;
/**
 * Ateşle-unut yazma. İsteğin yanıt yolunda beklenmez: HTML zaten L1'e
 * yazıldı, Redis kopyası yalnızca diğer node'lar için. 1 KB ve üstü gövdeler
 * brotli ile yazılır; okuma düz JSON'u da kabul eder.
 *
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlMs
 */
export declare function redisSetJson(key: string, value: unknown, ttlMs: number): void;
/**
 * @param {string[]} keys
 */
export declare function redisDrop(keys: string[]): void;
/**
 * Bir isim alanını tarar ve eşleşen anahtarları düşürür.
 *
 * `KEYS` **kullanılmaz**: tek komutta tüm keyspace'i tarayıp sunucuyu bloklar.
 * `SCAN` kursoru parça parça döner; bu yüzden işlem atomik değil, ama
 * invalidation'ın atomik olması gerekmiyor.
 *
 * @param {"html" | "data"} kind
 * @param {(key: string) => boolean} [match] Anahtarın **önek sonrası** kısmına
 *   uygulanır; verilmezse tür altındaki her şey düşer.
 * @returns {Promise<number>} Düşürülen anahtar sayısı.
 */
export declare function redisDropMatching(kind: "html" | "data", match?: (key: string) => boolean): Promise<number>;
/**
 * Dev raporu için durum özeti. Bağlantı yoksa da güvenle çağrılabilir.
 *
 * @returns {{ enabled: boolean, connected: boolean, keyPrefix: string,
 *   buildId: string, errors: number, bypassed: boolean }}
 */
export declare function getRedisStatus(): {
    enabled: boolean;
    connected: boolean;
    keyPrefix: string;
    buildId: string;
    errors: number;
    bypassed: boolean;
};
/**
 * Bağlantının **nereye** kurulduğu ve hangi ayarlarla çalıştığı.
 *
 * Şifre asla dönmez: bağlantı URL'i `redis://user:pass@host` biçiminde
 * olabiliyor ve panelin işi adresi göstermek, sırrı değil. Ayrıştırılamayan
 * bir URL için adres `"custom"` olur — bozuk bir değer teşhis ucunu
 * düşürmemeli.
 *
 * @returns {{ address: string, secure: boolean, db: string | null,
 *   namespace: string, keyPrefix: string, html: boolean, data: boolean,
 *   storeEncoded: boolean, events: boolean, commandTimeoutMs: number,
 *   subscribed: boolean }}
 */
export declare function getRedisDetails(): {
    address: string;
    secure: boolean;
    db: string | null;
    namespace: string;
    keyPrefix: string;
    html: boolean;
    data: boolean;
    storeEncoded: boolean;
    events: boolean;
    commandTimeoutMs: number;
    subscribed: boolean;
};
/**
 * Paylaşımlı kademede gerçekten **ne durduğunu** sayar: tür başına anahtar
 * sayısı ve sunucunun bildirdiği bellek kullanımı.
 *
 * Ayrı bir çağrı olması gerekiyor. Sayım `SCAN` turu demek ve panelin döküm
 * ucu birkaç saniyede bir yenileniyor; her turda tüm keyspace'i taramak
 * Redis'i teşhis uğruna yormak olurdu. Panel bunu düğmeye basınca çağırır.
 *
 * @returns {Promise<{ ok: boolean, html: number, data: number,
 *   usedMemory: string | null, totalKeys: number | null }>}
 */
export declare function inspectRedis(): Promise<{
    ok: boolean;
    html: number;
    data: number;
    usedMemory: string | null;
    totalKeys: number | null;
}>;
/**
 * Bağlantıları kapatır. `SIGTERM` sonrası uçuştaki komutların bitmesi
 * beklenir (`quit`), zorla kesilmez.
 *
 * @returns {Promise<void>}
 */
export declare function disconnectRedis(): Promise<void>;
/**
 * Testler için: sahte bir istemci enjekte eder. Gerçek bir Redis'e bağlanmadan
 * serileştirme ve olay yollarının doğrulanabilmesi gerekiyor.
 *
 * @param {any} fake `null` → katman kapatılır.
 * @param {Partial<RedisConfig>} [overrides]
 */
export declare function setRedisClientForTests(fake: any, overrides?: Partial<RedisConfig>): void;
/**
 * Testler için: abone kanalından gelmiş gibi olay besler. `originId`
 * verilmezse uzak bir node varsayılır; kendi kimliğini taşıyan bir yayını
 * olduğu gibi geri vermek de mümkün olmalı — eleme testi buna dayanıyor.
 *
 * @param {CacheEvent} event
 */
export declare function emitRemoteCacheEventForTests(event: CacheEvent): void;
