// 静态资源 CDN 开关（#146）的唯一解析点：app/web、app/console 的 Vite 配置，app/forum 的 Nuxt 配置，
// 上传脚本 scripts/static-cdn.mjs 与测试都从这里取值，不各写一份。
//
// 开关是一个构建环境变量 STATIC_CDN_BASE：
//   空（默认）          → 与今天一样，带哈希的 JS/CSS/图片都从本站同源加载；
//   STATIC_CDN_BASE 常量 → 带哈希的文件从 CDN 加载，HTML、接口和不带哈希的文件仍走源站。
// 只接受这一个非空值：CDN 地址同时写在宿主 nginx 的 CSP（deploy/nginx/*.conf）和上传前缀里，
// 三处必须一致，tests/tooling/static-cdn.test.ts 核对。换 CDN 域名要一起改这三处。
//
// 公开地址是七牛把域名绑定到桶之后的地址：origin + 对象键，路径里没有桶名（#346；此前是 Garage 的 path-style 地址）。
// 上传走七牛的 S3 兼容端点，桶名只出现在签名请求的路径里，见 static-cdn-s3.mjs。
//
// 源站路径与 CDN 对象一一对应：源站 /X ↔ 桶里的 yzgc/static/site/X。预发布与正式共用这个前缀：
// 文件名里带内容哈希，内容相同键就相同，谁先上传都一样。

export const STATIC_CDN_ORIGIN = "https://cdn.crosery.com";
export const STATIC_CDN_S3_ENDPOINT = "https://s3.cn-south-1.qiniucs.com";
// 桶名不入库：桶名里带所有者的个人标识，只放在 GitHub 环境变量 STATIC_CDN_S3_BUCKET 里（#346、#349）；这里只核对形状。
export const S3_BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
/** 项目在桶里的对象命名空间：旧七牛对象（静态、宣传片、邮件图片）都在 yzgc/ 下。 */
export const STATIC_CDN_NAMESPACE = "yzgc/";
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
    throw new Error(`STATIC_CDN_BASE 只能为空或 ${STATIC_CDN_BASE}`);
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
