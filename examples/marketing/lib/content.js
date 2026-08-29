/**
 * Sitenin tüm metni burada. Pazarlama sayfalarında içerik şablonun içine
 * gömülmeye çok müsait; ayrı tutmanın faydası şu: aynı liste hem sayfada hem
 * fragment ucunda hem sitemap'te kullanılabiliyor ve bir sayı değiştiğinde
 * tek yerde değişiyor.
 *
 * Not: buradaki hiçbir sayı "benchmark" değil. Ölçülen değerler
 * `lib/payload.js` içinde sitenin kendi build çıktısından okunur;
 * karşılaştırmalar ise mimari farklar, hız iddiası değil.
 */

/** @typedef {{ href: string, label: string, description: string }} PageLink */

/**
 * Prewarm ve sitemap için tek kaynak. Yeni sayfa eklerken burası güncellenir;
 * `hooks.prewarmPaths()` ve `/sitemap.xml` ikisi de bunu okur.
 *
 * @returns {string[]}
 */
export function pagePaths() {
  return ["/", "/nasil-calisir", "/kiyaslama", "/tasima", "/belgeler"];
}

/** Hero altındaki üç satırlık özet. */
export const pillars = [
  {
    icon: "FileHtml",
    title: "Sunucuda tam HTML",
    body: "İlk boyama JS beklemez. İçerik tarayıcıda kurulmadığı için tarayıcı da, tarama botu da aynı işaretlemeyi görür.",
  },
  {
    icon: "Island",
    title: "Yalnızca gereken JS",
    body: "Etkileşim data-island taşıyan elementlere bağlanır. Modül görünürlükte, dinamik import ile iner; sayfanın kalanı hiç JS indirmez.",
  },
  {
    icon: "Lightning",
    title: "Bellekte HTML cache",
    body: "Route başına TTL. Süre dolduğunda eski HTML anında döner, tazeleme arkada yürür. İlk isteği bekleyen kullanıcı olmaz.",
  },
];

/** "Nasıl çalışır" sayfasındaki istek hattı. */
export const pipeline = [
  {
    step: "1",
    title: "İstek gelir",
    body: "Express 5. Sırayla: güvenlik başlıkları, redirect/rewrite tablosu, statik dosyalar, route tablosu. Sıra src/server/create-app.js başındaki numaralı yorumda yazılı ve sözleşme sayılır.",
  },
  {
    step: "2",
    title: "Cache'e bakılır",
    body: "GET ve revalidate > 0 ise anahtar path?query. HIT ise HTML doğrudan döner; controller hiç çalışmaz. STALE ise eski gövde döner ve tazeleme arkaya alınır.",
  },
  {
    step: "3",
    title: "Controller veriyi toplar",
    body: "Düz bir async fonksiyon: { view, data, metadata } döndürür. Aynı istek içinde tekrarlanan upstream çağrıları cache() ile bir kez yapılır.",
  },
  {
    step: "4",
    title: "EJS render eder",
    body: "Gövde ve layout bağlamı paralel hazırlanır. Bileşenler EJS değil, HTML string döndüren fonksiyonlar; sayfada, partial'da ve fragment ucunda aynı çıktıyı verir.",
  },
  {
    step: "5",
    title: "Tarayıcı hidre eder",
    body: "Tek stylesheet, tek küçük entry. IntersectionObserver 200px önceden island'ı görür, modülünü indirir ve mount(element, props) çağırır.",
  },
];

/**
 * Kıyaslama tablosu. Satırlar mimari kararlar; "daha hızlı" değil "farklı
 * takas" anlatır. Kasıtlı olarak JSkelet'in kaybettiği satırlar da var.
 */
