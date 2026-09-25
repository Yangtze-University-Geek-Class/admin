// 把接口错误翻成用户能看懂的一段话：出了什么事、下一步做什么。纯函数，tests/console 直接测。
import { ApiError } from "./http";
import { BLOCK_REASON_TEXT } from "./nav";
import type { BlockReason } from "./types";

export type ErrorView = {
  kind: "signed_out" | "forbidden" | "not_found" | "read_only" | "rate_limited" | "invalid" | "conflict" | "server" | "network";
  title: string;
  detail: string;
  code: string;
  status: number | null;
  requestId: string | null;
  capability: string | null;
  reason: BlockReason | null;
};

const isBlockReason = (value: unknown): value is BlockReason => value === "github_admin_required" || value === "github_membership_required";

/** `labelOf` 把能力 id 换成中文名（来自 catalogue）；没有 catalogue 时原样返回 id。 */
export function describeError(error: unknown, labelOf: (capability: string) => string = id => id): ErrorView {
  if (!(error instanceof ApiError)) {
    return {
      kind: "network", title: "连不上服务器", detail: "请检查网络后重试。", code: "network_error",
      status: null, requestId: null, capability: null, reason: null,
    };
  }
  const payload = error.payload ?? {};
  const capability = typeof payload.capability === "string" ? payload.capability : null;
  const reason = isBlockReason(payload.reason) ? payload.reason : null;
  const base = { code: error.code, status: error.status, requestId: error.requestId ?? null, capability, reason };

  if (error.status === 401) return { ...base, kind: "signed_out", title: "登录已失效", detail: "请重新用 GitHub 登录。" };
  if (error.status === 403 && error.code === "missing_capability" && capability) {
    const name = labelOf(capability);
    return {
      ...base, kind: "forbidden", title: `没有「${name}」权限`,
      detail: reason
        ? `你的称号包含这项权限，但${BLOCK_REASON_TEXT[reason]}才能使用。`
        : "请联系舰长，为你指派包含这项权限的称号。",
    };
  }
  if (error.status === 403) return { ...base, kind: "forbidden", title: "没有权限", detail: error.message || "当前账号不能执行这个操作。" };
  if (error.status === 404) return { ...base, kind: "not_found", title: "找不到这条记录", detail: "它可能已被删除，或者链接有误。" };
  if (error.status === 501 && error.code === "mock_read_only") {
    return { ...base, kind: "read_only", title: "开发预览是只读的", detail: "样板数据不能保存修改。要验证写操作，请连接本地后端。" };
  }
  if (error.status === 409) return { ...base, kind: "conflict", title: "操作冲突", detail: error.message };
  if (error.status === 429) return { ...base, kind: "rate_limited", title: "操作太频繁", detail: "请稍等一分钟再试。" };
  if (error.status >= 400 && error.status < 500) return { ...base, kind: "invalid", title: "请求没有通过校验", detail: error.message };
  return { ...base, kind: "server", title: "服务器出错了", detail: "请稍后重试；如果一直失败，请把下面的编号发给维护者。" };
}

/** 一行技术信息：HTTP 状态、机器码、请求编号（用等宽字体显示）。 */
export function errorTrace(view: ErrorView): string {
  const parts = [view.status ? `HTTP ${view.status}` : null, view.code, view.capability, view.requestId ? `request ${view.requestId}` : null];
  return parts.filter(Boolean).join(" · ");
}
