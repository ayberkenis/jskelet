export type LogsConfig = import('../../config/index.js').LogsConfig;
export type ResolvedConfig = import('../../config/index.js').ResolvedConfig;
export type LogSink = import('./file-sink.js').LogSink;
/**
 * Access middleware mount edilmeli mi?
 *
 * Dev'de yalnızca console isteniyorsa mount edilmez — HTML satırlarını
 * zaten devtools basıyor; çift kayıt olmasın. Sink açıksa ya da production
 * console access log istiyorsa mount edilir.
 *
 * @param {LogsConfig} logs
 * @returns {boolean}
 */
export declare function shouldMountAccessLog(logs: LogsConfig): boolean;
/**
 * @param {ResolvedConfig} config
 * @returns {Promise<{ accessLog: boolean }>}
 */
export declare function configureLogs(config: ResolvedConfig): Promise<{
    accessLog: boolean;
}>;
/**
 * Access middleware ve `log.subscribe` ortak giriş noktası.
 *
 * @param {Record<string, unknown>} raw
 */
export declare function acceptLogEntry(raw: Record<string, unknown>): void;
/**
 * Kapanışta buffer'ları boşaltır.
 *
 * @returns {Promise<void>}
 */
export declare function flushLogs(): Promise<void>;
/**
 * @returns {Promise<void>}
 */
export declare function closeLogs(): Promise<void>;
