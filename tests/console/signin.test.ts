import { describe, expect, it } from "vitest";
import {
  GITHUB_INVITATION_URL, parseSignInOutcome, providerHref, providerIcon, readProviders, safeReturnPath, signInOutcomes,
} from "../../app/console/src/lib/signin";

const ORIGIN = "https://yangtzeu.work";

describe("登录结果提示与行动点解析 (signin)", () => {
  it("not_member：提示未加入组织，并提供「申请加入极客班」引导链接", () => {
    const outcome = parseSignInOutcome("not_member");
    expect(outcome).not.toBeNull();
    expect(outcome?.type).toBe("warning");
    expect(outcome?.title).toBe("只有极客班成员可以登录");
    expect(outcome?.body).toContain("不在极客班的 GitHub 组织里");
    expect(outcome?.action).toEqual({
      label: "申请加入极客班",
      icon: "i-carbon-email",
      href: expect.stringContaining("/join-us"),
    });
  });

  it("invite_pending：提示待接受邀请，并提供跳转 GitHub 组织邀请页面的外链", () => {
    const outcome = parseSignInOutcome("invite_pending");
    expect(outcome).not.toBeNull();
    expect(outcome?.type).toBe("warning");
    expect(outcome?.title).toBe("还没接受组织邀请");
    expect(outcome?.body).toContain("接受极客班组织的邀请");
    expect(outcome?.action).toEqual({
      label: "前往 GitHub 接受邀请",
      icon: "i-carbon-launch",
      href: GITHUB_INVITATION_URL,
      target: "_blank",
    });
  });

  it("cancelled 与 failed：只展示状态，不包含额外行动点", () => {
    const cancelled = parseSignInOutcome("cancelled");
    expect(cancelled).not.toBeNull();
    expect(cancelled?.type).toBe("info");
    expect(cancelled?.title).toBe("已取消登录");
    expect(cancelled?.action).toBeUndefined();

    const failed = parseSignInOutcome("failed");
    expect(failed).not.toBeNull();
    expect(failed?.type).toBe("warning");
    expect(failed?.title).toBe("登录没有完成");
    expect(failed?.action).toBeUndefined();
  });

  it("未知或非字符串参数：返回 null", () => {
    expect(parseSignInOutcome("unexpected_code")).toBeNull();
    expect(parseSignInOutcome(null)).toBeNull();
    expect(parseSignInOutcome(undefined)).toBeNull();
    expect(parseSignInOutcome(123)).toBeNull();
  });

  it("signInOutcomes 完整导出所有状态定义", () => {
    const outcomes = signInOutcomes();
    expect(Object.keys(outcomes)).toEqual(["not_member", "invite_pending", "cancelled", "failed", "account_disabled"]);
  });

  it("account_disabled：说明账号已停用，不给重试以外的行动点", () => {
    const outcome = parseSignInOutcome("account_disabled");
    expect(outcome?.title).toBe("这个极客班账号已停用");
    expect(outcome?.action).toBeUndefined();
  });
});

describe("return_to 只认本站路径 (safeReturnPath)", () => {
  it("本站路径与完整的本站地址都换成「路径 + 查询 + 锚点」", () => {
    expect(safeReturnPath("/forum/t/1?page=2#c3", ORIGIN)).toBe("/forum/t/1?page=2#c3");
    expect(safeReturnPath(`${ORIGIN}/competitions/7`, ORIGIN)).toBe("/competitions/7");
    expect(safeReturnPath(ORIGIN, ORIGIN)).toBe("/");
  });

  it("别的站点、协议相对地址、反斜杠、控制字符、带凭据、非路径写法一律回默认页", () => {
    for (const raw of [
      "https://evil.example/console", "//evil.example/x", "/\\evil.example", "/a\nb", "javascript:alert(1)",
      `https://user:pass@yangtzeu.work/console`, "https://prev.yangtzeu.work/console", "console", "", "x".repeat(2049),
    ]) {
      expect(safeReturnPath(raw, ORIGIN), raw).toBe("/console");
    }
    expect(safeReturnPath(undefined, ORIGIN)).toBe("/console");
    expect(safeReturnPath(["/forum"], ORIGIN)).toBe("/console");
  });

  it("不回到登录页自己，默认页可以换", () => {
    expect(safeReturnPath("/signin?return_to=/console", ORIGIN)).toBe("/console");
    expect(safeReturnPath("https://evil.example", ORIGIN, "/")).toBe("/");
  });
});

describe("登录方式按 /auth/providers 渲染 (readProviders / providerHref)", () => {
  it("只留形状正确、起点是本站路径的条目", () => {
    const providers = readProviders({
      providers: [
        { id: "github", name: "GitHub", kind: "redirect", start: "/auth/github", can_register: true, extra: 1 },
        { id: "evil", name: "Evil", kind: "redirect", start: "https://evil.example/auth" },
        { id: "proto", name: "Proto", kind: "redirect", start: "//evil.example/auth" },
        { id: "odd", name: "Odd", kind: "sms", start: "/auth/sms" },
        null,
        "github",
      ],
    });
    expect(providers).toEqual([{ id: "github", name: "GitHub", kind: "redirect", start: "/auth/github", can_register: true }]);
    expect(readProviders(null)).toEqual([]);
    expect(readProviders({ providers: "github" })).toEqual([]);
  });

  it("起点加上完整的本站 return_to；已有查询时用 &", () => {
    expect(providerHref({ start: "/auth/github" }, "/forum/t/1?x=1", ORIGIN))
      .toBe(`/auth/github?return_to=${encodeURIComponent(`${ORIGIN}/forum/t/1?x=1`)}`);
    expect(providerHref({ start: "/auth/google?prompt=select_account" }, "/", ORIGIN))
      .toBe(`/auth/google?prompt=select_account&return_to=${encodeURIComponent(`${ORIGIN}/`)}`);
  });

  it("图标按 id 取，未知渠道用通用登录图标", () => {
    expect(providerIcon({ id: "github" })).toBe("i-carbon-logo-github");
    expect(providerIcon({ id: "wechat" })).toBe("i-carbon-login");
  });
});
