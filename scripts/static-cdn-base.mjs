// 静态资源 CDN 开关（#146）的唯一解析点：app/web、app/console 的 Vite 配置，app/forum 的 Nuxt 配置，
// 上传脚本 scripts/static-cdn.mjs 与测试都从这里取值，不各写一份。
//
// 开关是一个构建环境变量 STATIC_CDN_BASE：
//   空（默认）          → 与今天一样，带哈希的 JS/CSS/图片都从本站同源加载；
//   STATIC_CDN_BASE 常量 → 带哈希的文件从 CDN 加载，HTML、接口和不带哈希的文件仍走源站。
// 只接受这一个非空值：CDN 地址同时写在宿主 nginx 的 CSP（deploy/nginx/*.conf）和上传前缀里，
// 三处必须一致，tests/tooling/static-cdn.test.ts 核对。换 CDN 域名要一起改这三处。
//
// 源站路径与 CDN 对象一一对应：源站 /X ↔ 对象 yzgc/static/site/X。预发布与正式共用这个前缀：
// 文件名里带内容哈希，内容相同键就相同，谁先上传都一样。

export const STATIC_CDN_ORIGIN = "https://cdn.crosery.com";
export const STATIC_CDN_BUCKET = "crosery";
export const STATIC_CDN_PREFIX = "yzgc/static/site/";
export const STATIC_CDN_BASE = `${STATIC_CDN_ORIGIN}/${STATIC_CDN_PREFIX}`;

/**
 * 读构建环境里的 STATIC_CDN_BASE。空或未设置返回空串（同源）；
 * 非空时必须逐字等于 STATIC_CDN_BASE，否则直接抛错，不带着一个 CSP 不认的地址构建。
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function staticCdnBase(env = process.env) {
  const value = (env.STATIC_CDN_BASE ?? "").trim();
  if (!value) return "";
  if (value !== STATIC_CDN_BASE) {
    throw new Error(`STATIC_CDN_BASE 只能为空或 ${STATIC_CDN_BASE}，收到 ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Nuxt 的 app.cdnURL：论坛挂在 baseURL（镜像里是 /forum/）下，CDN 上对应 <base>forum/。
 * @param {string} base staticCdnBase() 的返回值（非空）
 * @param {string} baseURL Nuxt app.baseURL，以 / 开头和结尾
 * @returns {string}
 */
export function forumCdnURL(base, baseURL) {
  if (!/^\/(?:[a-z0-9-]+\/)*$/.test(baseURL)) throw new Error(`论坛 baseURL 必须形如 /forum/，收到 ${JSON.stringify(baseURL)}`);
  return `${base}${baseURL.slice(1)}`;
}
