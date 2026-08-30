/**
 * Türkçe içerik sözlüğü — `/tr` altındaki sayfalar bunu okur.
 *
 * Anahtar kümesi `en.js` ile birebir aynı olmak zorunda: şablonlar dil bilmez,
 * yalnızca `t.*` okur ve eksik bir anahtar sessizce `undefined` basar.
 */

export default {
  locale: "tr",
  htmlLang: "tr",
  ogLocale: "tr_TR",
  label: "Türkçe",
  short: "TR",

  meta: {
    titleTemplate: "%s · JSkelet",
    description:
      "İçerik siteleri için yalın bir Node.js çatısı: sunucudan tam HTML, etkileşim için island'lar ve stale-while-revalidate'li, bellekte yaşayan bir HTML cache.",
  },

  nav: [
    { key: "howItWorks", label: "Nasıl çalışır" },
    { key: "compare", label: "Kıyaslama" },
    { key: "migrate", label: "Taşıma" },
    { key: "docs", label: "Belgeler" },
    { key: "changelog", label: "Sürümler" },
  ],

  ui: {
    skipToContent: "İçeriğe geç",
    mainMenu: "Ana menü",
    mobileMenu: "Mobil menü",
    toggleTheme: "Temayı değiştir",
    openMenu: "Menüyü aç",
    github: "GitHub'da görüntüle",
    githubShort: "GitHub",
    download: "İndir",
    downloadVersion: "v%s sürümünü al",
    copy: "kopyala",
    copied: "kopyalandı",
    copyFailed: "kopyalanamadı",
    language: "Dil",
    languageSwitch: "Dili değiştir",
    releaseLabel: "Güncel sürüm",
    sitemap: "Site haritası",
    license: "%s lisanslı",
    nodeRequirement: "Node.js %s",
    activeDevelopment: "Geliştirme aktif",
    footerTagline:
      "İçeriği sunucuda üret. JavaScript'i yalnızca ağırlığını hak ettiği yerde uyandır.",
    footerNote:
      "Bu site depodaki pazarlama örneğinin kendisidir ve üzerindeki her bayt değeri kendi build çıktısından ölçülür.",
    exploreHint: "Ayrıntıya bak",
  },

  pages: {
    home: {
      title: "Web'in iskeleti, fazlası değil",
      description:
        "Sunucudan tam HTML, etkileşim için island'lar ve bellekte HTML cache. React runtime'ı yok, hidrasyon şelalesi yok.",
    },
    howItWorks: {
      title: "Bir isteğin yolculuğu",
      description:
        "İstekten ekrana beş net durak: Express, HTML cache, controller, EJS ve yalnızca gerektiğinde uyanan island'lar.",
    },
    compare: {
      title: "Projeniz için doğru aracı seçin",
      description:
        "JSkelet, Next.js App Router, Astro ve elle yazılmış Express + EJS arasındaki mimari takaslar — JSkelet'in kaybettiği satırlar dahil.",
    },
    migrate: {
      title: "Next.js'ten sayfa sayfa geçiş",
      description:
        "Karşılık tablosu ve güvenli bir sıra: app router yerine route tablosu, client component yerine island, ISR yerine HTML TTL.",
    },
    docs: {
      title: "Belgeler",
      description:
        "Küçük bir API yüzeyi ve her kararın yalnızca nasılını değil nedenini de anlatan on bir bölüm.",
    },
    changelog: {
      title: "Sürüm notları",
      description:
        "Her sürümde eklenen özellikler, değişen davranışlar ve düzeltilen hatalar.",
    },
    download: {
      title: "İndirme ve kurulum",
      description:
        "Sürüm künyesi, gereksinimler, bağımlılıklar ve boş bir dizinden çalışan bir siteye gitmek için gereken dört komut.",
    },
  },

  home: {
    badge: "Açık kaynak · Node.js %s · %s",
    headline: "Web'in iskeleti.",
    headlineAccent: "Fazlası değil.",
    lead: "Tam HTML sunucudan gelir. JavaScript yalnızca dokunduğunuz yerde uyanır. Cache, ziyaretçiniz daha istemeden sayfayı hazırlar.",
    ctaPrimary: "Akışı keşfet",
    ctaSecondary: "v%s sürümünü indir",
    chips: ["Express 5", "EJS + Island", "HTML TTL Cache"],
    marquee: [
      "Sunucuda tam HTML",
      "Gerektiği kadar JavaScript",
      "Stale-while-revalidate",
      "Sıfır React runtime",
    ],
    hero: {
      diagramLabel: "JSkelet istek akışı",
      logoAlt: "JSkelet logosu",
      responseLabel: "Yanıt",
      responseValue: "200 · HTML hazır",
      clientLabel: "Client",
      clientValue: "island.mount()",
      terminalLabel: "terminal",
      terminalLines: ["route hazır", "island hazır"],
    },
    pillars: {
      eyebrow: "Yalın mimari",
      title: "Üç katman. Tek bir hızlı deneyim.",
      lead: "Sunucu içeriği hazırlar, cache beklemeyi kaldırır, island'lar yalnızca sayfanın gerçekten ihtiyaç duyduğu davranışı ekler.",
    },
    payload: {
      eyebrow: "Şeffaf performans",
      title: "Hafif demiyoruz. Gösteriyoruz.",
      lead: "Bu değerler gerçek build çıktısından okunuyor ve gzip sonrası ağırlığı gösteriyor. Pazarlama sözü değil, çalışan kod.",
      totalLabel: "Her şey dahil (gzip)",
      totalNote:
        "Stylesheet, entry, sprite ve sitedeki bütün island'lar birlikte. Tek bir sayfa bunun hepsini indirmiyor.",
      fontsValue: "0",
      fontsLabel: "Web font isteği",
      fontsNote: "Sistem font yığını. FOUT ve font kaynaklı düzen kayması yok.",
      blockingValue: "1",
      blockingLabel: "Render'ı bloke eden istek",
      blockingNote: "Tek stylesheet. Client entry modül olduğu için defer edilmiş.",
      eagerValue: "2",
      eagerLabel: "Hemen inen island",
      eagerNote:
        "Tema ve mobil menü. Diğer island'ların hepsi görünürlüğe girene kadar bekler.",
      footnote:
        "Karşılaştırılabilir bir sayı istiyorsanız kendi projenizi aynı şekilde ölçün: bir aracın hafif olduğu iddiası, ancak sizin sayfanızda ölçüldüğünde bir şey ifade eder.",
    },
    cache: {
      eyebrow: "Kesintisiz akış",
      title: "Eski sayfa hemen gider. Yenisi arkada hazırlanır.",
      lead: "Stale-while-revalidate ziyaretçiyi render kuyruğundan çıkarır. Bir route, bir TTL, tahmin edilebilir davranış.",
      points: [
        {
          tone: "good",
          text: "Cache anahtarı yol ve query; HIT durumunda controller hiç çalışmaz.",
        },
        {
          tone: "good",
          text: "Prewarm açılışta sayfaları render eder, yani ilk ziyaretçi soğuk cache'e denk gelmez.",
        },
        {
          tone: "good",
          text: "Her yanıt kendi cache durumunu bir başlıkta taşır; ölçmek için ayrı bir araç gerekmez.",
        },
        {
          tone: "bad",
          text: "Nokta atışı geçersizleme yok: TTL ve tümünü boşaltma var.",
        },
      ],
      codeLabel: "routes/10-pages.mjs",
    },
    fit: {
      eyebrow: "Doğru eşleşme",
      title: "Her işi yapmaya çalışmaz.",
      lead: "JSkelet içerik ve keşfedilebilirlik için tasarlandı. Durum ağırlıklı uygulamalarda başka bir araç genelde daha doğru cevaptır.",
    },
    faq: {
      eyebrow: "SSS",
      title: "Sık sorulanlar",
      more: "Kalan sorular ve tam karşılık tablosu %s.",
      moreLink: "taşıma sayfasında",
    },
    finalCta: {
      title: "İlk sayfanız beş dakikada hazır.",
      body: "Tek komut, birlikte çalışan bir route, bir bileşen ve bir island'dan oluşan bir iskelet kurar.",
      primary: "İndir",
      secondary: "Belgeleri oku",
    },
  },

  payloadLabels: {
    "app.css": "Stylesheet (Tailwind v4 çıktısı)",
    "main.js": "Client entry (island yükleyicisi)",
    "sprite.svg": "İkon sprite'ı",
    islands: "Tüm island'lar (talep üzerine, ayrı chunk'lar)",
    total: "Toplam — her island yüklenirse",
    caption:
      "Bu sayfanın kendi build çıktısı, istek anında diskten okunup ölçüldü. Sağdaki sütun gzip sonrası. Island chunk'ları yalnızca ilgili element görünürlüğe girdiğinde iner; ilk yükte hepsi indirilmez.",
    missing:
      "Build çıktısı bulunamadı, dolayısıyla ölçülecek dosya da yok. Build komutu çalıştırıldığında bu tablo sitenin gerçek varlık boyutlarıyla dolar. Sayfanın kendisi build olmadan da çalışır: manifest yoksa layout stylesheet etiketini hiç basmaz.",
    bytesColumn: "Ham",
    gzipColumn: "gzip",
  },

  pillars: [
    {
      icon: "FileHtml",
      title: "İçerik hazır gelir",
      body: "Tarayıcı boş bir kabuk almaz. İnsanlar ve arama motorları, JavaScript beklemeden aynı eksiksiz HTML'i görür.",
    },
    {
      icon: "Island",
      title: "Hareket yerinde uyanır",
      body: "Menü, sayaç veya grafik kendi island'ında yaşar. Modülü yalnızca görünür olduğunda iner; sayfanın geri kalanı sessiz kalır.",
    },
    {
      icon: "Lightning",
      title: "Bekleme aradan çıkar",
      body: "HTML bellekte sıcak tutulur. Süresi dolan sayfa hemen sunulur, yenisi arkada hazırlanır; kimse render kuyruğuna girmez.",
    },
  ],

  pipeline: [
    {
      step: "1",
      title: "İstek kapıdan girer",
      body: "Express 5 güvenlik başlıklarını, yönlendirmeleri ve statik dosyaları belirli bir sırayla işler. Akış görünür ve belgeli; gizli sihir yok.",
    },
    {
      step: "2",
      title: "Sıcak HTML aranır",
      body: "HIT ise hazır sayfa anında döner. TTL dolmuşsa ziyaretçi yine beklemez: mevcut HTML gider, tazeleme arkada başlar.",
    },
    {
      step: "3",
      title: "Veri tek yerde toplanır",
      body: "Düz bir async controller görünümü, veriyi ve metadata'yı döndürür. Okuması kolay, framework töreni yok.",
    },
    {
      step: "4",
      title: "Sayfa birleştirilir",
      body: "EJS gövdeyi ve layout'u eksiksiz HTML'e dönüştürür. Küçük fonksiyon bileşenleri sayfalarda ve fragment'larda aynı şekilde kullanılabilir.",
    },
    {
      step: "5",
      title: "Gereken parça canlanır",
      body: "Tarayıcı yalnızca görünen island'ın modülünü indirir ve davranışı bağlar. JavaScript hiç gelmese bile içerik okunabilir kalır.",
    },
  ],

  howItWorks: {
    hero: {
      eyebrow: "Bir isteğin yolculuğu",
      title: "Sunucudan ekrana, beş net durak.",
      lead: "Kara kutu yok. Her adım okunabilir, değiştirilebilir ve tek başına anlaşılabilir.",
    },
  },

  islandContract: {
    eyebrow: "Island sözleşmesi",
    title: "Sayfayı değil, ihtiyacı olan parçayı canlandır.",
    lead: "Sunucu görünümü tamamlar. Island küçük bir davranış katmanı ekler. Bağlantı kopsa bile içerik yerinde kalır.",
    points: [
      "Varsayılan strateji görünürlük: gözlemci 200px önceden indirmeye başlar.",
      "Bir attribute island'ı global davranışlar için hemen bağlar, bir diğeri tarayıcı boşalana kadar erteler.",
      "Props işaretlemede JSON olarak taşınır; sunucu verisi ikinci kez çekilmez.",
      "Bir mount fonksiyonu temizleme fonksiyonu döndürebilir.",
    ],
    payoff: {
      eyebrow: "Karşılığı",
      title: "Bu üç karar pratikte ne getiriyor",
    },
    ctaPrimary: "Kıyasla ve ölç",
    ctaSecondary: "Belgeleri oku",
  },

  comparison: {
    columns: [
      "JSkelet",
      "Next.js (App Router)",
      "Astro + adapter",
      "Express + EJS (elle)",
    ],
    legend: {
      good: "bu yaklaşımın avantajı",
      bad: "bilinçli ya da yapısal eksik",
      neutral: "nötr, yalnızca farklı",
    },
    rows: [
      {
        label: "Boş sayfada client JS",
        values: [
          { text: "Tek entry; island yoksa başka hiçbir şey", tone: "good" },
          { text: "React ve runtime, sayfa statik olsa da", tone: "bad" },
          { text: "Yok; UI framework'ü seçilmediği sürece", tone: "good" },
          { text: "Yok (etkileşimi de yok)", tone: "good" },
        ],
      },
      {
        label: "Etkileşim modeli",
        values: [
          { text: "Vanilla island ve bir mount fonksiyonu", tone: "good" },
          { text: "Bileşen ağacı, sunucu/client sınırıyla", tone: "neutral" },
          { text: "İstediğiniz UI framework'ünde island", tone: "good" },
          { text: "Kendi kurduğunuz script etiketleri", tone: "neutral" },
        ],
      },
      {
        label: "HTML önbelleği",
        values: [
          { text: "Süreç içinde TTL, stale-while-revalidate ile", tone: "good" },
          { text: "ISR; platforma ve deposuna bağlı", tone: "neutral" },
          { text: "Statik build ya da adapter'ın CDN'i", tone: "neutral" },
          { text: "Yok; kendiniz kurarsınız", tone: "bad" },
        ],
      },
      {
        label: "Nokta atışı geçersizleme",
        values: [
          { text: "Eksik — yalnızca TTL ve tümünü boşaltma", tone: "bad" },
          { text: "Etiket ve yol bazında destekli", tone: "good" },
          { text: "Yeniden build ya da adapter ne veriyorsa", tone: "neutral" },
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
        label: "Streaming ve kısmi render",
        values: [
          { text: "Eksik; yavaş bölümler fragment'a taşınır", tone: "bad" },
          { text: "Akış sınırlarıyla destekli", tone: "good" },
          { text: "Server island ve ertelenmiş içerik", tone: "neutral" },
          { text: "Elle", tone: "neutral" },
        ],
      },
      {
        label: "Build zinciri",
        values: [
          { text: "esbuild ve Tailwind v4; opsiyonel adımlar kendini atlar", tone: "good" },
          { text: "Güçlü bir bundler, geniş yapılandırma yüzeyi", tone: "neutral" },
          { text: "Vite", tone: "good" },
          { text: "Ne kurarsanız", tone: "neutral" },
        ],
      },
      {
        label: "Tipler",
        values: [
          { text: "Düz JS ve JSDoc; derleme adımı yok", tone: "neutral" },
          { text: "TypeScript birinci sınıf", tone: "good" },
          { text: "TypeScript birinci sınıf", tone: "good" },
          { text: "Size bağlı", tone: "neutral" },
        ],
      },
      {
        label: "Oturuma özel sayfa HTML'i",
        values: [
          { text: "Cache'lenemez; fragment'a taşınır", tone: "bad" },
          { text: "Destekli", tone: "good" },
          { text: "SSR modunda destekli", tone: "good" },
          { text: "Destekli", tone: "good" },
        ],
      },
    ],
  },

  compare: {
    hero: {
      eyebrow: "Bilerek seç",
      title: "Kazanan yok. Uyan var.",
      lead: "Dört yaklaşımın güçlü ve zayıf taraflarını aynı zeminde görün. JSkelet'in kaybettiği satırları saklamıyoruz.",
    },
    live: {
      eyebrow: "Şimdi, bu tarayıcıda",
      title: "Cache farkını canlı izle.",
      lead: "İki istek, aynı sunucu ve aynı ağ. Tek fark: biri hazır sunulur, diğeri her seferinde sıfırdan render edilir.",
      cachedLabel: "Cache'ten hazır gelen",
      cachedBadge: "canlı",
      cachedNote: "Bellekten sunulur; controller hiç çalışmaz.",
      freshLabel: "Her seferinde render edilen",
      freshBadge: "her istekte",
      freshNote: "no-store işaretli, yani şablon motoru her seferinde çalışır.",
      measuring: "ölçülüyor…",
      status:
        "JavaScript kapalıysa bu bölüm ölçüm yapmaz; sayfanın kalanı etkilenmez.",
      statusDone: "%s istek, medyan. Bu tarayıcıda ve bu ağda ölçüldü.",
      statusFailed: "Ölçüm yapılamadı.",
      footnote:
        "Yerelde iki sayı da milisaniyeler mertebesinde çıkar ve fark küçük görünür. Önemli olan cache'li tarafın veri kaynağından bağımsız olması: controller bir API'ye ya da veritabanına gidiyorsa o maliyet MISS'e yazılır, HIT'e hiç yazılmaz.",
    },
    weight: {
      eyebrow: "Ölçülen ağırlık",
      title: "Bu sitenin kendi build çıktısı",
      lead: "Yukarıdaki 'boş sayfada client JS' satırının bu projedeki gerçek karşılığı.",
    },
    apply: {
      eyebrow: "Karar",
      title: "Tabloyu kendi projenize uygulayın",
      lead: "Satırların çoğu nötr. Karar genelde son iki satırda veriliyor.",
      ctaPrimary: "Next.js'ten taşıma",
      ctaSecondary: "Nasıl çalışır",
    },
  },

  fit: {
    title: { good: "İyi uyum", bad: "Yanlış seçim" },
    good: [
      "İçerik siteleri, bloglar ve dokümantasyon",
      "Pazarlama ve kampanya sayfaları",
      "Ürün listeleri, kataloglar ve ilanlar",
      "SEO'nun gelir kalemi olduğu her sayfa",
    ],
    bad: [
      "Dashboard ve yönetim panelleri",
      "Editör benzeri, durum ağırlıklı arayüzler",
      "Her oturum açan kullanıcıya göre değişen sayfalar",
      "Saniyede güncellenen gerçek zamanlı ekranlar",
    ],
  },

  docs: {
    hero: {
      eyebrow: "Haritayı eline al",
      title: "Küçük yüzey. Derin belgeler.",
      lead: "Kurulumdan dağıtıma kadar her kararın yalnızca nasıl kullanıldığını değil, neden var olduğunu da okuyun.",
    },
    examples: {
      label: "örnekleri çalıştır",
      title: "Depoda üç örnek",
      body: "Minimal örnek çalışan en küçük hâl, blog örneği framework'ün her yüzeyine dokunur, pazarlama örneği ise okuduğunuz bu sayfa.",
      note: "Sunucu ayaktayken duman testi her ucun beklendiği gibi yanıt verdiğini doğrular.",
    },
    openLabel: "Bölümü oku",

    /** Sidebar bölümleri; anahtarlar `lib/docs.js` → `DOC_GROUPS` ile aynı. */
    groups: {
      start: "Başlangıç",
      build: "Sayfa kurmak",
      performance: "Performans",
      reference: "Referans",
    },

    /** Belge kabuğunun tüm etiketleri: sidebar, TOC, gezinme ve uyarılar. */
    shell: {
      nav: "Belge bölümleri",
      breadcrumb: "Konum",
      docsLabel: "Belgeler",
      overview: "Genel bakış",
      browse: "Bölümlere göz at",
      onThisPage: "Bu sayfada",
      previous: "Önceki",
      next: "Sonraki",
      edit: "Bu sayfayı GitHub'da düzenle",
      versionLabel: "Güncel sürüm",
      version: "v%s belgeleri",
      start: "Okumaya başla",
      untranslated:
        "Bu bölüm henüz çevrilmedi, bu yüzden İngilizce gösteriliyor.",
    },

    items: [
      {
        slug: "getting-started",
        title: "Başlangıç",
        body: "Kurulum, ilk route, ilk island, dizin yapısı ve CLI.",
      },
      {
        slug: "architecture",
        title: "Mimari",
        body: "Kararlar, gerekçeleri ve sözleşme sayılan middleware sırası.",
      },
      {
        slug: "routing",
        title: "Routing",
        body: "Route modülleri, controller sözleşmesi ve yükleme sırasının nasıl belirlendiği.",
      },
      {
        slug: "rendering",
        title: "Render ve şablonlar",
        body: "Layout, bileşenler, yardımcılar ve metadata şeması.",
      },
      {
        slug: "islands",
        title: "Island'lar",
        body: "Island sözleşmesi, hidrasyon stratejileri, paylaşılan durum ve DOM yardımcıları.",
      },
      {
        slug: "caching",
        title: "Cache",
        body: "TTL, stale-while-revalidate, cache anahtarı ve ısıtma.",
      },
      {
        slug: "build",
        title: "Build",
        body: "Build hattı, manifest, Tailwind kaynakları ve ikon sprite'ı.",
      },
      {
        slug: "configuration",
        title: "Yapılandırma",
        body: "Alan alan, tam yapılandırma referansı.",
      },
      {
        slug: "dev-tools",
        title: "Dev araçları",
        body: "Geliştirme akışı, overlay, rapor sayfası ve dev gate.",
      },
      {
        slug: "deployment",
        title: "Dağıtım",
        body: "Prod, Docker, ters proxy ve sağlık kontrolü.",
      },
      {
        slug: "migration",
        title: "Taşıma",
        body: "Next.js'ten geçiş: karşılık tablosu ve aşamalı plan.",
      },
    ],
  },

  migrate: {
    hero: {
      eyebrow: "Aşamalı geçiş",
      title: "Next.js bilginizi çöpe atmayın.",
      lead: "Kullandığınız kavramların çoğunun burada daha küçük bir karşılığı var. Trafik akmaya devam ederken sayfaları birer birer taşıyın.",
      chips: [
        "page.tsx → EJS",
        "Client Component → Island",
        "ISR → HTML TTL",
      ],
    },
    table: {
      from: "Next.js",
      to: "JSkelet",
      note: "Tam plan ve arkasındaki gerekçeler belgelerin taşıma bölümünde.",
    },
    order: {
      eyebrow: "Güvenli rota",
      title: "Önce en kolay kazanımı taşıyın.",
      lead: "İki uygulama ters proxy arkasında yan yana yaşayabilir. Riski küçük tutun, ölçün, sonra sıradaki sayfaya geçin.",
      steps: [
        {
          tone: "good",
          text: "En çok trafik alan, en az etkileşimli sayfayla başlayın — genelde bir liste ya da detay sayfası.",
        },
        {
          tone: "good",
          text: "Layout'u ve metadata varsayılanlarınızı hook'lara taşıyın.",
        },
        {
          tone: "good",
          text: "Client component'ları island'a indirin: çoğu bir düğme ve bir fetch'e dönüşür.",
        },
        {
          tone: "good",
          text: "Kişiye özel bölümleri fragment uçlarına ayırıp no-store işaretleyin.",
        },
        {
          tone: "good",
          text: "TTL'lerinizi ölçün: cache başlığı ve dev overlay'i yeterli.",
        },
        {
          tone: "bad",
          text: "Dashboard'ı olduğu yerde bırakın. O sayfalar için doğru araç bu değil.",
        },
      ],
      configLabel: "jskelet.config.mjs",
      configNote:
        "Bozuk bir config siteyi asla düşürmez: hata veren bir hook ya da başlık kuralı uyarı basar ve varsayılana döner.",
    },
    faq: { eyebrow: "SSS", title: "Taşırken en çok sorulanlar" },
    items: [
      { from: "app/page.tsx", to: "Bir route kaydı ve bir EJS sayfa şablonu" },
      { from: "generateMetadata()", to: "Controller'ın döndürdüğü metadata alanı" },
      { from: "layout.tsx", to: "Layout şablonu ve bir layout bağlamı hook'u" },
      { from: "not-found.tsx", to: "Config içindeki notFound hook'u" },
      { from: "redirect() / notFound()", to: "Aynı adlar, jskelet'ten import edilir" },
      {
        from: "next.config redirects/rewrites/headers",
        to: "jskelet.config.mjs içinde aynı sözdizimi",
      },
      { from: "export const revalidate = 60", to: "Route üzerinde bir revalidate seçeneği" },
      { from: "React client component", to: "Bir island elementi ve bir mount fonksiyonu" },
      { from: "Suspense ile ertelenen bölüm", to: "İstek üzerine render edilen bir fragment ucu" },
      { from: "next/image, next/link", to: "image() ve link() yardımcıları" },
      { from: "React Context / zustand", to: "Island'lar arası küçük durum için createStore()" },
    ],
  },

  faq: [
    {
      q: "Neden React yok?",
      a: "Sayfaların çoğu etkileşimli değil. React'in maliyeti sabit: runtime iner, ağaç kurulur, hidrasyon çalışır — ve sonuç sunucunun zaten ürettiği HTML'in aynısı olur. JSkelet o sabit maliyeti kaldırıp etkileşimi yalnızca ihtiyacı olan elementlere veriyor.",
    },
    {
      q: "TypeScript kullanabilir miyim?",
      a: "Framework'ün kendisi düz JavaScript ve JSDoc; derleme adımı yok. Uygulama tarafında denetlenen JavaScript'i açıp aynı tip güvenliğinin çoğunu derlemesiz alabilirsiniz; .ts dosyaları için hatta kendiniz bir adım eklersiniz.",
    },
    {
      q: "Cache süreç belleğinde: birden fazla instance'ta ne olur?",
      a: "Her instance kendi önbelleğini tutar, yani ilk ısınma her instance'ta bir kez yaşanır ve TTL sınırları birbirinden kayabilir. Isıtma bu boşluğun çoğunu açılışta kapatır. Nokta atışı geçersizleme gerekiyorsa bu model yetmez.",
    },
    {
      q: "Build çıktısı olmadan çalışır mı?",
      a: "Evet. Manifest yoksa varlık yardımcısı hash'siz yollara döner ve layout stylesheet etiketini hiç basmaz. Build adımını atlamak hata değil, stilsiz ama çalışan bir sayfa verir.",
    },
    {
      q: "Tailwind, sharp ve ikon seti zorunlu mu?",
      a: "Hiçbiri değil. Hepsi opsiyonel peer bağımlılık: paket kurulu değilse ilgili build adımı sessizce atlanır. Bozuk bir config de aynı şekilde davranır — siteyi düşürmek yerine uyarır ve varsayılana döner.",
    },
    {
      q: "HTML herkese aynıysa tema nasıl çalışıyor?",
      a: "Sunucuda hiç karara bağlanmıyor. Cache'lenen HTML her ziyaretçiye birebir aynı gittiği için tema ve dil gibi kişiye özel seçimler tarayıcıda yapılır; bu sayfadaki tema düğmesi de hemen bağlanan bir island.",
    },
  ],

  changelog: {
    hero: {
      eyebrow: "Sürüm geçmişi",
      title: "Ne değişti, ne zaman.",
      lead: "Her sürümde eklenen özellikler, değişen davranışlar ve düzeltilen hatalar. En üstteki sürüm bugün kurduğunuz sürüm.",
    },
    currentLabel: "Kurulu sürüm",
    currentNote: "Kurulum komutunun şu anda çözdüğü sürüm bu.",
    npmLabel: "npm'deki son sürüm",
    npmNewer: "npm'de v%s yayında; bu site henüz eski paketle çalışıyor.",
    dateLabel: "Yayın",
    empty:
      "Kurulu paketten sürüm notları okunamadı; bu yüzden burada listelenecek bir kayıt yok.",
    types: {
      added: "Eklendi",
      changed: "Değişti",
      fixed: "Düzeltildi",
      removed: "Kaldırıldı",
      breaking: "Kırıcı",
    },
    statuses: {
      current: "güncel",
      previous: "önceki",
      unreleased: "yayınlanmadı",
    },
    cta: {
      title: "Bu sürümü kurun",
      body: "npm'den tek komut; kurulan sürüm yukarıda yazan sürüm oluyor.",
      primary: "İndirme sayfası",
      secondary: "Belgeler",
    },
  },

  download: {
    hero: {
      eyebrow: "Kurulum",
      title: "Boş bir dizinden çalışan bir siteye.",
      lead: "Paket npm'de yayında. Dört komut ve sayfa sunuyorsunuz.",
      versionLabel: "Sürüm",
      licenseLabel: "Lisans",
      nodeLabel: "Gereksinim",
      unmeasured:
        "Kurulu paket okunamadı, bu yüzden aşağıdaki künye bilinen varsayılanlara düşüyor.",
    },
    steps: {
      eyebrow: "Dört komut",
      title: "Kurulumun tamamı",
      lead: "Her komut kopyalanabilir. İskelet, birlikte çalışan bir route, bir bileşen ve bir island verir.",
      serveLabel: "5 · Prod'da sun",
      serveNote:
        "Derlenmiş çıktıyı sunar, açılışta cache'i ısıtır ve her yanıtta durumunu bildirir.",
      items: [
        {
          label: "1 · Paketi kur",
          command: "install",
          note: "Framework'ü ve dört çalışma zamanı bağımlılığını npm'den çeker.",
        },
        {
          label: "2 · İskeleti oluştur",
          command: "init",
          note: "Dizin yapısını, ilk route'u, bir bileşeni ve bir island'ı kurar.",
        },
        {
          label: "3 · Geliştirmeye başla",
          command: "dev",
          note: "Dosyaları izler, varlıkları yeniden üretir ve siteyi dev overlay'iyle sunar.",
        },
        {
          label: "4 · Derle ve sun",
          command: "build",
          note: "Hash'li varlıkları üretir; start komutu ardından prod siteyi sunar.",
        },
      ],
    },
    requirements: {
      eyebrow: "Gereksinimler",
      title: "İhtiyacınız olanlar",
      items: [
        {
          icon: "HardDrives",
          title: "Node.js %s",
          body: "Çalışma zamanı hedefi bilinçli olarak güncel: daha eski motorlara transpile edilmiyor.",
        },
        {
          icon: "Database",
          title: "Veritabanı gerekmez",
          body: "Ayağa kalkmak için hiçbir şey şart değil. Veri kaynağınızı ihtiyaç duyduğunuzda getirin.",
        },
        {
          icon: "PuzzlePiece",
          title: "Opsiyonel ekler",
          body: "Tailwind, ikon seti ve görsel kodlayıcı opsiyonel. Birini atlarsanız ilgili build adımı kendini atlar.",
        },
      ],
    },
    dependencies: {
      eyebrow: "Beraberinde ne geliyor",
      title: "Bağımlılıkların tamamı",
      lead: "Çalışma zamanı bağımlılıkları paketle birlikte kurulur. Opsiyonel peer'lar yalnızca fiilen kullandığınız build adımları için gerekir.",
      runtimeTitle: "Çalışma zamanı",
      optionalTitle: "Opsiyonel",
      nameColumn: "Paket",
      versionColumn: "Aralık",
    },
    next: {
      eyebrow: "Sırada",
      title: "Buradan nereye",
      body: "Başlangıç bölümü aynı adımları açıklamalarıyla anlatıyor, sürüm notları ise bu sürümde nelerin geldiğini söylüyor.",
      primary: "Belgeleri oku",
      secondary: "Sürüm notlarına bak",
    },
  },

  notFound: {
    title: "Sayfa bulunamadı",
    code: "404",
    heading: "Bu parça iskelette yok.",
    body: "İstediğiniz yol route tablosunda bulunamadı. Ana sayfaya dönüp akışı yeniden yakalayabilirsiniz.",
    primary: "Ana sayfa",
    secondary: "Belgeler",
  },
};
