import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newKeyPair, validKeyPair } from "../../scripts/local-stack.mjs";

// scripts/local-stack.mjs：本机全栈启动（#356）。只测纯函数与入口约定，不起任何服务。
describe("本机全栈启动", () => {
  it("生成的本机密钥通过与服务端 createConfig 相同的规则，过短或长度不对的被拒绝", () => {
    const pair = newKeyPair();
    expect(validKeyPair(pair.session, pair.encryption)).toBe(true);
    expect(validKeyPair("short", pair.encryption)).toBe(false);
    expect(validKeyPair(pair.session, Buffer.alloc(16).toString("base64"))).toBe(false);
  });

  it("根目录三条命令都只包装 local-stack，脚本不强制结束进程、不碰 Docker", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts["local:up"]).toBe("node scripts/local-stack.mjs up");
    expect(scripts["local:down"]).toBe("node scripts/local-stack.mjs down");
    expect(scripts["local:status"]).toBe("node scripts/local-stack.mjs status");
    const source = readFileSync("scripts/local-stack.mjs", "utf8");
    expect(source).not.toContain("SIGKILL");
    expect(source).not.toMatch(/\bdocker\b/);
  });
});
