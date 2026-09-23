import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICONS, isIconName } from "../../app/web/sites/portal/lib/icons";
import { OS_APPS, agoLabel, appByKey, filterCommands, launcherCommands, monthGrid, moveSelection, rowsThatFit, runTerminal } from "../../app/web/sites/portal/lib/osApps";

const PORTAL = new URL("../../app/web/sites/portal/", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("YUGC OS 应用与启动器", () => {
  it("三个主入口有 1/2/3 快捷键，加入我们是唯一的主操作", () => {
    expect(appByKey("1")?.id).toBe("join");
    expect(appByKey("2")?.id).toBe("forum");
    expect(appByKey("3")?.id).toBe("github");
    expect(OS_APPS.filter((app) => app.primary).map((app) => app.id)).toEqual(["join"]);
    expect(new Set(OS_APPS.map((app) => app.id)).size).toBe(OS_APPS.length);
  });

  it("入口指向新路由：/join-us、/forum-3d、/github、/feedback、控制台 /console", () => {
    const open = Object.fromEntries(OS_APPS.map((app) => [app.id, app.open]));
    expect(open.join).toEqual({ kind: "scene", path: "/join-us" });
    expect(open.forum).toEqual({ kind: "scene", path: "/forum-3d" });
    expect(open.github).toEqual({ kind: "scene", path: "/github" });
    expect(open.feedback).toEqual({ kind: "route", path: "/feedback" });
    expect(open.console).toEqual({ kind: "site", site: "admin", path: "/console" });
  });

  it("启动器过滤：空查询全部返回；中英文关键词都能命中；前缀优先；多词都要命中", () => {
    const commands = launcherCommands();
    expect(filterCommands(commands, "   ")).toHaveLength(commands.length);
    expect(filterCommands(commands, "加入")[0].id).toBe("app:join");
    expect(filterCommands(commands, "FORUM").map((c) => c.id)).toContain("forum-home");
    expect(filterCommands(commands, "论坛")[0].id).toBe("app:forum");
    expect(filterCommands(commands, "forum home").map((c) => c.id)).toEqual(["forum-home"]);
    expect(filterCommands(commands, "zzz-没有这个")).toEqual([]);
  });

  it("上下选择两端夹紧", () => {
    expect(moveSelection(0, -1, 5)).toBe(0);
    expect(moveSelection(4, 1, 5)).toBe(4);
    expect(moveSelection(2, 1, 5)).toBe(3);
    expect(moveSelection(3, 1, 0)).toBe(0);
  });

  it("终端命令", () => {
    const repos = [{ name: "geek-cli", description: "CLI", language: "Rust", pushed: "2026-05-16", url: "https://example.invalid/geek-cli", stars: 0 }];
    expect(runTerminal("help", repos).lines.length).toBeGreaterThan(3);
    expect(runTerminal("./join --yugc", repos).open).toBe("join");
    expect(runTerminal("open github", repos).open).toBe("github");
    expect(runTerminal("open nope", repos).lines.at(-1)?.kind).toBe("err");
    expect(runTerminal("repos", repos).lines[1]).toMatchObject({ key: "geek-cli", href: "https://example.invalid/geek-cli" });
    expect(runTerminal("repos", []).lines[1].kind).toBe("dim");
    expect(runTerminal("clear", repos)).toEqual({ lines: [], clear: true });
    expect(runTerminal("rm -rf /", repos).lines.at(-1)?.kind).toBe("err");
  });
});

describe("桌面组件的纯逻辑", () => {
  it("按卡片高度截断行数，绝不为负", () => {
    expect(rowsThatFit(200, 38, 2)).toBe(5);
    expect(rowsThatFit(37, 38, 2)).toBe(0);
    expect(rowsThatFit(-10, 38, 2)).toBe(0);
    expect(rowsThatFit(Number.NaN, 38, 2)).toBe(0);
  });

  it("日历周一开头，本月每一天恰好出现一次", () => {
    const grid = monthGrid(2026, 8); // 2026-09：9 月 1 日是周二
    expect(grid[0]).toBeNull();
    expect(grid[1]).toBe(1);
    expect(grid.filter((d) => d !== null)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(grid.length % 7).toBe(0);
    const feb = monthGrid(2027, 1); // 2027-02 从周一开始，正好四周
    expect(feb.filter((d) => d !== null)).toHaveLength(28);
  });

  it("时间差文案", () => {
    const now = Date.UTC(2026, 8, 24);
    expect(agoLabel(now - 3600e3, now)).toBe("今天");
    expect(agoLabel(now - 3 * 864e5, now)).toBe("3 天前");
    expect(agoLabel(now - 65 * 864e5, now)).toBe("2 个月前");
    expect(agoLabel(now - 800 * 864e5, now)).toBe("2 年前");
    expect(agoLabel(now + 864e5, now)).toBe("今天");
  });
});

describe("图标注册表与界面禁用字符", () => {
  const files = sources(PORTAL);

  it("官网源码里用到的每个图标名都在注册表里", () => {
    const used = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/<Icon\s+name="([a-z0-9-]+)"/g)) used.add(match[1]);
      for (const match of text.matchAll(/\bicon:\s*"([a-z0-9-]+)"/g)) used.add(match[1]);
      for (const match of text.matchAll(/drawIcon\(\s*\w+,\s*"([a-z0-9-]+)"/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter((name) => !isIconName(name))).toEqual([]);
  });

  it("每个图标都有路径数据", () => {
    for (const [name, paths] of Object.entries(ICONS)) {
      expect(paths.length, name).toBeGreaterThan(0);
      for (const d of paths) expect(d, name).toMatch(/^[Mm]/);
    }
  });

  it("官网界面源码里没有 emoji 与装饰性箭头/符号（注释除外）", () => {
    const banned = /[\u{1F000}-\u{1FFFF}\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u2190-\u21FF\u25A0-\u25FF]/u;
    const hits: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          const code = line.trim();
          if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
          if (banned.test(code)) hits.push(`${file.slice(PORTAL.length)}:${index + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
