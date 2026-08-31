/**
 * Önbellek panelinin sözlüğü.
 *
 * Panel build hattından geçmiyor, bu yüzden hazır bir i18n kütüphanesi yok:
 * düz bir nesne, `{ad}` yer tutucusu ve `data-i18n` gezintisi kadarı yetiyor.
 *
 * Sunucudan gelen mesajlar **çevrilmez, kodlanır**: `/action` cevabı
 * `{ ok, code, params }` döner ve metin burada kurulur. Böylece sunucu tarafı
 * arayüz dilini hiç bilmiyor — panel iki dilde konuşurken framework'ün log'u
 * ve API'si tek dilde kalıyor.
 *
 * Dil seçimi `localStorage`'da: panel oturumu şifreyle açılıyor ve tercihin
 * sunucuya taşınmasının bir karşılığı yok.
 */

const STORAGE_KEY = "jskelet.cache-panel.lang";

/**
 * Sözlükler. Dışa açık, çünkü testler iki dilin anahtar kümesinin birebir
 * eşleştiğini ve şablonlarda geçen her anahtarın karşılığı olduğunu doğruluyor.
 *
 * @type {Record<string, Record<string, string>>}
 */
export const MESSAGES = {
  en: {
    /* --- kabuk --- */
    "nav.cache": "Cache",
    "shell.live": "live",
    "shell.refresh": "Refresh",
    "shell.signOut": "Sign out",
    "shell.language": "Language",
    "chip.up": "up {value}",

    /* --- kartlar --- */
    "card.htmlEntries": "HTML entries",
    "card.htmlMemory": "HTML in memory",
    "card.dataEntries": "Data entries",
    "card.sharedTier": "Shared tier",
    "card.prewarm": "Prewarm",
    "card.limit": "limit {count}",
    "card.stale": "{count} stale",
    "card.staleAndLimit": "{stale} stale · limit {limit}",

    /* --- durumlar --- */
    "state.on": "on",
    "state.off": "off",
    "state.bypassed": "bypassed",
    "state.connected": "connected",
    "state.disconnected": "disconnected",
    "state.notConfigured": "not configured",
    "state.idle": "idle",
    "state.yes": "yes",
    "state.no": "no",
    "state.none": "none",
    "state.default": "default",
    "state.unavailable": "unavailable",

    /* --- ısıtma --- */
    "prewarm.inProgress": "round in progress",
    "prewarm.lastRound": "last round: {done}/{total}",
    "prewarm.never": "no round yet",

    /* --- paylaşımlı kademe --- */
    "redis.section": "Shared tier",
    "redis.sub": "{address} · {errors} errors",
    "redis.disabled": "cache.redis.enabled is false",
    "redis.inspect": "Count keys in Redis",
    "redis.dropHtml": "Drop shared HTML keys",
    "redis.dropData": "Drop shared data keys",
    "redis.connection": "Connection",
    "redis.address": "Address",
    "redis.database": "Database",
    "redis.keyPrefix": "Key prefix",
    "redis.buildId": "Build id",
    "redis.sharesHtml": "Shares HTML",
    "redis.sharesData": "Shares data",
    "redis.compressed": "Compressed bodies",
    "redis.compressed.shared": "shared",
    "redis.compressed.local": "local only",
    "redis.broadcast": "Purge broadcast",
    "redis.broadcast.subscribed": "subscribed",
    "redis.broadcast.publish": "publish only",
    "redis.broadcast.local": "local only",
    "redis.timeout": "Command timeout",
    "redis.errors": "Command errors",
    "redis.tier": "Tier",
    "redis.tier.inProcess": "in-process only",
    "redis.replicas": "Replicas sharing this cache",
    "redis.suggest.title": "No shared tier.",
    "redis.suggest.body":
      "Every entry above lives in this process only, so each replica warms up " +
      "on its own and an invalidation reaches whichever replica received the " +
      "request. Adding Redis keeps the in-process cache primary and only does " +
      "what a single process cannot: serve HTML another replica already " +
      "rendered, and broadcast purges to all of them.",
    "redis.suggest.hint":
      "Worth it from the second replica onwards. On a single instance the gain " +
      "is close to zero, which is why it is off by default.",

    /* --- cloudflare --- */
    "cf.section": "Cloudflare",
    "cf.refresh": "Refresh",
    "cf.notConnected": "not connected",
    "cf.error": "error: {error}",
    "cf.purgeAll": "Purge everything",
    "cf.purgeCached": "Purge URLs cached here",
    "cf.devMode": "development mode (bypass cache for 3h)",
    "cf.kind.prefixes": "prefixes",
    "cf.kind.hosts": "hosts",
    "cf.kind.tags": "cache tags",
    "cf.values.placeholder":
      "example.com/news  ·  space or comma separated, 100 per request",
    "cf.purge": "Purge",
    "cf.toggleTiered": "Toggle Tiered Cache",
    "cf.toggleReserve": "Toggle Cache Reserve",
    "cf.clearReserve": "Clear Cache Reserve",
    "cf.path.placeholder":
      "/news/some-post — which edges served this path (blank = whole zone)",
    "cf.queryAnalytics": "Query analytics",
    "cf.edgeHint":
      "Cloudflare has no endpoint that lists which edges currently hold a copy " +
      "of a URL, and no way to warm a chosen edge from the origin — an object " +
      "only enters an edge cache through a real request routed there. What you " +
      "get above is observation: which colos served the path from cache and " +
      "which went to the origin. Warming is our prewarm pass plus Tiered Cache " +
      "or Cache Reserve behind it.",
    "cf.zone": "Zone",
    "cf.plan": "Plan",
    "cf.token": "Token",
    "cf.token.env": "from environment",
    "cf.token.config": "from config",
    "cf.devModeLabel": "Development mode",
    "cf.devMode.on": "on · {time} left",
    "cf.cacheLevel": "Cache level",
    "cf.browserTtl": "Browser cache TTL",
    "cf.edgeTtl": "Edge cache TTL",
    "cf.sortQuery": "Query string sorting",
    "cf.alwaysOnline": "Always Online",
    "cf.tiered": "Tiered Cache",
    "cf.regionalTiered": "Regional Tiered Cache",
    "cf.reserve": "Cache Reserve",
    "cf.unavailablePlan": "unavailable on this plan",
    "cf.respectOrigin": "respect origin headers",
    "cf.querying": "Querying Cloudflare…",
    "cf.queryFailed": "query failed",
    "cf.colo": "Colo",
    "cf.fromCache": "From cache",
    "cf.toOrigin": "To origin",
    "cf.cacheStatus": "Cache status",
    "cf.requests": "Requests",
    "cf.share": "Share",
    "cf.edgeBytes": "Edge bytes",
    "cf.edgeNote":
      "{colos} colos served `{path}` in the last {hours}h — {hits} from cache, " +
      "{misses} not. Edges that received no request do not appear, even if they " +
      "hold a copy.",
    "cf.zoneNote":
      "Zone-wide cache status over the last {hours}h. Numbers come from " +
      "Cloudflare's sampled dataset: ratios are reliable, absolute counts are " +
      "estimates.",
    "cf.suggest.title": "Cloudflare is not connected.",
    "cf.suggest.body":
      "The cache above is the origin cache; the copy your visitors actually get " +
      "is at the edge. Connecting a zone lets a purge here reach both, and " +
      "shows the cache hit ratio that decides whether the origin cache is even " +
      "being asked.",
    "cf.suggest.hint":
      "Token permissions: <code>Zone.Cache Purge</code> to purge, " +
      "<code>Zone.Zone Settings</code> to change settings, " +
      "<code>Zone.Analytics</code> (read) for the hit ratio. The token is read " +
      "from the environment and never leaves the server.",
    "cf.rowPurge": "cf purge",
    "cf.rowPurgeTitle": "Purge this URL at Cloudflare",

    /* --- host --- */
    "host.section": "Host",
    "host.memory": "Memory",
    "host.disk": "Disk",
    "host.noStats": "This platform does not report filesystem stats.",
    "host.ramShared": "This process: {rss} RSS.",
    "host.ramOnly": "This process holds the whole cache: {rss} RSS, {html} of it HTML.",
    "host.diskNote": "{free} free on {path} — build output and logs live here.",

    /* --- işlemler --- */
    "actions.section": "Actions",
    "actions.target.placeholder": "/news/:slug  ·  /news/some-post  ·  invalidation target",
    "actions.hard": "hard (delete instead of marking stale)",
    "actions.invalidate": "Invalidate",
    "actions.prefix.placeholder": "data key prefix — empty clears every data entry",
    "actions.clearData": "Clear data cache",
    "actions.clearHtml": "Clear HTML cache",
    "actions.prewarm": "Prewarm all paths",
    "actions.hint":
      "Invalidation marks entries stale by default: visitors keep getting the " +
      "old HTML while a single background refresh runs. Hard mode deletes them, " +
      "so the next visitor waits for a cold render.",

    /* --- girdiler --- */
    "tab.data": "Data",
    "entries.section": "Entries",
    "entries.search": "Filter by key",
    "entries.empty": "No entries.",
    "entries.shownPartial": "{shown} of {total} shown",
    "entries.shown": "{total} shown",
    "entries.key": "Key",
    "entries.state": "State",
    "entries.size": "Size",
    "entries.status": "Status",
    "entries.expires": "Expires",
    "entries.deps": "Deps",
    "entries.encodings": "Encodings",
    "entries.fresh": "fresh",
    "entries.stale": "stale",
    "entries.drop": "drop",
    "entries.copyKey": "Copy key",

    /* --- alt bilgi --- */
    "footer.panel": "Cache panel",
    "footer.rotates": "Password rotates on restart",

    /* --- bildirimler --- */
    "toast.keyCopied": "Key copied",
    "toast.clipboard": "Clipboard is unavailable — key moved to the prefix field",
    "toast.needTarget": "Enter a path or pattern first.",
    "toast.needValue": "Enter at least one value.",
    "toast.noCachedPages": "No cached pages to purge.",
    "toast.failed": "Failed",
    "toast.done": "Done",
    "confirm.clearHtml": "Clear the entire HTML cache? Every page goes cold.",
    "confirm.clearData": "Clear every data entry? Upstream traffic will spike.",
    "confirm.purgeAll": "Purge the entire Cloudflare cache for this zone?",
    "confirm.purgeUrls": "Purge {count} URLs at Cloudflare?",
    "confirm.clearReserve":
      "Clear Cache Reserve? Cloudflare will refetch everything from the origin.",

    /* --- sunucu cevapları --- */
    "msg.html.cleared": "HTML cache cleared ({count} entries)",
    "msg.data.cleared": "Data cache cleared ({count} entries)",
    "msg.data.clearedPrefix": "{count} data entries dropped under `{prefix}`",
    "msg.target.invalid": "Target must start with `/`",
    "msg.html.marked": "{count} entries marked stale for `{target}`",
    "msg.html.dropped": "{count} entries dropped for `{target}`",
    "msg.key.missing": "Missing key",
    "msg.entry.dropped": "Dropped `{key}`",
    "msg.entry.absent": "`{key}` was not cached",
    "msg.redis.unreachable": "Redis is not reachable",
    "msg.redis.notConnected": "Redis is not connected",
    "msg.redis.htmlKeys": "{count} html keys",
    "msg.redis.dataKeys": "{count} data keys",
    "msg.redis.dbKeys": "{count} keys in db",
    "msg.redis.memory": "{value} used",
    "msg.redis.droppedHtml": "{count} shared html keys dropped",
    "msg.redis.droppedData": "{count} shared data keys dropped",
    "msg.cf.purgedEverything": "Cloudflare cache purged (everything)",
    "msg.cf.noPaths": "No paths given",
    "msg.cf.noHostname": "Could not build absolute URLs — set cache().cloudflare.hostname",
    "msg.cf.purgedUrls": "Purged {count} URLs at Cloudflare in {batches} request(s)",
    "msg.cf.nothingToPurge": "Nothing to purge",
    "msg.cf.purgedKeys": "Purged {count} {kind} at Cloudflare",
    "msg.cf.settingChanged": "Cloudflare {id} is now {value}",
    "msg.cf.featureChanged": "Cloudflare {feature} turned {value}",
    "msg.cf.reserveClearing":
      "Cache Reserve clear started — it runs asynchronously at Cloudflare",
    "msg.cf.failed": "Cloudflare: {error}",
    "msg.prewarm.busy": "A prewarm round is already running",
    "msg.prewarm.paths": "Prewarming {count} paths",
    "msg.prewarm.all": "Prewarming all paths",
    "msg.action.unknown": "Unknown action: {type}",

    /* --- giriş --- */
    "login.title": "Cache panel",
    "login.lead": "This run's password is printed in the server log (<code>[cache-panel]</code>).",
    "login.placeholder": "32-character password",
    "login.submit": "Unlock",
    "login.hint": "Three failed attempts block this address for 24 hours.",
    "login.tooMany": "Too many attempts.",
    "login.invalid": "Invalid password.",

    /* --- birimler --- */
    "unit.second": "s",
    "unit.minute": "m",
    "unit.hour": "h",
    "unit.day": "d",
    "unit.ms": "ms",
  },

  tr: {
    "nav.cache": "Önbellek",
    "shell.live": "canlı",
    "shell.refresh": "Yenile",
    "shell.signOut": "Çıkış",
    "shell.language": "Dil",
    "chip.up": "{value} açık",

    "card.htmlEntries": "HTML girdisi",
    "card.htmlMemory": "Bellekteki HTML",
    "card.dataEntries": "Veri girdisi",
    "card.sharedTier": "Paylaşımlı kademe",
    "card.prewarm": "Isıtma",
    "card.limit": "sınır {count}",
    "card.stale": "{count} bayat",
    "card.staleAndLimit": "{stale} bayat · sınır {limit}",

    "state.on": "açık",
    "state.off": "kapalı",
    "state.bypassed": "devre dışı",
    "state.connected": "bağlı",
    "state.disconnected": "bağlantı yok",
    "state.notConfigured": "yapılandırılmadı",
    "state.idle": "boşta",
    "state.yes": "evet",
    "state.no": "hayır",
    "state.none": "yok",
    "state.default": "varsayılan",
    "state.unavailable": "okunamıyor",

    "prewarm.inProgress": "tur sürüyor",
    "prewarm.lastRound": "son tur: {done}/{total}",
    "prewarm.never": "henüz tur yok",

    "redis.section": "Paylaşımlı kademe",
    "redis.sub": "{address} · {errors} hata",
    "redis.disabled": "cache.redis.enabled kapalı",
    "redis.inspect": "Redis'teki anahtarları say",
    "redis.dropHtml": "Paylaşımlı HTML anahtarlarını düşür",
    "redis.dropData": "Paylaşımlı veri anahtarlarını düşür",
    "redis.connection": "Bağlantı",
    "redis.address": "Adres",
    "redis.database": "Veritabanı",
    "redis.keyPrefix": "Anahtar öneki",
    "redis.buildId": "Build kimliği",
    "redis.sharesHtml": "HTML paylaşımı",
    "redis.sharesData": "Veri paylaşımı",
    "redis.compressed": "Sıkıştırılmış gövdeler",
    "redis.compressed.shared": "paylaşılıyor",
    "redis.compressed.local": "yalnızca yerel",
    "redis.broadcast": "Purge yayını",
    "redis.broadcast.subscribed": "abone",
    "redis.broadcast.publish": "yalnızca yayın",
    "redis.broadcast.local": "yalnızca yerel",
    "redis.timeout": "Komut zaman aşımı",
    "redis.errors": "Komut hatası",
    "redis.tier": "Kademe",
    "redis.tier.inProcess": "yalnızca süreç içi",
    "redis.replicas": "Bu önbelleği paylaşan kopya",
    "redis.suggest.title": "Paylaşımlı kademe yok.",
    "redis.suggest.body":
      "Yukarıdaki her girdi yalnızca bu süreçte yaşıyor: her kopya kendi başına " +
      "ısınıyor ve bir invalidation yalnızca isteği alan kopyaya ulaşıyor. " +
      "Redis eklendiğinde süreç içi önbellek birincil kalır; Redis yalnızca tek " +
      "bir sürecin yapamayacağını yapar — başka bir kopyanın render ettiği " +
      "HTML'i servis etmek ve purge'ü hepsine duyurmak.",
    "redis.suggest.hint":
      "İkinci kopyadan itibaren değer üretir. Tek instance'ta kazanç sıfıra " +
      "yakın; varsayılan olarak kapalı olmasının sebebi bu.",

    "cf.section": "Cloudflare",
    "cf.refresh": "Yenile",
    "cf.notConnected": "bağlı değil",
    "cf.error": "hata: {error}",
    "cf.purgeAll": "Her şeyi düşür",
    "cf.purgeCached": "Buradaki URL'leri düşür",
    "cf.devMode": "development mode (3 saat cache baypası)",
    "cf.kind.prefixes": "prefix",
    "cf.kind.hosts": "host",
    "cf.kind.tags": "cache tag",
    "cf.values.placeholder":
      "example.com/haber  ·  boşluk ya da virgülle, istek başına 100 tane",
    "cf.purge": "Düşür",
    "cf.toggleTiered": "Tiered Cache'i çevir",
    "cf.toggleReserve": "Cache Reserve'ü çevir",
    "cf.clearReserve": "Cache Reserve'ü boşalt",
    "cf.path.placeholder":
      "/haber/bir-yazi — bu yolu hangi edge'ler servis etti (boş = tüm zone)",
    "cf.queryAnalytics": "Analitiği sorgula",
    "cf.edgeHint":
      "Cloudflare'de bir URL'in kopyasının şu an hangi edge'lerde durduğunu " +
      "veren bir uç yok; seçtiğin bir edge'i origin'den ısıtmanın da yolu yok — " +
      "bir obje o koloya yönlenen gerçek bir istekle cache'e giriyor. " +
      "Yukarıdaki sayılar gözlem: hangi kolo yolu cache'ten, hangisi origin'den " +
      "servis etti. Isıtmanın karşılığı bizim prewarm turumuz ve arkasındaki " +
      "Tiered Cache ya da Cache Reserve.",
    "cf.zone": "Zone",
    "cf.plan": "Plan",
    "cf.token": "Token",
    "cf.token.env": "ortamdan",
    "cf.token.config": "config'ten",
    "cf.devModeLabel": "Development mode",
    "cf.devMode.on": "açık · {time} kaldı",
    "cf.cacheLevel": "Cache level",
    "cf.browserTtl": "Tarayıcı cache TTL",
    "cf.edgeTtl": "Edge cache TTL",
    "cf.sortQuery": "Query string sıralaması",
    "cf.alwaysOnline": "Always Online",
    "cf.tiered": "Tiered Cache",
    "cf.regionalTiered": "Regional Tiered Cache",
    "cf.reserve": "Cache Reserve",
    "cf.unavailablePlan": "bu planda yok",
    "cf.respectOrigin": "origin başlıklarına uy",
    "cf.querying": "Cloudflare sorgulanıyor…",
    "cf.queryFailed": "sorgu başarısız",
    "cf.colo": "Kolo",
    "cf.fromCache": "Cache'ten",
    "cf.toOrigin": "Origin'e",
    "cf.cacheStatus": "Cache durumu",
    "cf.requests": "İstek",
    "cf.share": "Pay",
    "cf.edgeBytes": "Edge baytı",
    "cf.edgeNote":
      "Son {hours} saatte `{path}` yolunu {colos} kolo servis etti — {hits} " +
      "cache'ten, {misses} değil. Hiç istek almamış bir edge, kopyası olsa da " +
      "listede görünmez.",
    "cf.zoneNote":
      "Son {hours} saatte zone genelinde cache durumu. Sayılar Cloudflare'in " +
      "örneklemeli veri kümesinden: oranlar güvenilir, mutlak sayılar yaklaşık.",
    "cf.suggest.title": "Cloudflare bağlı değil.",
    "cf.suggest.body":
      "Yukarıdaki önbellek origin önbelleği; ziyaretçinin gerçekten aldığı kopya " +
      "edge'de duruyor. Bir zone bağlandığında buradan yapılan purge ikisine de " +
      "ulaşır ve origin önbelleğine hiç sorulup sorulmadığını belirleyen cache " +
      "isabet oranı görünür.",
    "cf.suggest.hint":
      "Token izinleri: purge için <code>Zone.Cache Purge</code>, ayarlar için " +
      "<code>Zone.Zone Settings</code>, isabet oranı için " +
      "<code>Zone.Analytics</code> (salt okunur). Token ortamdan okunuyor ve " +
      "sunucudan hiç çıkmıyor.",
    "cf.rowPurge": "cf düşür",
    "cf.rowPurgeTitle": "Bu URL'i Cloudflare'de düşür",

    "host.section": "Makine",
    "host.memory": "Bellek",
    "host.disk": "Disk",
    "host.noStats": "Bu platform dosya sistemi bilgisi vermiyor.",
    "host.ramShared": "Bu süreç: {rss} RSS.",
    "host.ramOnly": "Önbelleğin tamamı bu süreçte: {rss} RSS, {html} kadarı HTML.",
    "host.diskNote": "{path} üzerinde {free} boş — build çıktısı ve loglar burada.",

    "actions.section": "İşlemler",
    "actions.target.placeholder": "/haber/:slug  ·  /haber/bir-yazi  ·  invalidation hedefi",
    "actions.hard": "hard (bayat işaretlemek yerine sil)",
    "actions.invalidate": "Invalidate",
    "actions.prefix.placeholder": "veri anahtarı öneki — boş bırakılırsa tüm veri girdileri",
    "actions.clearData": "Veri önbelleğini boşalt",
    "actions.clearHtml": "HTML önbelleğini boşalt",
    "actions.prewarm": "Bütün yolları ısıt",
    "actions.hint":
      "Invalidation varsayılan olarak girdileri bayat işaretler: arkada tek bir " +
      "tazeleme koşarken ziyaretçiler eski HTML'i almaya devam eder. Hard mod " +
      "girdiyi siler, yani sıradaki ziyaretçi soğuk render'ı bekler.",

    "tab.data": "Veri",
    "entries.section": "Girdiler",
    "entries.search": "Anahtara göre filtrele",
    "entries.empty": "Girdi yok.",
    "entries.shownPartial": "{total} eşleşmenin {shown} tanesi",
    "entries.shown": "{total} eşleşme",
    "entries.key": "Anahtar",
    "entries.state": "Durum",
    "entries.size": "Boyut",
    "entries.status": "Kod",
    "entries.expires": "Kalan",
    "entries.deps": "Bağımlılık",
    "entries.encodings": "Kodlamalar",
    "entries.fresh": "taze",
    "entries.stale": "bayat",
    "entries.drop": "düşür",
    "entries.copyKey": "Anahtarı kopyala",

    "footer.panel": "Önbellek paneli",
    "footer.rotates": "Şifre her restart'ta değişir",

    "toast.keyCopied": "Anahtar kopyalandı",
    "toast.clipboard": "Pano kullanılamıyor — anahtar önek alanına taşındı",
    "toast.needTarget": "Önce bir yol ya da desen gir.",
    "toast.needValue": "En az bir değer gir.",
    "toast.noCachedPages": "Düşürülecek önbelleklenmiş sayfa yok.",
    "toast.failed": "Başarısız",
    "toast.done": "Tamam",
    "confirm.clearHtml": "Bütün HTML önbelleği boşaltılsın mı? Her sayfa soğur.",
    "confirm.clearData": "Bütün veri girdileri silinsin mi? Upstream trafiği sıçrar.",
    "confirm.purgeAll": "Bu zone'un Cloudflare önbelleğinin tamamı düşürülsün mü?",
    "confirm.purgeUrls": "{count} URL Cloudflare'de düşürülsün mü?",
    "confirm.clearReserve":
      "Cache Reserve boşaltılsın mı? Cloudflare her şeyi origin'den yeniden çeker.",

    "msg.html.cleared": "HTML önbelleği boşaltıldı ({count} girdi)",
    "msg.data.cleared": "Veri önbelleği boşaltıldı ({count} girdi)",
    "msg.data.clearedPrefix": "`{prefix}` altındaki {count} veri girdisi düşürüldü",
    "msg.target.invalid": "Hedef `/` ile başlamalı",
    "msg.html.marked": "`{target}` için {count} girdi bayat işaretlendi",
    "msg.html.dropped": "`{target}` için {count} girdi silindi",
    "msg.key.missing": "Anahtar eksik",
    "msg.entry.dropped": "`{key}` düşürüldü",
    "msg.entry.absent": "`{key}` önbellekte değildi",
    "msg.redis.unreachable": "Redis'e ulaşılamıyor",
    "msg.redis.notConnected": "Redis bağlı değil",
    "msg.redis.htmlKeys": "{count} html anahtarı",
    "msg.redis.dataKeys": "{count} veri anahtarı",
    "msg.redis.dbKeys": "veritabanında {count} anahtar",
    "msg.redis.memory": "{value} kullanımda",
    "msg.redis.droppedHtml": "{count} paylaşımlı html anahtarı düşürüldü",
    "msg.redis.droppedData": "{count} paylaşımlı veri anahtarı düşürüldü",
    "msg.cf.purgedEverything": "Cloudflare önbelleği düşürüldü (her şey)",
    "msg.cf.noPaths": "Yol verilmedi",
    "msg.cf.noHostname": "Tam URL kurulamadı — cache().cloudflare.hostname ayarla",
    "msg.cf.purgedUrls": "{batches} istekte {count} URL Cloudflare'de düşürüldü",
    "msg.cf.nothingToPurge": "Düşürülecek bir şey yok",
    "msg.cf.purgedKeys": "{count} {kind} Cloudflare'de düşürüldü",
    "msg.cf.settingChanged": "Cloudflare {id} artık {value}",
    "msg.cf.featureChanged": "Cloudflare {feature} {value} yapıldı",
    "msg.cf.reserveClearing":
      "Cache Reserve boşaltması başladı — Cloudflare'de arkada koşuyor",
    "msg.cf.failed": "Cloudflare: {error}",
    "msg.prewarm.busy": "Zaten bir ısıtma turu koşuyor",
    "msg.prewarm.paths": "{count} yol ısıtılıyor",
    "msg.prewarm.all": "Bütün yollar ısıtılıyor",
    "msg.action.unknown": "Bilinmeyen işlem: {type}",

    "login.title": "Önbellek paneli",
    "login.lead": "Bu turun şifresi sunucu logunda (<code>[cache-panel]</code>).",
    "login.placeholder": "32 haneli şifre",
    "login.submit": "Aç",
    "login.hint": "Üç başarısız deneme bu adresi 24 saat engeller.",
    "login.tooMany": "Çok fazla deneme.",
    "login.invalid": "Şifre geçersiz.",

    "unit.second": "sn",
    "unit.minute": "dk",
    "unit.hour": "sa",
    "unit.day": "g",
    "unit.ms": "ms",
  },
};

