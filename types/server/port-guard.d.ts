/**
 * `netstat -ano -p tcp` çıktısından LISTENING PID'lerini çıkarır.
 * `3000` ile `30001` karışmasın diye porttan sonra rakam olmamalı.
 *
 * @param {string} stdout
 * @param {number} port
 * @returns {number[]}
 */
export declare function parseWindowsNetstat(stdout: string, port: number): number[];
/**
 * `lsof -t` çıktısı: satır başına bir PID.
 *
 * @param {string} stdout
 * @returns {number[]}
 */
export declare function parseLsofPids(stdout: string): number[];
/**
 * `ss -H -lptn` satırlarından `pid=` değerlerini alır.
 *
 * @param {string} stdout
 * @returns {number[]}
 */
export declare function parseSsPids(stdout: string): number[];
/**
 * Portu dinleyen yabancı süreçlerin PID listesi.
 *
 * @param {number} port
 * @returns {Promise<number[]>}
 */
export declare function listListeningPids(port: number): Promise<number[]>;
/**
 * Porttaki dinleyicileri öldürür ve soketin boşalmasını kısa süre bekler.
 *
 * @param {number} port
 * @returns {Promise<number[]>} öldürülen PID'ler
 */
export declare function murderPort(port: number): Promise<number[]>;
/**
 * Port doluysa ya net hata fırlatır ya da `--murder` ile temizler.
 *
 * Dinleyici listesi alınamazsa (araç yok / yetki) sessizce geçer; asıl bağlama
 * `EADDRINUSE` ile yine düşer.
 *
 * @param {number} port
 * @param {{ murder?: boolean }} [options]
 * @returns {Promise<void>}
 */
export declare function ensurePortFree(port: number, options?: {
    murder?: boolean;
}): Promise<void>;
