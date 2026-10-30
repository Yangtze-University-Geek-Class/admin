import { describe, expect, it } from "vitest";
import { ApiError } from "../../app/console/src/lib/http";
import {
  BIND_EMAIL_PATH, backFromGoogleForInvite, bindEmailPath, bindEmailReturn, cleanCode, codeProblem, initialSignInTab, looksLikeEmail,
  parseSignInOutcome, providerHref, providerIcon, readProviders, registerProblem, registerWithEmail, resetProblem, retryAfter, safeReturnPath, signInOutcomes,
  COMPLETE_PROFILE_PATH, completeProfilePath, completeProfileReturn,
} from "../../app/console/src/lib/signin";
import { BIND_EMAIL_PATH as SERVER_BIND_EMAIL_PATH, COMPLETE_PROFILE_PATH as SERVER_COMPLETE_PROFILE_PATH, bindEmailUrl, gatedReturn } from "../../app/server/src/lib/email-gate";

const ORIGIN = "https://yangtzeu.work";

describe("登录结果提示与行动点解析 (signin)", () => {
  it("GitHub 组织那道门去掉以后（#274），not_member、invite_pending、invite_required、invalid_invite 都不再是服务端会给的原因", () => {
    for (const dead of ["not_member", "invite_pending", "invite_required", "invalid_invite"]) expect(parseSignInOutcome(dead)).toBeNull();
    for (const [key, outcome] of Object.entries(signInOutcomes())) {
      expect(`${outcome.title}${outcome.body ?? ""}`, key).not.toMatch(/GitHub 组织|组织邀请/);
      expect(outcome.action?.href ?? "", key).not.toContain("github.com");
    }
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
    // 与服务端 SigninOutcome（app/server/src/lib/safe-return.ts）逐个对应；#274 review round 1：邀请码选填后
    // not_member、invite_pending、invite_required 都去掉了，invalid_invite 改名 invite_invalid，
    // 另外补上 no_account、code_expired、rate_limited（服务端类型里有，这里原来缺）；
    // registration_limited 是 #274 残留修复加的（SPEC §3.8：同一 IP/设备每天新建账号的次数到了上限）。
    expect(Object.keys(outcomes)).toEqual([
      "cancelled", "failed", "account_disabled", "invite_invalid", "email_taken", "no_account", "code_expired", "rate_limited", "registration_limited",
    ]);
  });

  it("邀请码无效、邮箱已被别的账号用：各有一句说明，没有外链", () => {
    expect(parseSignInOutcome("invite_invalid")?.title).toBe("邀请码无效");
    expect(parseSignInOutcome("email_taken")?.body).toContain("用邮箱验证码登录");
    for (const key of ["invite_invalid", "email_taken"]) expect(parseSignInOutcome(key)?.action, key).toBeUndefined();
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
  });

  it("邮箱方式留下本站的密码登录地址，别站的地址丢掉", () => {
    const [email, odd] = readProviders({
      providers: [
        { id: "email", name: "邮箱", kind: "email_code", start: "/auth/email/start", can_register: true, password: "/auth/email/password" },
        { id: "odd", name: "Odd", kind: "email_code", start: "/auth/odd", password: "https://evil.example/pw" },
      ],
    });
    expect(email).toEqual({ id: "email", name: "邮箱", kind: "email_code", start: "/auth/email/start", can_register: true, password: "/auth/email/password" });
    expect(odd).not.toHaveProperty("password");
    expect(readProviders({ providers: "github" })).toEqual([]);
  });

  it("起点加上完整的本站 return_to；已有查询时用 &", () => {
    expect(providerHref({ start: "/auth/github" }, "/forum/t/1?x=1", ORIGIN))
      .toBe(`/auth/github?return_to=${encodeURIComponent(`${ORIGIN}/forum/t/1?x=1`)}`);
    expect(providerHref({ start: "/auth/google?prompt=select_account" }, "/", ORIGIN))
      .toBe(`/auth/google?prompt=select_account&return_to=${encodeURIComponent(`${ORIGIN}/`)}`);
  });

  it("Google 注册时带上邀请码，空白的不带", () => {
    expect(providerHref({ start: "/auth/google" }, "/console", ORIGIN, " Fall-2026 "))
      .toBe(`/auth/google?return_to=${encodeURIComponent(`${ORIGIN}/console`)}&invite=Fall-2026`);
    expect(providerHref({ start: "/auth/google" }, "/console", ORIGIN, "  ")).toBe(`/auth/google?return_to=${encodeURIComponent(`${ORIGIN}/console`)}`);
  });

  it("图标按 id 取，未知渠道用通用登录图标", () => {
    expect(providerIcon({ id: "github" })).toBe("i-carbon-logo-github");
    expect(providerIcon({ id: "wechat" })).toBe("i-carbon-login");
  });
});

