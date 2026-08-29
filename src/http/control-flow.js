/**
 * `next/navigation` içindeki notFound/redirect kontrol akışının karşılığı.
 * Derinlerdeki bir fonksiyon throw eder, Express error handler yakalar.
 */

export class NotFoundError extends Error {
  constructor(message = "Not Found") {
    super(message);
    this.name = "NotFoundError";
    this.statusCode = 404;
  }
}

export class RedirectError extends Error {
  /**
   * @param {string} location
   * @param {301 | 302 | 307 | 308} [statusCode]
   */
  constructor(location, statusCode = 307) {
    super(`Redirect to ${location}`);
    this.name = "RedirectError";
    this.location = location;
    this.statusCode = statusCode;
  }
}

/** @returns {never} */
export function notFound() {
  throw new NotFoundError();
}

/**
 * @param {string} location
 * @returns {never}
 */
export function permanentRedirect(location) {
  throw new RedirectError(location, 308);
}

/**
 * @param {string} location
 * @returns {never}
 */
export function redirect(location) {
  throw new RedirectError(location, 307);
}

/** @param {unknown} error */
export function isNotFoundError(error) {
  return error instanceof NotFoundError;
}

/** @param {unknown} error */
export function isRedirectError(error) {
  return error instanceof RedirectError;
}
