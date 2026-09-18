export type Metadata = {
    title?: string;
    /**
     * `"%s | Site"` — `title` buna gömülür.
     */
    titleTemplate?: string;
    description?: string;
    /**
     * Mutlak ya da göreli URL.
     */
    canonical?: string;
    /**
     * Göreli canonical'ı mutlaklaştırmak için.
     */
    siteUrl?: string;
    robots?: {
        index?: boolean;
        follow?: boolean;
    };
    locale?: string;
    /**
     * `{ title, description, url, type, siteName, image, imageWidth, imageHeight }`
     */
    openGraph?: object;
    /**
     * `{ card, site, creator, title, description, image }`
     */
    twitter?: object;
    /**
     * Olduğu gibi basılacak ham etiketler.
     */
    extraTags?: string[];
};
/**
 * @param {Metadata} [metadata]
 * @returns {string}
 */
export declare function renderHeadMeta(metadata?: Metadata): string;
