export type AwsCredentials = {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string | null;
};
/**
 * @returns {AwsCredentials | null}
 */
export declare function readS3CredentialsFromEnv(): AwsCredentials | null;
/**
 * ECS task role / container credential provider.
 *
 * @returns {Promise<AwsCredentials | null>}
 */
export declare function readS3CredentialsFromEcs(): Promise<AwsCredentials | null>;
/**
 * EC2 instance profile via IMDSv2 (IMDSv1'e düşmez).
 *
 * @returns {Promise<AwsCredentials | null>}
 */
export declare function readS3CredentialsFromImds(): Promise<AwsCredentials | null>;
/**
 * Credential neden bulunamadı — upload skip satırı için.
 *
 * @returns {string}
 */
export declare function s3CredentialsMissingReason(): string;
/**
 * Env → ECS task role → EC2 instance profile.
 *
 * @returns {Promise<AwsCredentials | null>}
 */
export declare function resolveS3Credentials(): Promise<AwsCredentials | null>;
