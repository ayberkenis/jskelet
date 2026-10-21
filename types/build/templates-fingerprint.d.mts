/**
 * `.jskelet/templates/` altındaki kayıt; build'in Templates adımı yazar.
 * `src/compile` VS Code eklentisine olduğu gibi kopyalandığı için yazım
 * `compileAll` içinde değil: oradan `version.mjs`'e uzanmak eklentiyi kırar.
 */
export declare const FINGERPRINT_FILE = "build.json";
/**
 * Kaynaklardan parmak izini hesaplar. Dosyalar kök-göreli yolla sıralanır;
 * makineden makineye aynı ağaç aynı kimliği vermeli ki kümedeki node'lar aynı
 * isim alanını paylaşsın.
 *
 * @param {{ root: string, dirs: Record<string, string>, layout?: string }} config
 * @returns {string} 10 hex karakter.
 */
export declare function computeTemplatesFingerprint(config: {
    root: string;
    dirs: Record<string, string>;
    layout?: string;
}): string;
/**
 * Parmak izini derleme çıktısının yanına yazar.
 *
 * @param {{ root: string, dirs: Record<string, string>, layout?: string }} config
 * @param {string} outDir `.jskelet/templates`
 * @returns {string}
 */
export declare function writeTemplatesFingerprint(config: {
    root: string;
    dirs: Record<string, string>;
    layout?: string;
}, outDir: string): string;
/**
 * Süreç ömrü boyunca sabit parmak izi.
 *
 * Production build'in yazdığı kaydı okur: cold start'ta view ağacını gezmek
 * istenmiyor (`ensureTemplatesCompiled` ile aynı gerekçe). Kayıt yoksa
 * (eski build, elle başlatılmış süreç) kaynaktan hesaplanır.
 *
 * Dev'de kayıt güvenilmez: watch yalnızca `.jsk` mtime'ına bakıyor, bir
 * bileşen `.js`'i ya da `.ejs` değiştiğinde dosya eskide kalır. Dev sunucusu
 * view değişikliğinde süreci yeniden başlattığı için açılışta kaynaktan
 * hesaplamak yeterli.
 *
 * @param {{ root: string, dirs: Record<string, string>, layout?: string }} config
 * @returns {string}
 */
export declare function getTemplatesFingerprint(config: {
    root: string;
    dirs: Record<string, string>;
    layout?: string;
}): string;