describe("邮箱登录的小工具 (retryAfter / cleanCode)", () => {
  it("429 按服务端给的秒数倒计时，没给就按 60 秒；别的错误不算", () => {
    expect(retryAfter(new ApiError(429, "rate_limited", "x", undefined, { retry_after: 42 }))).toBe(42);
    expect(retryAfter(new ApiError(429, "rate_limited", "x"))).toBe(60);
    expect(retryAfter(new ApiError(400, "bad_email", "x"))).toBeNull();
    expect(retryAfter(new Error("offline"))).toBeNull();
  });

  it("验证码只留数字、最多 6 位", () => {
    expect(cleanCode("123 456")).toBe("123456");
    expect(cleanCode("12a3-4567")).toBe("123456");
    expect(cleanCode(98765)).toBe("98765");
  });
});

describe("登录、注册两个标签 (initialSignInTab / registerProblem)", () => {
  it("默认开「登录」；Google 填的邀请码不对回来时开「注册」（#274：Google 不再有「还没有账号」这一种）", () => {
    expect(initialSignInTab({})).toBe("signin");
    expect(initialSignInTab({ signin: "invite_invalid", provider: "google" })).toBe("register");
    expect(initialSignInTab({ signin: "invite_invalid" })).toBe("signin");
    expect(initialSignInTab({ signin: "account_disabled", provider: "google" })).toBe("signin");
    expect(initialSignInTab({ mode: "register" })).toBe("signin");
    expect(backFromGoogleForInvite({ signin: "invite_invalid", provider: "google" })).toBe(true);
    expect(backFromGoogleForInvite({ signin: "invite_invalid", provider: "github" })).toBe(false);
  });

  it("邮箱只挡明显填错的；验证码要先发过、再填满 6 位", () => {
    expect(looksLikeEmail(" new@example.com ")).toBe(true);
    for (const bad of ["new@", "@example.com", "new example@example.test", ""]) expect(looksLikeEmail(bad), bad).toBe(false);
    expect(codeProblem(false, "123456")).toBe("先获取验证码");
    expect(codeProblem(true, "12345")).toBe("验证码是 6 位数字");
    expect(codeProblem(true, "123456")).toBeNull();
  });

  it("注册表单按从上到下的顺序报第一处问题，姓名和年级必填（#280），邀请码和密码可以不填，密码填了至少 8 位、不超过 72 字节", () => {
    const ok = { email: "new@example.com", realName: "王小明", grade: 1, invite: "Fall-2026", codeSent: true, code: "123456", password: "" };
    expect(registerProblem(ok)).toBeNull();
    expect(registerProblem({ ...ok, email: "new@" })).toBe("邮箱格式不对");
    expect(registerProblem({ ...ok, realName: " " })).toBe("填上真实姓名");
    expect(registerProblem({ ...ok, realName: "a1" })).toBe("姓名填 2 到 32 个字，只能是文字、空格和「·」");
    expect(registerProblem({ ...ok, realName: "阿卜杜·热合曼" })).toBeNull();
    // 年级只能从下拉框里选 1–4，空着或别的值都不行
    for (const grade of ["", 0, 5, "大一"]) expect(registerProblem({ ...ok, grade }), String(grade)).toBe("选一个年级");
    // 邀请码选填（CONTRACT §2）：不填注册成注册用户，填了由服务端核对
    expect(registerProblem({ ...ok, invite: "  " })).toBeNull();
    expect(registerProblem({ ...ok, codeSent: false })).toBe("先获取验证码");
    expect(registerProblem({ ...ok, code: "12345" })).toBe("验证码是 6 位数字");
    expect(registerProblem({ ...ok, password: "short" })).toBe("密码至少 8 位");
    expect(registerProblem({ ...ok, password: "abcd1234" })).toBeNull();
    expect(registerProblem({ ...ok, password: "长".repeat(25) })).toBe("密码太长了（不能超过 72 个字节，一个汉字算 3 个）");
    expect(registerProblem({ ...ok, password: "a-long-enough-password" })).toBeNull();
  });
});

