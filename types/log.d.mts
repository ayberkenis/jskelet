/**
 * @param {{ console?: boolean, emitHttp?: boolean }} [options]
 */
export declare function configureLog(options?: {
    console?: boolean;
    emitHttp?: boolean;
}): void;
export declare const c: {
    bold: (text: string) => string;
    dim: (text: string) => string;
    red: (text: string) => string;
    green: (text: string) => string;
    yellow: (text: string) => string;
    blue: (text: string) => string;
    magenta: (text: string) => string;
    cyan: (text: string) => string;
    gray: (text: string) => string;
};
export declare const symbols: {
    ok: string;
    fail: string;
    warn: string;
    cycle: string;
    ready: string;
    arrow: string;
};
/** @param {number} value */
export declare function ms(value: number): string;
/** @param {number} bytes */
export declare function size(bytes: number): string;
/**
 * Saat, yerelden bağımsız olarak 24 saatlik biçimde. Dil etiketi vermek
 * sunucunun bulunduğu makinenin diline göre `ÖÖ/ÖS` ya da `AM/PM` basılmasına
 * yol açıyordu; log satırının genişliği sabit kalmalı.
 *
 * @returns {string} `01:49:02`
 */
export declare function clock(): string;
/**
 * @param {string} version
 * @param {string} mode
 * @param {string} [root]
 */
export declare function banner(version: string, mode: string, root?: string): void;
/** @param {string} title */
export declare function section(title: string): void;
/**
 * Build adımı. TTY'de spinner döner; bitince satır aynı ızgaraya oturur.
 *
 * @param {string} label
 * @returns {{ done: (detail?: string) => number, fail: (error: unknown) => void }}
 */
export declare function task(label: string): {
    done: (detail?: string) => number;
    fail: (error: unknown) => void;
};
/**
 * Adımın sütununa yazılacak kısa özet; ikinci ve sonraki çağrılar alt satıra
 * düşer. Adım dışında çağrılırsa doğrudan basılır.
 *
 * @param {string} text
 */
export declare function detail(text: string): void;
/**
 * Sütuna yazılacak özeti, adım içinde daha önce ayrıntı basılmış olsa bile
 * öne alır (ör. font indirme satırlarından sonra "4/4 weights").
 *
 * @param {string} text
 */
export declare function summary(text: string): void;
/** @param {string} text */
export declare function warn(text: string): void;
/**
 * Bölüm gövdesindeki düz satır (ör. çıktı boyutları).
 * @param {string} text
 */
export declare function line(text: string): void;
/** @param {string} text */
export declare function error(text: string): void;
/**
 * Başlangıç özeti: süre, adres ve watch durumu.
 *
 * @param {{ elapsed: number, url?: string | null, watching?: boolean, label?: string }} info
 */
export declare function ready({ elapsed, url, watching, label }: {
    elapsed: number;
    url?: string | null;
    watching?: boolean;
    label?: string;
}): void;
/**
 * Çalışma anı olayı: `01:49:03  ✓ css        rebuilt   195.9 kB   150ms`
 *
 * Hizalama ANSI kodlarından etkilenmesin diye `message` düz metin olmalı;
 * ek bilgi `note` ile geçilir.
 *
 * @param {{ symbol?: string, scope: string, message: string, note?: string, time?: number | null }} info
 */
export declare function event({ symbol, scope, message, note, time }: {
    symbol?: string;
    scope: string;
    message: string;
    note?: string;
    time?: number | null;
}): void;
/**
 * HTTP isteği. Cache bilgisi yalnızca gerçekten anlamlıysa (HIT) gösterilir;
 * her satıra MISS yazmak akışı okunmaz hâle getiriyor.
 *
 * @param {{ method: string, url: string, status: number, ms: number, cache?: string | null }} info
 */
export declare function http(info: {
    method: string;
    url: string;
    status: number;
    ms: number;
    cache?: string | null;
}): void;
/**
 * Çerçeveli bilgi kutusu.
 *
 * Açılış logunda kaybolmaması gereken tek şey sır: önbellek panelinin şifresi
 * her restart'ta değişiyor ve kullanıcı onu bir kez, akışın içinde görüyor.
 * Genişlik içeriğe göre büyür — bir URL'i ya da 32 haneli bir şifreyi
 * kırpmak kutunun bütün amacını bozar.
 *
 * @param {{ title: string, lines: string[],
 *   tint?: (value: string) => string }} info `lines` içinde boş string ayırıcı
 *   satır olur. Satırlar **düz metin** olmalı: bir ANSI dizisi `length`e
 *   sayıldığı için hizalamayı bozar, rengi çerçeve taşır.
 */
export declare function box({ title, lines, tint }: {
    title: string;
    lines: string[];
    tint?: (value: string) => string;
}): void;
/**
 * Çerçeveli hata kutusu — kendi framework'ünü geliştirirken hatanın
 * akış içinde kaybolmaması için.
 *
 * @param {{ title: string, name: string, message: string, lines?: string[] }} info
 */
export declare function errorBox({ title, name, message, lines }: {
    title: string;
    name: string;
    message: string;
    lines?: string[];
}): void;
/**
 * @param {(entry: Record<string, unknown>) => void} listener
 * @returns {() => void} Aboneliği iptal eden fonksiyon.
 */
export declare function subscribe(listener: (entry: Record<string, unknown>) => void): () => void;
