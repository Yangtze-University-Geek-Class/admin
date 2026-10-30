import { readFileSync } from 'node:fs';

/**
 * 静态资源 CDN 的测试夹具（#360）：源站从 deploy/env/.env.production 读（三份 env 的值相同），测试里不写死域名。
 * 派生的开关值与生产代码相同：`${STATIC_CDN_ORIGIN}/yzgc/static/site/`。
 * 只用正则读一行：vitest 的配置文件也 import 这里，不能拉进带 shebang 的脚本。
 */
const envText = readFileSync(new URL('../deploy/env/.env.production', import.meta.url), 'utf8');
export const STATIC_CDN_ORIGIN = /^STATIC_CDN_ORIGIN=(.+)$/m.exec(envText)?.[1]?.trim() ?? '';
export const STATIC_CDN_BASE = `${STATIC_CDN_ORIGIN}/yzgc/static/site/`;
/** 开关打开时的构建环境：STATIC_CDN_BASE 与派生它的源站一起给。 */
export const CDN_ENV = { STATIC_CDN_ORIGIN, STATIC_CDN_BASE };
