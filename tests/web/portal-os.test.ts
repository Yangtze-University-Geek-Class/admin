import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICONS, isIconName } from "../../app/web/sites/portal/lib/icons";
import { OS_APPS, agoLabel, appByKey, filterCommands, launcherCommands, moveSelection, runTerminal } from "../../app/web/sites/portal/lib/osApps";

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

describe("桌面的时间文案", () => {
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

  it("同一个类的基础规则只在一个样式表里定义（避免书桌浮层这类样式串到别的页面）", () => {
    const owners = new Map<string, string[]>();
    for (const file of files.filter((path) => path.endsWith(".css"))) {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of css.matchAll(/(?:^|[},])\s*(\.pt-[a-z0-9-]+)\s*(?=[{,])/g)) {
        const list = owners.get(match[1]) ?? [];
        const name = file.slice(PORTAL.length);
        if (!list.includes(name)) list.push(name);
        owners.set(match[1], list);
      }
    }
    expect([...owners].filter(([, list]) => list.length > 1)).toEqual([]);
  });

  it("官网界面不出现写给开发者看的说明（快照、示意、装饰、占位之类，注释除外）", () => {
    const banned = /快照|示意|装饰|占位|仅供|演示数据|mock/i;
    const hits: string[] = [];
    for (const file of files.filter((name) => /\.tsx?$/.test(name))) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          const code = line.trim();
          if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
          // 只看字符串与 JSX 文本：去掉行尾注释，再去掉标识符（useForumSnapshot 之类的函数名不算界面文案）
          const text = code.replace(/\/\/.*$/, "").replace(/[A-Za-z_$][\w$]*/g, (word) => (/^mock$/i.test(word) ? word : ""));
          if (banned.test(text)) hits.push(`${file.slice(PORTAL.length)}:${index + 1}: ${code}`);
        });
    }
    expect(hits).toEqual([]);
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