export const comparison = {
  columns: ["JSkelet", "Next.js (App Router)", "Astro + adapter", "Express + EJS (elle)"],
  rows: [
    {
      label: "Boş sayfada client JS",
      values: [
        { text: "Tek entry, island yoksa başka hiçbir şey", tone: "good" },
        { text: "React + runtime, sayfa boş olsa da", tone: "bad" },
        { text: "Yok; island framework'ü seçilirse onun runtime'ı", tone: "good" },
        { text: "Yok (etkileşimi de yok)", tone: "good" },
      ],
    },
    {
      label: "Etkileşim modeli",
      values: [
        { text: "Vanilla island, mount(element, props)", tone: "good" },
        { text: "Bileşen ağacı, RSC + client component sınırı", tone: "neutral" },
        { text: "Island; istediğin UI framework'ü", tone: "good" },
        { text: "Elle yazdığın script etiketleri", tone: "neutral" },
      ],
    },
    {
      label: "HTML önbelleği",
      values: [
        { text: "Süreç belleğinde TTL + stale-while-revalidate", tone: "good" },
        { text: "ISR; dosya/CDN ve platform bağımlı", tone: "neutral" },
        { text: "Statik build ya da adapter'ın CDN'i", tone: "neutral" },
        { text: "Yok; kendin kurarsın", tone: "bad" },
      ],
    },
    {
      label: "Nokta atışı invalidation",
      values: [
        { text: "Yok — TTL ve tümünü boşaltma", tone: "bad" },
        { text: "Var (tag/path revalidate)", tone: "good" },
        { text: "Yeniden build ya da adapter'a bağlı", tone: "neutral" },
        { text: "Yok", tone: "bad" },
      ],
    },
    {
      label: "Routing",
      values: [
        { text: "Açık tablo; yollar dosyada yazılı", tone: "neutral" },
        { text: "Dosya sistemi", tone: "neutral" },
        { text: "Dosya sistemi", tone: "neutral" },
        { text: "Açık tablo", tone: "neutral" },
      ],
    },
    {
      label: "Streaming / kısmi render",
      values: [
        { text: "Yok; yavaş bölümler ayrı fragment ucundan", tone: "bad" },
        { text: "Var (Suspense, RSC akışı)", tone: "good" },
        { text: "Server island / deferred", tone: "neutral" },
        { text: "Elle", tone: "neutral" },
      ],
    },
    {
      label: "Build zinciri",
      values: [
        { text: "esbuild + Tailwind v4; opsiyoneller yoksa atlanır", tone: "good" },
        { text: "Turbopack/webpack; yapılandırma yüzeyi geniş", tone: "neutral" },
        { text: "Vite", tone: "good" },
        { text: "Ne kurarsan", tone: "neutral" },
      ],
    },
    {
      label: "Tipler",
      values: [
        { text: "Düz JS + JSDoc; derleme adımı yok", tone: "neutral" },
        { text: "TypeScript birinci sınıf", tone: "good" },
        { text: "TypeScript birinci sınıf", tone: "good" },
        { text: "Sana bağlı", tone: "neutral" },
      ],
    },
    {
      label: "Oturuma özel sayfa HTML'i",
      values: [
        { text: "Cache'lenemez; fragment'a taşınır", tone: "bad" },
        { text: "Destekleniyor", tone: "good" },
        { text: "SSR modunda destekleniyor", tone: "good" },
        { text: "Destekleniyor", tone: "good" },
      ],
    },
  ],
};

/** Ne için doğru, ne için yanlış araç. Pazarlama sayfasının en dürüst bölümü. */
export const fit = {
  good: [
    "İçerik siteleri, blog, dokümantasyon",
    "Pazarlama ve kampanya sayfaları",
    "Ürün/kategori listeleri, ilan ve katalog sayfaları",
    "SEO'nun gelir kalemi olduğu her sayfa",
  ],
  bad: [
    "Dashboard ve yönetim panelleri",
    "Editör benzeri, durum ağırlıklı arayüzler",
    "Her isteği kullanıcıya göre değişen sayfalar",
    "Gerçek zamanlı, saniyede güncellenen ekranlar",
  ],
};

/**
 * Belgeler sayfası. Bağlantılar depodaki `docs/` dizinine gider; framework
 * npm'de olmadığı için tek kanonik adres GitHub.
 */
