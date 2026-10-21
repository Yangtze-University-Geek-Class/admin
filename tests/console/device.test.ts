import { describe, expect, it } from "vitest";
import {
  USER_CODE_ALPHABET, closedNotice, deviceSignInPath, formatUserCode, isCompleteUserCode, remainingText, scopeLines,
} from "../../app/console/src/lib/device";
import { USER_CODE_ALPHABET as SERVER_ALPHABET } from "../../app/server/src/lib/device-store";
import type { DeviceView } from "../../app/console/src/lib/device";
import { mockApi } from "../../app/console/src/mock";

describe("设备授权确认页的代码输入 (device)", () => {
  it("字母表与服务端一致", () => {
    expect(USER_CODE_ALPHABET).toBe(SERVER_ALPHABET);
  });

  it("转大写、丢掉字母表外的字符、最多 8 位，满 5 位起自动加连字符", () => {
    expect(formatUserCode("bcdf")).toBe("BCDF");
    expect(formatUserCode("bcdfg")).toBe("BCDF-G");
    expect(formatUserCode(" bcdf - ghjk ")).toBe("BCDF-GHJK");
    expect(formatUserCode("BCDF-GHJKLM")).toBe("BCDF-GHJK");
    expect(formatUserCode("a1e0-iou")).toBe("");
    expect(formatUserCode(undefined)).toBe("");
    expect(formatUserCode(["BCDF"])).toBe("");
  });

  it("只有 XXXX-XXXX 的完整代码才算填完", () => {
    expect(isCompleteUserCode("BCDF-GHJK")).toBe(true);
    expect(isCompleteUserCode("BCDFGHJK")).toBe(false);
    expect(isCompleteUserCode("BCDF-GHJ")).toBe(false);
    expect(isCompleteUserCode("bcdf-ghjk")).toBe(false);
    expect(isCompleteUserCode("BCDA-GHJK")).toBe(false);
  });

  it("没登录时去 /signin，登录后带着同一串代码回来", () => {
    expect(deviceSignInPath("BCDF-GHJK")).toBe(`/signin?return_to=${encodeURIComponent("/device?user_code=BCDF-GHJK")}`);
    expect(deviceSignInPath("")).toBe(`/signin?return_to=${encodeURIComponent("/device")}`);
  });

  it("scope 说成人话，不认识的原样列出", () => {
    expect(scopeLines("openid profile")).toEqual(["确认你的极客班账号（账号 ID）", "读取你的用户名和头像"]);
    expect(scopeLines(" openid  repo ")).toEqual(["确认你的极客班账号（账号 ID）", "repo"]);
  });

  it("不能再确认的代码各有说明，剩余时间显示 m:ss", () => {
    expect(closedNotice("expired").title).toBe("这串代码已经过期");
    expect(closedNotice("denied").title).toBe("这串代码已被拒绝");
    expect(closedNotice("approved").title).toBe("这串代码已经用过了");
    expect(closedNotice("consumed").title).toBe("这串代码已经用过了");
    expect(remainingText(600_000, 0)).toBe("10:00");
    expect(remainingText(61_500, 0)).toBe("1:02");
    expect(remainingText(0, 5_000)).toBe("0:00");
  });
});

describe("开发预览里的设备授权样板 (device mock)", () => {
  it("完整用户码给出待确认样板，残缺的码 404，允许/拒绝仍按只读回 501", async () => {
    const view = await mockApi<DeviceView>("/api/identity/device?user_code=bcdf-ghjk");
    expect(view).toMatchObject({ user_code: "BCDF-GHJK", client_id: "geek-cli", scope: "openid profile", status: "pending" });
    expect(view.expires_at).toBeGreaterThan(Date.now());
    await expect(mockApi("/api/identity/device?user_code=BCDF")).rejects.toMatchObject({ status: 404, code: "device_code_not_found" });
    await expect(mockApi("/api/identity/device/approve", { method: "POST", body: JSON.stringify({ user_code: "BCDF-GHJK", decision: "approve" }) }))
      .rejects.toMatchObject({ status: 501, code: "mock_read_only" });
  });

  it("/auth/me 跟随样板身份，默认是已登录的组织所有者", async () => {
    expect(await mockApi("/auth/me")).toMatchObject({ signed_in: true, login: expect.any(String) });
  });
});
