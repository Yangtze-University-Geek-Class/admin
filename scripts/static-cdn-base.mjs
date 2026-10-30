// 静态资源 CDN 开关（#146）的唯一解析点：app/web、app/console 的 Vite 配置，app/forum 的 Nuxt 配置，
// 上传脚本 scripts/static-cdn.mjs 与测试都从这里取值，不各写一份。
//
// 源站不写在代码里（#360）：它是环境变量 STATIC_CDN_ORIGIN，值来自 deploy/env/.env.*（三份相同），
// 由 staticCdnOrigin() 读取并核对；缺了或不是 https 源就抛错，不回退到任何写死的地址。
// 开关是一个构建环境变量 STATIC_CDN_BASE：
//   空（默认）          → 与今天一样，带哈希的 JS/CSS/图片都从本站同源加载；
//   非空                → 必须逐字等于 `${STATIC_CDN_ORIGIN}/yzgc/static/site/`，带哈希的文件从 CDN 加载，
//                         HTML、接口和不带哈希的文件仍走源站。
// 宿主 nginx 的 CSP（deploy/nginx/*.conf）是另一份策略源，不由这里生成。
//
// 公开地址是七牛把域名绑定到桶之后的地址：origin + 对象键，路径里没有桶名（#346；此前是 Garage 的 path-style 地址）。
// 上传走七牛的 S3 兼容端点，桶名只出现在签名请求的路径里，见 static-cdn-s3.mjs。
//
// 源站路径与 CDN 对象一一对应：源站 /X ↔ 桶里的 yzgc/static/site/X。预发布与正式共用这个前缀：
// 文件名里带内容哈希，内容相同键就相同，谁先上传都一样。

export const STATIC_CDN_S3_ENDPOINT = "https://s3.cn-south-1.qiniucs.com";
// 桶名不入库：桶名里带所有者的个人标识，只放在 GitHub 环境变量 STATIC_CDN_S3_BUCKET 里（#346、#349）；这里只核对形状。
export const S3_BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
/** 项目在桶里的对象命名空间：旧七牛对象（静态、宣传片、邮件图片）都在 yzgc/ 下。 */
export const STATIC_CDN_NAMESPACE = "yzgc/";
export const STATIC_CDN_PREFIX = "yzgc/static/site/";

/**
 * 读 STATIC_CDN_ORIGIN：必须是 https 源（不带路径、尾斜杠、查询和用户信息）。缺失或不合法就抛错，错误信息不回显值。
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function staticCdnOrigin(env = process.env) {
  const value = (env.STATIC_CDN_ORIGIN ?? "").trim();
  if (!value) throw new Error("STATIC_CDN_ORIGIN 未设置：静态资源 CDN 的源站必须来自环境文件（deploy/env/.env.*）");
  let url;
  try { url = new URL(value); } catch { throw new Error("STATIC_CDN_ORIGIN 不是合法地址"); }
  if (url.protocol !== "https:" || url.origin !== value) throw new Error("STATIC_CDN_ORIGIN 必须是 https 源（不带路径、尾斜杠、查询和用户信息）");
  return value;
}

/**
 * CDN 对象的公开地址前缀：`${STATIC_CDN_ORIGIN}/yzgc/static/site/`。上传、核对与生成清单的脚本必须有它，缺值直接抛错。
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function staticCdnPrefixURL(env = process.env) {
  return `${staticCdnOrigin(env)}/${STATIC_CDN_PREFIX}`;
}

/**
 * 读构建环境里的 STATIC_CDN_BASE。空或未设置返回空串（同源）；
 * 非空时必须逐字等于 staticCdnPrefixURL(env)，否则直接抛错，不带着一个 CSP 不认的地址构建。
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function staticCdnBase(env = process.env) {
  const value = (env.STATIC_CDN_BASE ?? "").trim();
  if (!value) return "";
  if (value !== staticCdnPrefixURL(env)) {
    throw new Error("STATIC_CDN_BASE 只能为空或 STATIC_CDN_ORIGIN 派生的 yzgc/static/site/ 地址");
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
