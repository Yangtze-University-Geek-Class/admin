// scripts/static-cdn-base.mjs 的类型声明：app/console 的 vite.config.ts 在 typecheck 范围里。
export declare const STATIC_CDN_ORIGIN: string;
export declare const STATIC_CDN_BUCKET: string;
export declare const STATIC_CDN_PREFIX: string;
export declare const STATIC_CDN_BASE: string;
export declare function staticCdnBase(env?: Record<string, string | undefined>): string;
export declare function forumCdnURL(base: string, baseURL: string): string;
