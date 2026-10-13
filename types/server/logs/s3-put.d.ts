export type AwsCredentials = {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string | null;
};
export type PutObjectInput = {
    bucket: string;
    key: string;
    body: string | Buffer;
    region: string;
    endpoint?: string | null;
    credentials: AwsCredentials;
    contentType?: string;
    cacheControl?: string | null;
    now?: Date;
};
export type PutBucketCorsInput = {
    bucket: string;
    region: string;
    endpoint?: string | null;
    credentials: AwsCredentials;
    allowedOrigin: string;
    now?: Date;
};
/**
 * @param {string | Buffer} data
 * @returns {string}
 */
export declare function sha256Hex(data: string | Buffer): string;
/**
 * @param {Date} date
 * @returns {{ amzDate: string, dateStamp: string }}
 */
export declare function formatAmzDates(date: Date): {
    amzDate: string;
    dateStamp: string;
};
/**
 * @param {string} secretAccessKey
 * @param {string} dateStamp
 * @param {string} region
 * @param {string} service
 * @returns {Buffer}
 */
export declare function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer;
/**
 * @param {{ method: string, canonicalUri: string, canonicalQuerystring?: string,
 *   headers: Record<string, string>, payloadHash: string }} parts
 * @returns {{ canonicalRequest: string, signedHeaders: string }}
 */
export declare function buildCanonicalRequest(parts: {
    method: string;
    canonicalUri: string;
    canonicalQuerystring?: string;
    headers: Record<string, string>;
    payloadHash: string;
}): {
    canonicalRequest: string;
    signedHeaders: string;
};
/**
 * @param {{ amzDate: string, dateStamp: string, region: string, service: string,
 *   canonicalRequest: string }} parts
 * @returns {string}
 */
export declare function buildStringToSign(parts: {
    amzDate: string;
    dateStamp: string;
    region: string;
    service: string;
    canonicalRequest: string;
}): string;
/**
 * URI path encode (S3 key segment'leri). `/` korunur.
 *
 * @param {string} value
 * @returns {string}
 */
export declare function encodeS3Path(value: string): string;
/**
 * Virtual-hosted (`bucket.s3.region…`) TLS sertifikası `*.s3.region…` —
 * yalnızca **tek** etiket. `static.investvio.dev` gibi noktalı bucket'lar
 * `Host: static.investvio.dev.s3.…` üretir ve `ERR_TLS_CERT_ALTNAME_INVALID`
 * verir. Path-style (`s3.region…/bucket/key`) bunu çözer.
 *
 * @param {string} bucket
 * @param {string | null | undefined} endpoint
 * @returns {boolean}
 */
export declare function useS3PathStyle(bucket: string, endpoint: string | null | undefined): boolean;
/**
 * PutObject isteğini imzalar; ağ çağrısı yapmaz — test edilebilir olsun diye.
 *
 * @param {PutObjectInput} input
 * @returns {{ url: string, headers: Record<string, string>, body: Buffer }}
 */
export declare function buildSignedPutObject(input: PutObjectInput): {
    url: string;
    headers: Record<string, string>;
    body: Buffer;
};
/**
 * PutBucketCors gövdesi — tek kural, GET/HEAD.
 *
 * @param {string} allowedOrigin
 * @returns {string}
 */
export declare function corsConfigurationXml(allowedOrigin: string): string;
/**
 * PutBucketCors isteğini imzalar (`PUT /?cors` veya path-style `/bucket?cors`).
 *
 * @param {PutBucketCorsInput} input
 * @returns {{ url: string, headers: Record<string, string>, body: Buffer }}
 */
export declare function buildSignedPutBucketCors(input: PutBucketCorsInput): {
    url: string;
    headers: Record<string, string>;
    body: Buffer;
};
/**
 * Bucket CORS yazar. Mevcut kuralların **üzerine** yazar; paylaşımlı
 * kovada bilinçli kullanılmalı. İzin yoksa çağıran uyarır, upload sürer.
 *
 * @param {PutBucketCorsInput} input
 * @returns {Promise<void>}
 */
export declare function putBucketCors(input: PutBucketCorsInput): Promise<void>;
/**
 * @param {PutObjectInput} input
 * @returns {Promise<void>}
 */
export declare function putObject(input: PutObjectInput): Promise<void>;