export const LANGUAGES = /** @type {const} */ (["en", "tr"]);

/** @type {Record<string, string>} */
export const LANGUAGE_NAMES = { en: "English", tr: "Türkçe" };

/**
 * Kayıtlı tercih yoksa tarayıcının diline bakılır: paneli Türkçe bir makinede
 * açan biri için varsayılanın İngilizce olmasının bir gerekçesi yok.
 *
 * @returns {string}
 */
function detect() {
  // Tamamı korumalı: panel `file://` üzerinden ya da sıkı bir gizlilik
  // kipinde açılmış olabilir, ve bu modül testlerde tarayıcı dışında da
  // import ediliyor.
  // `document` kontrolü tarayıcı dışında `localStorage`'a hiç dokunmamak için:
  // Node'da bu global'i okumak uyarı basıyor.
  try {
    if (typeof document !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && MESSAGES[stored]) return stored;
    }
  } catch {
    // Depolama yoksa tercih bu sekmeye özel kalır.
  }

  try {
    const preferred = navigator.languages ?? [navigator.language];
    for (const tag of preferred) {
      const base = String(tag ?? "").toLowerCase().split("-")[0];
      if (MESSAGES[base]) return base;
    }
  } catch {
    // Tarayıcı dışında `navigator` yok.
  }

  return "en";
}