describe("邮箱注册提交 (registerWithEmail)", () => {
  const input = { code: "123456", invite: "Fall-2026", password: "a-long-enough-password", realName: "王小明", grade: 2 as const };
  const fakes = (registered: boolean, setPassword: (password: string) => Promise<unknown> = async () => ({ ok: true })) => {
    const calls: unknown[][] = [];
    return {
      calls,
      deps: {
        verify: async (code: string, invite?: string, realInfo?: unknown) => { calls.push(["verify", code, invite, realInfo]); return { return_to: "/console", registered }; },
        setPassword: async (password: string) => { calls.push(["password", password]); return setPassword(password); },
      },
    };
  };

  it("新账号：带邀请码、姓名和年级验证，再设上填的密码，然后回 return_to", async () => {
    const { calls, deps } = fakes(true);
    await expect(registerWithEmail(input, deps)).resolves.toEqual({ kind: "done", returnTo: "/console" });
    expect(calls).toEqual([["verify", "123456", "Fall-2026", { real_name: "王小明", grade: 2 }], ["password", "a-long-enough-password"]]);
  });

  it("没填密码就不设，直接回 return_to", async () => {
    const { calls, deps } = fakes(true);
    await expect(registerWithEmail({ ...input, password: "" }, deps)).resolves.toEqual({ kind: "done", returnTo: "/console" });
    expect(calls).toHaveLength(1);
  });

  it("邮箱原来就有账号：只登录，不改它的密码，交给页面说一句", async () => {
    const { calls, deps } = fakes(false);
    await expect(registerWithEmail(input, deps)).resolves.toEqual({ kind: "existing", returnTo: "/console" });
    expect(calls).toEqual([["verify", "123456", "Fall-2026", { real_name: "王小明", grade: 2 }]]);
  });

  it("账号建好了但密码没设上：带着原因交给页面，不当作注册失败", async () => {
    const failure = new ApiError(400, "password_too_short", "密码至少 8 位");
    const { deps } = fakes(true, async () => { throw failure; });
    await expect(registerWithEmail(input, deps)).resolves.toEqual({ kind: "password_failed", returnTo: "/console", error: failure });
  });

  it("验证码这一步的错误照常抛出，由页面按错误码处理", async () => {
    const expired = new ApiError(400, "code_expired", "验证码过期了");
    const deps = { verify: async () => { throw expired; }, setPassword: async () => ({}) };
    await expect(registerWithEmail(input, deps)).rejects.toBe(expired);
  });
});

