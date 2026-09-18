/**
 * HTTP upgrade isteğini WebSocket bağlantısına çevirir.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:net').Socket} socket
 * @param {Buffer} head Node'un istekle birlikte okuduğu artakalan baytlar.
 * @param {(send: (payload: object) => void) => void} onOpen
 *   Bağlantı kurulunca çağrılır; ilk paketi göndermek için kullanılır.
 */
export declare function upgradeToSocket(req: import('node:http').IncomingMessage, socket: import('node:net').Socket, head: Buffer, onOpen: (send: (payload: object) => void) => void): void;
/**
 * Bağlı tüm panellere gönderir.
 * @param {object} payload
 */
export declare function broadcastSocket(payload: object): void;
/** @returns {number} açık panel sayısı */
export declare function socketCount(): number;