export const docs = [
  { file: "01-baslangic", title: "Başlangıç", body: "Kurulum, ilk route, ilk island, dizin yapısı, CLI." },
  { file: "02-mimari", title: "Mimari", body: "Kararlar ve gerekçeleri, middleware sırası." },
  { file: "03-routing", title: "Routing", body: "Route modülleri, controller sözleşmesi, yükleme sırası." },
  { file: "04-render-ve-sablonlar", title: "Render ve şablonlar", body: "Layout, bileşenler, yardımcılar, metadata." },
  { file: "05-islands", title: "Island'lar", body: "Island sözleşmesi, hidrasyon stratejileri, store, DOM yardımcıları." },
  { file: "06-cache", title: "Cache", body: "TTL, stale-while-revalidate, anahtar, prewarm." },
  { file: "07-yapilandirma", title: "Yapılandırma", body: "jskelet.config.mjs tam referansı." },
  { file: "08-build", title: "Build", body: "Build hattı, manifest, Tailwind @source, sprite." },
  { file: "09-dev-araclari", title: "Dev araçları", body: "Dev akışı, overlay, rapor sayfası, dev gate." },
  { file: "10-dagitim", title: "Dağıtım", body: "Prod, Docker, ters proxy, sağlık kontrolü." },
  { file: "11-tasima", title: "Taşıma", body: "Next.js'ten taşıma: karşılık tablosu ve plan." },
];

/** `/tasima` sayfasındaki karşılık tablosu. */
export const migration = [
  { from: "app/page.tsx", to: "routes/10-pages.mjs + views/pages/home.ejs" },
  { from: "generateMetadata()", to: "controller'ın döndürdüğü metadata alanı" },
  { from: "layout.tsx", to: "views/layout.ejs + hooks.layoutContext()" },
  { from: "not-found.tsx", to: "hooks.notFound()" },
  { from: "redirect() / notFound()", to: "aynı adlar, jskelet'ten import" },
  { from: "next.config redirects/rewrites/headers", to: "jskelet.config.mjs içinde aynı sözdizimi" },
  { from: "revalidate = 60", to: "route(controller, { revalidate: 60 })" },
  { from: "React client component", to: "data-island + mount(element, props)" },
  { from: "Suspense ile ertelenen bölüm", to: "/_fragment/... ucu + istek üzerine HTML" },
  { from: "next/image, next/link", to: "image(), link() yardımcıları" },
  { from: "React Context / zustand", to: "createStore() (island'lar arası, küçük)" },
];

export const faq = [
  {
    q: "Neden React yok?",
    a: "Sayfaların çoğu etkileşimsiz. React'in maliyeti sabit: runtime iner, ağaç kurulur, hidrasyon olur — sonuç sunucunun bastığı HTML'in aynısı. JSkelet o sabiti kaldırıp etkileşimi yalnızca ihtiyacı olan elemente veriyor.",
  },
  {
    q: "TypeScript kullanabilir miyim?",
    a: "Framework'ün kendisi düz JS + JSDoc ve derleme adımı yok. Uygulama tarafında jsconfig.json ile checkJs açıp aynı tip güvenliğinin çoğunu derlemesiz alabilirsiniz; .ts dosyaları için build hattına kendiniz bir adım eklemeniz gerekir.",
  },
  {
    q: "Cache süreç belleğinde: birden fazla instance'ta ne olur?",
    a: "Her instance kendi önbelleğini tutar, yani ilk ısınma her birinde ayrı yaşanır ve TTL sınırları kayabilir. Prewarm açılışta bunu büyük ölçüde kapatır. Nokta atışı invalidation gerekiyorsa bu model yetmez.",
  },
  {
    q: "Build çıktısı olmadan çalışır mı?",
    a: "Evet. Manifest yoksa asset() hash'siz yola döner, hasAsset() false olur ve layout stylesheet etiketini hiç basmaz. jskelet build unutulduğunda hata değil, stilsiz ama çalışan bir sayfa görürsünüz.",
  },
  {
    q: "Tailwind, sharp, ikonlar zorunlu mu?",
    a: "Hiçbiri değil. Hepsi opsiyonel peer bağımlılık: kurulu değilse ilgili build adımı sessizce atlanır. Bozuk bir jskelet.config.mjs de aynı şekilde uyarı basıp varsayılana döner; yapılandırma hatası siteyi düşürmez.",
  },
  {
    q: "Tema nasıl çalışıyor, HTML herkese aynıysa?",
    a: "Sunucuda karara bağlanmıyor. Cache'lenen HTML herkese aynı gittiği için tema, dil gibi kişiye özel kararlar client'ta veriliyor; bu sayfadaki tema düğmesi de eager bir island.",
  },
];
