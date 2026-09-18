/**
 * @param {() => typeof import('../../config/defaults.js').DEFAULT_ADMIN} getSettings
 * @param {import('express').Express} app
 * @returns {import('express').Router}
 */
export declare function createAdminRouter(getSettings: () => typeof import('../../config/defaults.js').DEFAULT_ADMIN, app: import('express').Express): import('express').Router;
