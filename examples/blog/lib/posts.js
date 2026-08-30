/**
 * Örneğin veri katmanı.
 *
 * Gerçek bir projede burada bir HTTP istemcisi ya da veritabanı olur. Önemli
 * olan desen: veri erişimi `cache()` ile sarılır, böylece aynı istek içinde
 * iki farklı bileşen aynı veriyi isterse yalnızca bir kez okunur — React'in
 * `cache()` fonksiyonuyla aynı sözleşme.
 *
 * Upstream'e giden gerçek bir istemcide iki şey daha gerekir (bkz.
 * docs/06-cache.md):
 *
 *   - `reportUpstreamFailure()`: framework böylece eksik veriyle üretilmiş
 *     HTML'i önbelleğe yazmadığını bilir.
 *   - `withDataCache(key, ttl, producer)`: `cache()` yalnızca tek bir istek
 *     boyunca yaşar, veri önbelleği istekler arasında. On binlerce yollu bir
 *     sitede API kotasını koruyan katman bu — HTML önbelleği yalnızca trafiği
 *     olan sayfaları tutabilir, verisi ise hepsi için bellekte durur.
 *
 * Bu örnekte veri süreç içinde sabit olduğu için ikisi de kullanılmıyor.
 */
import { cache } from "jskelet";

/**
 * @typedef {{ slug: string, title: string, excerpt: string, body: string[],
 *   publishedAt: string, tags: string[], readingMinutes: number }} Post
 */

/** @type {Post[]} */
const POSTS = [
  {
    slug: "island-mimarisi",
    title: "Island mimarisi neden işe yarıyor",
    excerpt:
      "Sunucu HTML'i eksiksizse JavaScript'in tek işi davranış eklemektir. " +
      "Bu ayrımın ölçülebilir sonucu ne oluyor?",
    body: [
      "Klasik SPA yaklaşımında sayfanın tamamı istemcide kuruluyor: sunucu boş bir kabuk gönderiyor, JavaScript indirilene kadar ekranda hiçbir şey yok. Island mimarisi bunu tersine çevirir. Sunucu tam HTML üretir, sayfa JavaScript hiç gelmese bile okunabilir ve linkler çalışır.",
      "JavaScript'in görevi yalnızca etkileşim eklemektir: bir menüyü açmak, bir sekmeyi değiştirmek, bir grafiği çizmek. Bu parçaların her biri bağımsız bir 'ada' ve kendi modülünü ayrı yükler.",
      "Kazanç bileşik: ekran dışındaki adalar hiç indirilmez, indirilenler de birbirini beklemez. Ana sayfada grafik kütüphanesi kullanan bir bileşen varsa ve kullanıcı o bölüme hiç kaydırmıyorsa, o kütüphane hiç ağa çıkmaz.",
    ],
    publishedAt: "2026-02-14",
    tags: ["mimari", "performans"],
    readingMinutes: 6,
  },
  {
    slug: "html-cache-ve-swr",
    title: "HTML cache ve stale-while-revalidate",
    excerpt:
      "Statik site üretmeden ISR'ın kazancını almak: TTL'li bir bellek " +
      "önbelleği ve arkada tazeleme.",
    body: [
      "Statik site üretimi hızlıdır ama veriyi build anında dondurur. Sürekli değişen içerik için bu doğru takas değil: her güncellemede yeniden build almak ya da bayat veri göstermek zorunda kalırsınız.",
      "JSkelet bunun yerine üretilen HTML'i süreç belleğinde TTL ile tutar. Süre dolduğunda eski HTML anında döner ve tazeleme arka planda çalışır — ziyaretçi hiçbir zaman render beklemez. Aynı anahtar için eşzamanlı istekler tek bir üretime düşer.",
      "Ayrıntı önemli: sıkıştırılmış gövde HTML ile birlikte saklanır. Aynı sayfa her istekte yeniden brotli'lenmez, sadece bir kez.",
    ],
    publishedAt: "2026-03-02",
    tags: ["cache", "performans"],
    readingMinutes: 8,
  },
  {
    slug: "tek-stylesheet",
    title: "Kritik CSS'i inline etmeyi bıraktık",
    excerpt:
      "Ölçüm, sezgiye ters çıktı: inline kritik CSS hem CLS üretiyor hem " +
      "her yanıtı büyütüyordu.",
    body: [
      "Yaygın tavsiye, ilk ekranı kapsayan CSS'i HTML'e gömüp geri kalanını sonradan yüklemek. Denedik ve geri aldık.",
      "İki sorun vardı. Birincisi, inline blok ilk ekranın tamamını kapsamıyordu; tam stylesheet geldiğinde sayfa yeniden akıyor ve bir liste sayfasında CLS 0,307'ye çıkıyordu. İkincisi, aynı ~27 kB her HTML yanıtında tekrarlanıyordu.",
      "Sıkıştırılmış tek bir stylesheet'i render-blocking bırakmak hem CLS'i sıfırladı hem HTML'i küçülttü. İkinci ziyarette dosya zaten immutable önbellekten geliyor.",
    ],
    publishedAt: "2026-04-19",
    tags: ["css", "performans"],
    readingMinutes: 5,
  },
];

/**
 * @returns {Post[]} Yeniden eskiye.
 */
export const getPosts = cache(() =>
  [...POSTS].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
);

/**
 * @param {string} slug
 * @returns {Post | undefined}
 */
export const getPost = cache((slug) => POSTS.find((post) => post.slug === slug));

/**
 * @param {string} tag
 * @returns {Post[]}
 */
export const getPostsByTag = cache((tag) =>
  getPosts().filter((post) => post.tags.includes(tag)),
);

/**
 * @returns {string[]}
 */
export const getTags = cache(() =>
  [...new Set(POSTS.flatMap((post) => post.tags))].sort(),
);

/**
 * Sitemap ve prewarm aynı listeyi kullanır: ikisinin ayrışması, ısıtılan
 * sayfa ile indekslenen sayfanın farklı olması gibi sinsi hatalar üretiyor.
 *
 * @returns {string[]}
 */
export function allPostPaths() {
  return [
    ...POSTS.map((post) => `/blog/${post.slug}`),
    ...getTags().map((tag) => `/etiket/${tag}`),
  ];
}
