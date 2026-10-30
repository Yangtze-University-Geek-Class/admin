// 安全页的永久开启（#369）：和这个目录里其他测试一样不挂载组件，核对源码里的约定。
// 这些约定一旦掉了，永久开启会被当成临时开启（没有截止时间就无法关闭，或在没有倒计时时被判为未开启），或请求体与服务端合同对不上。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(fileURLToPath(new URL("../../app/console/src/pages/Security.vue", import.meta.url)), "utf8");

describe("security page permanent decoy (#369)", () => {
  it("offers 永久开启 beside the duration options and sends it as its own request shape", () => {
    expect(page).toMatch(/<TxRadio value="permanent">永久开启<\/TxRadio>/);
    expect(page).toContain("{ enabled: true, permanent: true }");
    expect(page).toContain("{ enabled: true, duration_minutes: choice }");
  });

  it("stays active without a countdown, and can still be closed when it has no expiry", () => {
    expect(page).toMatch(/permanent\.value \|\| remaining\.value > 0/);
    expect(page).toMatch(/:disabled="busy \|\| settings\.loading\.value \|\| !hasSetting"/);
    expect(page).not.toMatch(/expires_at === null/);
  });

  it("keeps the confirm step before any PUT", () => {
    const change = page.slice(page.indexOf("const change = useAction"), page.indexOf("const unblock = useAction"));
    expect(change.indexOf("await ask(")).toBeGreaterThan(-1);
    expect(change.indexOf("await ask(")).toBeLessThan(change.indexOf("api<SecurityDecoyStatus>"));
  });
});
