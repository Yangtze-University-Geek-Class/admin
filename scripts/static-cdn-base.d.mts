// scripts/static-cdn-base.mjs 的类型声明：app/console 的 vite.config.ts 在 typecheck 范围里。
export declare const STATIC_CDN_S3_ENDPOINT: string;
export declare const S3_BUCKET_RE: RegExp;
export declare const STATIC_CDN_NAMESPACE: string;
export declare const STATIC_CDN_PREFIX: string;
export declare function staticCdnOrigin(env?: Record<string, string | undefined>): string;
export declare function staticCdnPrefixURL(env?: Record<string, string | undefined>): string;
export declare function staticCdnBase(env?: Record<string, string | undefined>): string;
export declare function forumCdnURL(base: string, baseURL: string): string;
