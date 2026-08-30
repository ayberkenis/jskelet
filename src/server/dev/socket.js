/**
 * Dev araçlarının canlı kanalı: küçük bir WebSocket sunucusu.
 *
 * Overlay eskiden istatistikleri iki saniyede bir `GET /stats` ile çekiyordu;
 * panel kapalıyken bile her sekme sürekli istek atıyor, dev sunucusunun istek
 * günlüğünü de kirletiyordu. Artık sunucu değişiklik oldukça (istek, hata,
 * ısıtma ilerlemesi, CSS/JS değişimi) tek bağlantı üzerinden itiyor.
 *
 * Bağımlılık eklemiyoruz: yalnızca sunucu→istemci metin çerçevesi yazmak ve
 * istemcinin ping/close çerçevelerini anlamak gerekiyor; bu da RFC 6455'in
 * küçük bir alt kümesi. `permessage-deflate` yok, parça (fragment) yok —
 * gönderdiğimiz paketler için ikisi de gereksiz.
 */
import { createHash } from "node:crypto";

/** RFC 6455'te sabitlenmiş el sıkışma tuzu. */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** @type {Set<import('node:net').Socket>} */
const sockets = new Set();

/** @param {string} key */
function accept(key) {
  return createHash("sha1")
    .update(key + GUID)
    .digest("base64");
}

/**
 * Tek parçalı metin çerçevesi. Maskeleme yalnızca istemci→sunucu yönünde
 * zorunlu olduğu için burada yok.
 *
 * @param {string} text
 * @returns {Buffer}
 */
function frame(text) {
  const payload = Buffer.from(text, "utf8");
  const length = payload.length;

  /** @type {Buffer} */
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

/**
 * İstemciden gelen çerçeveleri ayıklar. İçerik bizi ilgilendirmiyor; amaç
 * kapanışı ve ping'i doğru yanıtlamak, aksi hâlde tarayıcı bağlantıyı
 * "protokol hatası" sayıp kapatıyor.
 *
 * @param {import('node:net').Socket} socket
 */
function readFrames(socket) {
  let buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buffer.length < offset + 2) return;
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) return;
        length = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      if (masked) offset += 4;
      if (buffer.length < offset + length) return;

      buffer = buffer.subarray(offset + length);

      // 0x8 close, 0x9 ping. Veri çerçeveleri yok sayılır: istemcinin bize
      // söyleyeceği bir şey yok, kanal tek yönlü kullanılıyor.
      if (opcode === 0x8) {
        socket.end(Buffer.from([0x88, 0x00]));
        return;
      }
      if (opcode === 0x9) socket.write(Buffer.from([0x8a, 0x00]));
    }
  });
}

/**
 * HTTP upgrade isteğini WebSocket bağlantısına çevirir.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:net').Socket} socket
 * @param {Buffer} head Node'un istekle birlikte okuduğu artakalan baytlar.
 * @param {(send: (payload: object) => void) => void} onOpen
 *   Bağlantı kurulunca çağrılır; ilk paketi göndermek için kullanılır.
 */
export function upgradeToSocket(req, socket, head, onOpen) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept(String(key))}\r\n\r\n`,
  );

  // Küçük paketleri geciktirmenin anlamı yok; panel anlık görünmeli.
  socket.setNoDelay(true);
  // Bağlantı hataları (sekme kapanması, ağ) süreci düşürmemeli.
  socket.on("error", () => socket.destroy());
  socket.on("close", () => sockets.delete(socket));

  readFrames(socket);
  // İstekle aynı okumada gelen baytlar varsa akışa geri konur; yoksa
  // istemcinin ilk çerçevesi sessizce kaybolur.
  if (head?.length) socket.unshift(head);
  sockets.add(socket);

  /** @param {object} payload */
  const send = (payload) => {
    if (!socket.destroyed) socket.write(frame(JSON.stringify(payload)));
  };

  // İlk paketler bir sonraki tur'a bırakılır. Aynı yazma turunda gönderilirse
  // el sıkışma yanıtıyla tek bir TCP parçasına düşüyor ve tarayıcı o parçada
  // artakalan baytları HTTP gövdesi sanıp bağlantıyı sessizce kapatıyor: ham
  // bir istemci sorun görmez, Chrome "finished" deyip çıkar.
  setImmediate(() => {
    if (!socket.destroyed) onOpen(send);
  });
}

/**
 * Bağlı tüm panellere gönderir.
 * @param {object} payload
 */
export function broadcastSocket(payload) {
  if (!sockets.size) return;

  const packet = frame(JSON.stringify(payload));
  for (const socket of sockets) {
    if (socket.destroyed) sockets.delete(socket);
    else socket.write(packet);
  }
}

/** @returns {number} açık panel sayısı */
export function socketCount() {
  return sockets.size;
}
