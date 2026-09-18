/**
 * @param {{ root?: string, configFile?: string }} [options]
 * @returns {Promise<import('express').Express>}
 */
export declare function createApp(options?: {
    root?: string;
    configFile?: string;
}): Promise<import('express').Express>;
/**
 * Uygulamayı kurup dinlemeye başlar. CLI `jskelet start` bunu çağırır;
 * gömülü kullanımda `createApp()` tercih edilir.
 *
 * Port doluysa başlamaz. `murder: true` veya argv'de `--murder` varsa
 * dinleyen süreç öldürülüp bağlama denenir.
 *
 * @param {{ root?: string, configFile?: string, port?: number, host?: string, murder?: boolean }} [options]
 * @returns {Promise<import('http').Server>}
 */
export declare function startServer(options?: {
    root?: string;
    configFile?: string;
    port?: number;
    host?: string;
    murder?: boolean;
}): Promise<import('http').Server>;