describe("忘记密码与绑定邮箱 (#273)", () => {
  it("忘记密码表单按从上到下的顺序报第一处问题，新密码必填、规则同账号页", () => {
    const ok = { email: "me@example.com", codeSent: true, code: "123456", password: "a-long-enough-password" };
    expect(resetProblem(ok)).toBeNull();
    expect(resetProblem({ ...ok, email: "me@" })).toBe("邮箱格式不对");
    expect(resetProblem({ ...ok, codeSent: false })).toBe("先获取验证码");
    expect(resetProblem({ ...ok, code: "12345" })).toBe("验证码是 6 位数字");
    expect(resetProblem({ ...ok, password: "" })).toBe("填上新密码");
    expect(resetProblem({ ...ok, password: "short" })).toBe("密码至少 8 位");
  });

  it("绑定邮箱页的地址与服务端一致，服务端给的 return_to 原样回到原页面", () => {
    expect(BIND_EMAIL_PATH).toBe(SERVER_BIND_EMAIL_PATH);
    expect(bindEmailPath("/forum/t/1?page=2")).toBe("/bind-email?return_to=%2Fforum%2Ft%2F1%3Fpage%3D2");
    const fromServer = new URL(bindEmailUrl(ORIGIN, `${ORIGIN}/forum/t/1?page=2#c3`));
    expect(fromServer.pathname).toBe(BIND_EMAIL_PATH);
    expect(bindEmailReturn(fromServer.searchParams.get("return_to"), ORIGIN)).toBe("/forum/t/1?page=2#c3");
    expect(bindEmailReturn(new URLSearchParams(bindEmailPath("/account").split("?")[1]).get("return_to"), ORIGIN)).toBe("/account");
  });

  it("补资料页（#280）的地址与服务端一致；服务端先绑邮箱再补资料，填好以后不回到两个关口页", () => {
    expect(COMPLETE_PROFILE_PATH).toBe(SERVER_COMPLETE_PROFILE_PATH);
    expect(completeProfilePath("/forum/t/1?page=2")).toBe("/complete-profile?return_to=%2Fforum%2Ft%2F1%3Fpage%3D2");
    const deps = (email: boolean, profile: boolean, member = true) => ({ identity: { hasEmail: () => !email, isMember: () => member }, mail: { sendingEnabled: true }, profiles: { profileRequired: () => profile } });
    const back = `${ORIGIN}/forum/t/1?page=2#c3`;
    expect(gatedReturn(deps(false, false), ORIGIN, "a", back)).toBe(back);
    expect(new URL(gatedReturn(deps(true, true), ORIGIN, "a", back)).pathname).toBe(BIND_EMAIL_PATH);
    const fromServer = new URL(gatedReturn(deps(false, true), ORIGIN, "a", back));
    expect(fromServer.pathname).toBe(COMPLETE_PROFILE_PATH);
    expect(completeProfileReturn(fromServer.searchParams.get("return_to"), ORIGIN)).toBe("/forum/t/1?page=2#c3");
    // 不是极客班的人不用补资料
    expect(gatedReturn(deps(false, true, false), ORIGIN, "a", back)).toBe(back);
    expect(completeProfileReturn("/complete-profile?return_to=%2F", ORIGIN)).toBe("/console");
    expect(completeProfileReturn("/bind-email", ORIGIN)).toBe("/console");
    expect(completeProfileReturn("https://evil.test/", ORIGIN)).toBe("/console");
    // 绑好邮箱可以接着去补资料页
    expect(bindEmailReturn("/complete-profile?return_to=%2Fforum%2F", ORIGIN)).toBe("/complete-profile?return_to=%2Fforum%2F");
  });

  it("绑好以后不回到绑定邮箱页自己，也不去别的站点；登录页仍可以回到绑定邮箱页", () => {
    expect(bindEmailReturn("/bind-email?return_to=%2Fforum%2F", ORIGIN)).toBe("/console");
    expect(bindEmailReturn("https://evil.example/", ORIGIN)).toBe("/console");
    expect(bindEmailReturn(undefined, ORIGIN)).toBe("/console");
    // 绑定邮箱页请人重新登录时，登录完要回到它
    expect(safeReturnPath("/bind-email?return_to=%2Fforum%2F", ORIGIN)).toBe("/bind-email?return_to=%2Fforum%2F");
  });
});
