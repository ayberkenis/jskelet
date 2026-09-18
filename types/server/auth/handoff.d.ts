/**
 * Handoff uçlarını mount eder. `auth.crossSubdomainHandoff` kapalıysa no-op.
 * create-app CSRF'den *sonra* çağırmalıdır.
 *
 * @param {import('express').Express} app
 * @returns {void}
 */
export declare function mountAuthHandoff(app: import('express').Express): void;
/** @returns {void} */
export declare function _resetHandoffTickets(): void;
/** @returns {number} */
export declare function _handoffTicketCount(): number;
