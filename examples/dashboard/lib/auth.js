/**
 * Örneğin kimlik katmanı.
 *
 * Framework kimlik sağlamıyor; verdiği tek şey "bu cookie'yi ben yazdım"
 * garantisi. Gerçek bir uygulamada burada bir kullanıcı tablosu, parola
 * özeti ve oturum kaydı olurdu — sözleşme aynı kalır: `currentUser(req)`
 * ya bir kullanıcı döner ya `null`.
 */
import { clearCookie, getSignedCookie, setSignedCookie } from "jskelet/cookies";

const SESSION_COOKIE = "dash_session";

/** Örnek için sabit kullanıcılar; parolalar bilinçli olarak açık. */
const USERS = new Map([
  ["ayse", { password: "panel123", name: "Ayşe Yılmaz", role: "Yönetici" }],
  ["mert", { password: "panel123", name: "Mert Demir", role: "Operasyon" }],
]);

/**
 * @param {string} username
 * @param {string} password
 * @returns {{ username: string, name: string, role: string } | null}
 */
export function verify(username, password) {
  const user = USERS.get(username);
  if (!user || user.password !== password) return null;

  return { username, name: user.name, role: user.role };
}

/**
 * @param {import('express').Response} res
 * @param {string} username
 */
export function startSession(res, username) {
  setSignedCookie(res, SESSION_COOKIE, username, {
    // Sekme kapanınca oturum bitmesin ama sonsuza kadar da yaşamasın.
    maxAge: 60 * 60 * 8,
    // Panelde çapraz siteden gelen hiçbir gezinme meşru değil.
    sameSite: "Lax",
  });
}

/** @param {import('express').Response} res */
export function endSession(res) {
  clearCookie(res, SESSION_COOKIE);
}

/**
 * Oturumdaki kullanıcı. İmza uymuyorsa `null` — kurcalanmış bir cookie
 * "belki geçerlidir" diye kullanılmaz.
 *
 * Bu çağrı render'ı işaretler (`tainted`): cookie okuyan bir sayfa artık
 * public HTML cache'ine giremez. Panel route'ları zaten `private: true`,
 * ama koruma bayrağı unutulduğunda da devrede.
 *
 * @param {import('express').Request} req
 * @returns {{ username: string, name: string, role: string } | null}
 */
export function currentUser(req) {
  const username = getSignedCookie(req, SESSION_COOKIE);
  if (!username) return null;

  const user = USERS.get(username);
  return user ? { username, name: user.name, role: user.role } : null;
}