let current = detect();

/** @returns {string} */
export function getLanguage() {
  return current;
}

/**
 * @param {string} language
 */
export function setLanguage(language) {
  if (!MESSAGES[language]) return;
  current = language;

  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Yazamıyorsak seçim yalnızca bu sekme için geçerli olur.
  }

  document.documentElement.lang = language;
}

/**
 * Çeviri. Eksik anahtar **İngilizceye düşer**, o da yoksa anahtarın kendisi
 * döner: yarım çevrilmiş bir sözlük paneli boş etiketlerle bırakmasın.
 *
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 * @returns {string}
 */
export function t(key, params) {
  const template = MESSAGES[current]?.[key] ?? MESSAGES.en[key] ?? key;
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * `data-i18n` taşıyan her düğümü çevirir.
 *
 * Üç öznitelik var: `data-i18n` metni, `data-i18n-ph` placeholder'ı,
 * `data-i18n-html` ise içinde `<code>` geçen açıklama metinlerini yazar —
 * kaynağı sözlüğün kendisi olduğu için sabit metin, kullanıcı verisi değil.
 *
 * @param {ParentNode} [root]
 */
export function applyTranslations(root = document) {
  document.documentElement.lang = current;

  for (const node of root.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.getAttribute("data-i18n") ?? "");
  }

  for (const node of root.querySelectorAll("[data-i18n-html]")) {
    node.innerHTML = t(node.getAttribute("data-i18n-html") ?? "");
  }

  for (const node of root.querySelectorAll("[data-i18n-ph]")) {
    node.setAttribute("placeholder", t(node.getAttribute("data-i18n-ph") ?? ""));
  }

  for (const node of root.querySelectorAll("[data-i18n-title]")) {
    node.setAttribute("title", t(node.getAttribute("data-i18n-title") ?? ""));
  }
}

/**
 * Header'daki dil seçici. Çevirisi olan diller sözlükten geliyor, yani üçüncü
 * bir dil eklemek yalnızca `MESSAGES`'a bir giriş demek.
 *
 * @param {(language: string) => void} onChange
 * @returns {HTMLSelectElement}
 */
export function languageSelect(onChange) {
  const select = document.createElement("select");
  select.className = "lang";
  select.setAttribute("aria-label", t("shell.language"));

  for (const language of LANGUAGES) {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = LANGUAGE_NAMES[language];
    option.selected = language === current;
    select.append(option);
  }

  select.addEventListener("change", () => {
    setLanguage(select.value);
    select.setAttribute("aria-label", t("shell.language"));
    onChange(select.value);
  });

  return select;
}
