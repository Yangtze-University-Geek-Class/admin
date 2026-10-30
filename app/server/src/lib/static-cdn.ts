/**
 * 静态资源 CDN 开关（#146）在服务端的读法（#286、#360）：构建参数 `STATIC_CDN_BASE` 由 Dockerfile 带进运行环境，
 * 源站 `STATIC_CDN_ORIGIN` 来自 deploy/env 的环境文件（由 compose 带进运行环境），代码里不写死任何域名。
 * 规则的唯一来源是仓库根的 `scripts/static-cdn-base.mjs`，镜像里没有 scripts/，所以这里写一份同样的规则，
 * `tests/tooling/static-cdn-parity.test.ts` 逐项核对两边一致。
 */

/** 源站之后的对象键前缀（路径，不是源站）；与 scripts/static-cdn-base.mjs 的 STATIC_CDN_PREFIX 相同。 */
const STATIC_CDN_PATH = "yzgc/static/site/";

/** 空或未设置返回 null（没有 CDN 源站）；非空必须是 https 源，不带路径、尾斜杠、查询和用户信息；错误信息不回显值。 */
export function parseStaticCdnOrigin(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("STATIC_CDN_ORIGIN 不是合法地址"); }
  if (url.protocol !== "https:" || url.origin !== value) throw new Error("STATIC_CDN_ORIGIN 必须是 https 源（不带路径、尾斜杠、查询和用户信息）");
  return value;
}

/**
 * 空或未设置返回空串（同源）；非空必须逐字等于 `${STATIC_CDN_ORIGIN}/yzgc/static/site/`，否则抛错，
 * 不带着一个 CSP 不认的地址启动。开关打开而没有源站也抛错：不回退到任何写死的地址。
 */
export function parseStaticCdnBase(raw: string | undefined, origin: string | undefined): string {
  const source = parseStaticCdnOrigin(origin);
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (!source) throw new Error("STATIC_CDN_BASE 打开时必须设置 STATIC_CDN_ORIGIN");
  if (value !== `${source}/${STATIC_CDN_PATH}`) throw new Error("STATIC_CDN_BASE 只能为空或 STATIC_CDN_ORIGIN 派生的 yzgc/static/site/ 地址");
  return value;
}
