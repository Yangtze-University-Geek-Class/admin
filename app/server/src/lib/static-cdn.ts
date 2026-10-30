/**
 * 静态资源 CDN 开关（#146）在服务端的读法（#286）：构建参数 `STATIC_CDN_BASE` 由 Dockerfile 带进运行环境，
 * 空 = 同源；非空只能逐字等于下面这个常量。规则的唯一来源是仓库根的 `scripts/static-cdn-base.mjs`，
 * 镜像里没有 scripts/，所以这里写一份同样的，`tests/tooling/static-cdn-parity.test.ts` 逐项核对两边一致。
 */
export const STATIC_CDN_BASE = "https://cdn.crosery.com/yzgc/static/site/";

/** 空或未设置返回空串（同源）；非空必须逐字等于 STATIC_CDN_BASE，否则抛错，不带着一个 CSP 不认的地址启动。 */
export function parseStaticCdnBase(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "";
  if (value !== STATIC_CDN_BASE) throw new Error(`STATIC_CDN_BASE 只能为空或 ${STATIC_CDN_BASE}`);
  return value;
}
