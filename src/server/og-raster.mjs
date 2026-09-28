/**
 * Yüzlü OG PNG'si.
 *
 * fontconfig `FONTCONFIG_FILE`'ı süreç açılırken okur. Üst süreçte sonradan
 * atanan ortam değişkeni (özellikle Windows CRT `getenv`) görünmez; bu yüzden
 * çizim, dosyayı baştan gören bu süreçte yapılır.
 */
const sharpMod = await import(process.env.JSKELET_SHARP);
const sharp = sharpMod.default ?? sharpMod;

/** @type {Buffer[]} */
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

const width = Number(process.env.JSKELET_OG_WIDTH);
const height = Number(process.env.JSKELET_OG_HEIGHT);
const body = await sharp(Buffer.concat(chunks))
  .resize(width, height, { fit: "fill" })
  .png()
  .toBuffer();
process.stdout.write(body);
