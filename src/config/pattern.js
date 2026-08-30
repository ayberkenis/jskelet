/**
 * `next.config` `source`/`destination` sözdiziminin küçük bir derleyicisi.
 *
 * Desteklenen biçimler:
 *   `/haber/:slug`      → tek segment yakalar
 *   `/:path*`           → sıfır veya daha fazla segment yakalar
 *   `/:path*.svg`       → joker + sabit son ek (uzantı kuralları böyle yazılır)
 *   `/etiket-:slug`     → segment ortasında parametre
 *
 * Yakalanan değerler `destination` içindeki aynı adlı `:param`'lara yazılır.
 * Next'in tam `path-to-regexp` yüzeyi değil; config'te fiilen kullanılan alt
 * küme bilinçli olarak seçildi ve tanınmayan bir sözdizimi sessizce literal
 * kabul edilmez, uyarı üretir.
 */

/** @typedef {{ regex: RegExp, keys: string[], source: string }} CompiledPattern */

const PARAM = /^:([A-Za-z_][A-Za-z0-9_]*)(\*)?/;

/** @param {string} text */
function escapeLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} source
 * @returns {CompiledPattern | null}
 */
export function compilePattern(source) {
  if (typeof source !== "string" || !source.startsWith("/")) {
    console.warn(`[config] invalid source (must start with \`/\`): ${source}`);
    return null;
  }

  /** @type {string[]} */
  const keys = [];
  let pattern = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char !== ":") {
      pattern += escapeLiteral(char);
      index += 1;
      continue;
    }

    const match = source.slice(index).match(PARAM);
    if (!match) {
      pattern += escapeLiteral(char);
      index += 1;
      continue;
    }

    const [raw, name, wildcard] = match;
    keys.push(name);

    if (!wildcard) {
      // Tek segmentli parametre segment sınırını aşmaz.
      pattern += "([^/]+)";
      index += raw.length;
      continue;
    }

    // Joker parametre segment sınırlarını aşar ve **sıfır** segment de
    // yakalar: `/hesabim/:path*` kuralı `/hesabim`i de kapsamalı, aksi hâlde
    // bir bölümün tamamını kapatmak isteyen kural kök yolu atlıyor. Bunun için
    // hemen öncesindeki `/` de opsiyonele alınır.
    const trailingSlash = pattern.endsWith("/");
    pattern = trailingSlash ? `${pattern.slice(0, -1)}(?:/(.*))?` : `${pattern}(.*)`;
    index += raw.length;
  }

  return { regex: new RegExp(`^${pattern}$`), keys, source };
}

/**
 * @param {CompiledPattern} compiled
 * @param {string} pathname
 * @returns {Record<string, string> | null}
 */
export function matchPattern(compiled, pathname) {
  const match = compiled.regex.exec(pathname);
  if (!match) return null;

  /** @type {Record<string, string>} */
  const params = {};
  compiled.keys.forEach((key, i) => {
    params[key] = match[i + 1] ?? "";
  });
  return params;
}

/**
 * `destination` içindeki `:param` yer tutucularını doldurur.
 *
 * @param {string} destination
 * @param {Record<string, string>} params
 * @returns {string}
 */
export function fillDestination(destination, params) {
  return destination.replace(
    /:([A-Za-z_][A-Za-z0-9_]*)(\*)?/g,
    (raw, name) => params[name] ?? raw,
  );
}
