/**
 * Kontrolü başlatır. Beklenmez; sonuç geldiğinde `versionStatus()` günceldir.
 * `JSKELET_VERSION_CHECK=0` ile tamamen kapatılabilir (çevrimdışı çalışma,
 * kurumsal ağlar).
 */
export declare function startVersionCheck(): void;
/**
 * @returns {{ current: string, latest: string | null, outdated: boolean, checkedAt: number | null }}
 */
export declare function versionStatus(): {
    current: string;
    latest: string | null;
    outdated: boolean;
    checkedAt: number | null;
};
