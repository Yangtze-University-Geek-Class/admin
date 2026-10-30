import { describe, expect, it } from "vitest";
import { OWNER, TIME_RE, text, validateOwnerApproval } from "../../scripts/owner-approval.mjs";

const ok = { by: "所有者", at: "2026-10-30T10:34:04+08:00", approval: "所有者 10-30 在会话中批准：走 hotfix" };

describe("所有者批准的判定（hotfix 窗口、晋升窗口与同构清单豁免共用）", () => {
  it("署名是字面值「所有者」、时间是北京时间、摘要至少 8 个字时通过", () => {
    expect(OWNER).toBe("所有者");
    expect(validateOwnerApproval(ok)).toBe(true);
    expect(validateOwnerApproval({ ...ok, at: "2026-10-30" })).toBe(true);
  });

  it("署名不是字面值、时间不是北京时间格式、摘要太短或缺失都不通过", () => {
    expect(validateOwnerApproval({ ...ok, by: "owner" })).toBe(false);
    expect(validateOwnerApproval({ ...ok, at: "2026-10-30T02:34:04Z" })).toBe(false);
    expect(validateOwnerApproval({ ...ok, at: undefined })).toBe(false);
    expect(validateOwnerApproval({ ...ok, approval: "  走 hot  " })).toBe(false);
    expect(validateOwnerApproval({ ...ok, approval: undefined })).toBe(false);
  });

  it("时间与文本的小工具与登记口径一致", () => {
    expect(TIME_RE.test("2026-10-30T10:34:04+08:00")).toBe(true);
    expect(TIME_RE.test("10-30")).toBe(false);
    expect(text("12345678")).toBe(true);
    expect(text("1234567", 8)).toBe(false);
  });
});
