import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICONS, isIconName } from "../../app/web/sites/portal/lib/icons";
import { ORG_ICONS } from "../../app/web/sites/portal/lib/org";
import { parseMe } from "../../app/web/sites/portal/lib/account";
import { links } from "../../app/web/sites/portal/lib/links";
import { OS_APPS, agoLabel, appById, appByKey, appLink, appLinkById, filterCommands, followAppLink, launcherCommands, moveSelection, runTerminal, visibleApps } from "../../app/web/sites/portal/lib/osApps";

const PORTAL = new URL("../../app/web/sites/portal/", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("控制台入口只给 console_link 为 true 的人", () => {
  it("/auth/me 的 console_link 原样读出，缺失或不是 true 都当作 false", () => {
    expect(parseMe({ signed_in: true, login: "ada", avatar_url: null, console_link: true })).toEqual({ login: "ada", avatarUrl: null, consoleLink: true });
    expect(parseMe({ signed_in: true, login: "ada", avatar_url: null })?.consoleLink).toBe(false);
    expect(parseMe({ signed_in: true, login: "ada", console_link: "true" })?.consoleLink).toBe(false);
    expect(parseMe({ signed_in: false })).toBeNull();
  });

  it("没有 console_link：桌面、Dock、启动器、终端里都没有控制台，其余应用照旧", () => {
    const apps = visibleApps(false);
    expect(apps.map((app) => app.id)).toEqual(OS_APPS.map((app) => app.id).filter((id) => id !== "console"));
    expect(launcherCommands(apps).map((command) => command.id)).not.toContain("app:console");
    expect(runTerminal("ls", [], apps).lines.map((line) => line.key)).not.toContain("console");
    expect(runTerminal("open console", [], apps)).toMatchObject({ open: undefined });
    expect(runTerminal("open console", [], apps).lines.at(-1)?.kind).toBe("err");
  });

  it("有 console_link：控制台和其它应用一起出现，能从终端打开", () => {
    const apps = visibleApps(true);
    expect(apps).toEqual(OS_APPS);
    expect(launcherCommands(apps).map((command) => command.id)).toContain("app:console");
    expect(runTerminal("open console", [], apps).open).toBe("console");
  });

  it("页脚与头像菜单里的控制台链接都看 consoleLink", () => {
    const shell = readFileSync(`${PORTAL}components/PageShell.tsx`, "utf8");
    const os = readFileSync(`${PORTAL}components/os/YugcOs.tsx`, "utf8");
    expect(shell).toMatch(/consoleLink && <a href=\{links\.console\(\)\}>控制台<\/a>/);
    expect(os).toMatch(/\.\.\.\(consoleLink \? \[\{ label: "控制台"/);
    expect(os).not.toMatch(/OS_APPS\.map/);
  });
});

describe("YUGC OS 应用与启动器", () => {
  it("三个主入口有 1/2/3 快捷键，加入我们是唯一的主操作", () => {
    expect(appByKey("1")?.id).toBe("join");
    expect(appByKey("2")?.id).toBe("forum");
    expect(appByKey("3")?.id).toBe("github");
    expect(OS_APPS.filter((app) => app.primary).map((app) => app.id)).toEqual(["join"]);
    expect(new Set(OS_APPS.map((app) => app.id)).size).toBe(OS_APPS.length);
  });

  it("入口指向：加入我们进 /join-us 场景，论坛与 GitHub 组织直达（#185），意见箱 /feedback，控制台 /console", () => {
    const open = Object.fromEntries(OS_APPS.map((app) => [app.id, app.open]));
    expect(open.join).toEqual({ kind: "scene", path: "/join-us" });
    expect(open.forum).toEqual({ kind: "site", link: "forumHome" });
    expect(open.github).toEqual({ kind: "external", link: "githubOrg" });
    expect(open.feedback).toEqual({ kind: "route", path: "/feedback" });
    expect(open.console).toEqual({ kind: "site", link: "console" });
    // 没有哪个应用再经过 /forum-3d、/github 场景页
    expect(JSON.stringify(OS_APPS)).not.toMatch(/forum-3d|"\/github"/);
  });

  it("站外应用的地址与打开方式：论坛、控制台当前标签页，GitHub 组织新标签页；留在官网里的应用没有站外地址", () => {
    expect(appLink(appById("forum")!)).toEqual({ href: links.forumHome(), newTab: false });
    expect(appLink(appById("console")!)).toEqual({ href: links.console(), newTab: false });
    expect(appLink(appById("github")!)).toEqual({ href: "https://github.com/Yangtze-University-Geek-Class", newTab: true });
    for (const id of ["join", "promo", "about", "org", "terminal", "wallpaper", "feedback"]) expect(appLink(appById(id)!), id).toBeNull();
    expect(appLinkById("forum")).toEqual({ href: links.forumHome(), newTab: false });
    expect(() => appLinkById("join")).toThrow();
  });

  it("打开站外应用：新标签页用 noopener、不带 referrer；当前标签页整页跳转，两者不混用", () => {
    const calls: string[] = [];
    const win = { open: (...args: unknown[]) => (calls.push(`open ${args.join(" ")}`), null), location: { assign: (href: string) => calls.push(`assign ${href}`) } } as unknown as Pick<Window, "open" | "location">;
    followAppLink({ href: "https://github.com/x", newTab: true }, win);
    followAppLink({ href: "/forum/", newTab: false }, win);
    expect(calls).toEqual(["open https://github.com/x _blank noopener,noreferrer", "assign /forum/"]);
  });

  it("启动器过滤：空查询全部返回；中英文关键词都能命中；前缀优先；多词都要命中", () => {
    const commands = launcherCommands();
    expect(filterCommands(commands, "   ")).toHaveLength(commands.length);
    expect(filterCommands(commands, "加入")[0].id).toBe("app:join");
    expect(filterCommands(commands, "FORUM").map((c) => c.id)).toContain("app:forum");
    expect(filterCommands(commands, "论坛")[0].id).toBe("app:forum");
    // 原来单独的「进入论坛首页」命令和论坛应用去同一个地方，已并进论坛应用（#185）；它的搜索词照样找得到论坛
    expect(commands.map((c) => c.id)).not.toContain("forum-home");
    expect(filterCommands(commands, "forum home").map((c) => c.id)).toEqual(["app:forum"]);
    expect(filterCommands(commands, "首页")[0].id).toBe("app:forum");
    expect(filterCommands(commands, "bbs")[0].id).toBe("app:forum");
    expect(filterCommands(commands, "github")[0].id).toBe("app:github");
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

describe("入口直达，不再经过 3D 场景页（#185）", () => {
  it("源码里指向 /forum-3d、/github 的只剩路由表和论坛窗口里写明的「3D 版块」", () => {
    const hits = sources(PORTAL)
      .filter((file) => /["'`]\/(forum-3d|github)["'`]/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(PORTAL.length))
      .sort();
    expect(hits).toEqual(["App.tsx", "components/os/Windows.tsx"]);
    expect(readFileSync(`${PORTAL}components/os/Windows.tsx`, "utf8")).toMatch(/<Link className="pt-btn" to="\/forum-3d">\s*<Icon name="sparkling-line" size=\{15\} \/> 3D 版块/);
  });

  it("「加入我们」回执里的「去论坛看看」和桌面上的论坛应用取同一个地址", () => {
    const join = readFileSync(`${PORTAL}pages/JoinUs.tsx`, "utf8");
    expect(join).toMatch(/const forumLink = appLinkById\("forum"\)/);
    expect(join).toMatch(/<a className="pt-btn" href=\{forumLink\.href\}[^>]*>\s*去论坛看看/);
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
    // lib/org.ts 的默认称号与部门用服务端的 Carbon 图标名，渲染前经 ORG_ICONS 换成注册表里的图标，单独核对
    const carbon = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const org = file.slice(PORTAL.length) === "lib/org.ts";
      for (const match of text.matchAll(/<Icon\s+name="([a-z0-9-]+)"/g)) used.add(match[1]);
      for (const match of text.matchAll(/\bicon:\s*"([a-z0-9-]+)"/g)) (org ? carbon : used).add(match[1]);
      for (const match of text.matchAll(/drawIcon\(\s*\w+,\s*"([a-z0-9-]+)"/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter((name) => !isIconName(name))).toEqual([]);
    expect(carbon.size).toBeGreaterThan(5);
    expect([...carbon].filter((name) => !(name in ORG_ICONS))).toEqual([]);
    expect(Object.values(ORG_ICONS).filter((name) => !isIconName(name))).toEqual([]);
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
