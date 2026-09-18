/**
 * Paylaşımlı cookie Domain seçimi — sunucu ve istemci aynı kuralları kullanır.
 *
 * `brand.sharedCookieRoots` örn. `[".investvio.com", ".localhost"]`.
 * Host bu köklerden birine uyuyorsa Domain olarak o kök yazılır.
 */

/**
 * @param {string} host Host veya Host:port.
 * @returns {string} Lowercase, portsuz.
 */
export function stripHostPort(host) {
  const raw = String(host ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end === -1 ? raw : raw.slice(0, end + 1);
  }
  const colon = raw.lastIndexOf(":");
  if (colon === -1) return raw;
  if (raw.indexOf(":") !== colon) return raw;
  return raw.slice(0, colon);
}

/**
 * Kökü `Domain=` biçimine getirir (başında nokta).
 *
 * @param {unknown} root
 * @returns {string | null}
 */
export function normalizeCookieRoot(root) {
  if (typeof root !== "string") return null;
  const trimmed = root.trim().toLowerCase();
  if (!trimmed || trimmed === ".") return null;
  const bare = trimmed.replace(/^\./, "");
  if (!bare || bare.includes("/") || bare.includes(":")) return null;
  return `.${bare}`;
}

/**
 * @param {string} hostname Portsuz hostname.
 * @param {Iterable<string>} roots `brand.sharedCookieRoots`.
 * @returns {string | null} `Domain` değeri (başında nokta) ya da eşleşme yoksa null.
 */
export function resolveSharedCookieDomain(hostname, roots) {
  const host = stripHostPort(hostname);
  if (!host) return null;

  for (const entry of roots ?? []) {
    const root = normalizeCookieRoot(entry);
    if (!root) continue;
    const bare = root.slice(1);
    if (host === bare || host.endsWith(`.${bare}`)) return root;
  }

  return null;
}

/**
 * Paylaşımlı cookie için önerilen üst sınır. JWT / büyük token buraya
 * sığmaz — kısa session id koyun; aksi halde handoff veya host-only cookie.
 */
export const SHARED_COOKIE_WARN_BYTES = 512;
