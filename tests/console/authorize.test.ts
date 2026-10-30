import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeBindEmailPath, authorizeSignInPath, closedNotice, decisionPath, detailsPath, interactionUid, scopeLines, type AuthorizeView,
} from "../../app/console/src/lib/authorize";
import { safeReturnPath } from "../../app/console/src/lib/signin";
import { OIDC_SCOPES } from "../../app/server/src/lib/oidc-provider";
import { oidcContracts } from "../../app/server/src/routes/oidc/contracts";
import { mockApi } from "../../app/console/src/mock";

describe("对外授权的同意页 (authorize)", () => {
  it("交互编号按服务端合同的格式取，其它一律不认", () => {
    const pattern = (oidcContracts["GET /oidc/interaction/:uid"].params as { properties: { uid: { pattern: string } } }).properties.uid.pattern;
    expect(pattern).toBe("^[A-Za-z0-9_-]{10,64}$");
    expect(interactionUid("Ab3_-xyz0123")).toBe("Ab3_-xyz0123");
    expect(interactionUid("short")).toBeNull();
    expect(interactionUid("../../etc/passwd")).toBeNull();
    expect(interactionUid(["Ab3_-xyz0123"])).toBeNull();
    expect(interactionUid(undefined)).toBeNull();
  });

  it("接口地址与登录回跳都落在本站的交互入口", () => {
    expect(detailsPath("Ab3_-xyz0123")).toBe("/oidc/interaction/Ab3_-xyz0123/details");
    expect(decisionPath("Ab3_-xyz0123", "confirm")).toBe("/oidc/interaction/Ab3_-xyz0123/confirm");
    expect(decisionPath("Ab3_-xyz0123", "abort")).toBe("/oidc/interaction/Ab3_-xyz0123/abort");
    const signIn = authorizeSignInPath("Ab3_-xyz0123");
    expect(signIn).toBe("/signin?return_to=%2Foidc%2Finteraction%2FAb3_-xyz0123");
    // 统一登录页按同源路径接受这个 return_to，登录完回到交互入口
    const back = new URLSearchParams(signIn.split("?")[1]).get("return_to");
    expect(safeReturnPath(back, "https://example.test")).toBe("/oidc/interaction/Ab3_-xyz0123");
    // 还没有登录邮箱（#273）：绑好同样回到交互入口
    expect(authorizeBindEmailPath("Ab3_-xyz0123")).toBe("/bind-email?return_to=%2Foidc%2Finteraction%2FAb3_-xyz0123");
  });

  it("服务端会发的每一项信息都有说明，不认识的原样列出", () => {
    const lines = scopeLines([...OIDC_SCOPES]);
    expect(lines).toHaveLength(OIDC_SCOPES.length);
    for (const [index, scope] of OIDC_SCOPES.entries()) expect(lines[index]).not.toBe(scope);
    expect(scopeLines(["openid", "repo"])[1]).toBe("repo");
  });

  it("过期、换了账号、缺少交互编号各有说明", () => {
    expect(closedNotice("expired").title).toBe("这次登录已经过期");
    expect(closedNotice("mismatch").title).toBe("当前账号和发起登录的不一致");
    expect(closedNotice("missing").title).toBe("缺少登录请求");
  });

  it("开发预览给一份待同意的样板，允许与拒绝按只读回 501", async () => {
    const view = await mockApi<AuthorizeView>(detailsPath("Ab3_-xyz0123"));
    expect(view).toMatchObject({ client: { id: "gitlab", name: "GitLab", host: "example.test" }, scopes: ["openid", "profile", "email"] });
    expect(view.expires_at).toBeGreaterThan(Date.now());
    await expect(mockApi(decisionPath("Ab3_-xyz0123", "confirm"), { method: "POST" })).rejects.toMatchObject({ status: 501 });
  });

  afterEach(() => { vi.unstubAllGlobals(); });
  it("开发预览里还没有登录邮箱的样板照服务端回 403 email_required（#273）", async () => {
    vi.stubGlobal("window", { location: { search: "?__persona=no_email" } });
    await expect(mockApi(detailsPath("Ab3_-xyz0123"))).rejects.toMatchObject({ status: 403, code: "email_required" });
  });
});
