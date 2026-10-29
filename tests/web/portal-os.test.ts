import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICONS, isIconName } from "../../app/web/sites/portal/lib/icons";
import { bindEmailHref, emailRequired, parseMe } from "../../app/web/sites/portal/lib/account";
import { links } from "../../app/web/sites/portal/lib/links";
import type { CodeProject } from "../../app/web/sites/portal/lib/codeRepos";
import { OS_APPS, agoLabel, appById, appByKey, appLink, appLinkById, filterCommands, followAppLink, launcherCommands, moveSelection, visibleApps } from "../../app/web/sites/portal/lib/osApps";
import { createShell } from "../../app/web/sites/portal/lib/shell";

const terminal = (apps: ReturnType<typeof visibleApps>, repos: CodeProject[] = []) => createShell({ account: null, apps, repos, storage: null });

const PORTAL = new URL("../../app/web/sites/portal/", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("控制台入口只给 console_link 为 true 的人", () => {
  it("/auth/me 的 console_link 原样读出，缺失或不是 true 都当作 false；account_id 读出极客班账号", () => {
    expect(parseMe({ signed_in: true, login: "ada", avatar_url: null, console_link: true, account_id: "acc_1" })).toMatchObject({
      login: "ada", avatarUrl: null, consoleLink: true, accountId: "acc_1",
    });
    expect(parseMe({ signed_in: true, login: "ada", avatar_url: null, console_link: true })).toMatchObject({
      login: "ada", avatarUrl: null, consoleLink: true, accountId: null,
    });
    // 旧会话没有 account_id：比赛窗口靠它为 null 判断认不出「我」，不当成空字符串
    expect(parseMe({ signed_in: true, login: "ada", account_id: "" })?.accountId).toBeNull();
    expect(parseMe({ signed_in: true, login: "ada", account_id: 7 })?.accountId).toBeNull();
    expect(parseMe({ signed_in: true, login: "ada", avatar_url: null })?.consoleLink).toBe(false);
    expect(parseMe({ signed_in: true, login: "ada", console_link: "true" })?.consoleLink).toBe(false);
    expect(parseMe({ signed_in: false })).toBeNull();
  });

  it("账号还没有登录邮箱（#273）：只认已登录且 email_required 为 true，跳到绑定邮箱页时带上本站路径", () => {
    expect(emailRequired({ signed_in: true, login: "ada", email_required: true })).toBe(true);
    for (const body of [null, {}, { signed_in: true, login: "ada" }, { signed_in: true, login: "ada", email_required: "true" }, { signed_in: false, email_required: true }]) {
      expect(emailRequired(body)).toBe(false);
    }
    expect(bindEmailHref("/competitions/7?tab=teams#me")).toBe("/bind-email?return_to=%2Fcompetitions%2F7%3Ftab%3Dteams%23me");
    expect(bindEmailHref("//evil.test/")).toBe("/bind-email?return_to=%2F");
  });

  it("没有 console_link：桌面、Dock、启动器、终端里都没有控制台，其余应用照旧", () => {
    const apps = visibleApps(false);
    expect(apps.map((app) => app.id)).toEqual(OS_APPS.map((app) => app.id).filter((id) => id !== "console"));
    expect(launcherCommands(apps).map((command) => command.id)).not.toContain("app:console");
    const shell = terminal(apps);
    expect(shell.run("ls ~/Desktop").lines.map((line) => line.text).join("\n")).not.toContain("console");
    const hidden = shell.run("open console");
    expect(hidden.open).toEqual([]);
    expect(hidden.lines.at(-1)?.kind).toBe("err");
  });

  it("有 console_link：控制台和其它应用一起出现，能从终端打开", () => {
    const apps = visibleApps(true);
    expect(apps).toEqual(OS_APPS);
    expect(launcherCommands(apps).map((command) => command.id)).toContain("app:console");
    expect(terminal(apps).run("open console").open).toEqual(["console"]);
  });

  it("页脚与资料卡里的控制台链接都看 consoleLink", () => {
    const shell = readFileSync(`${PORTAL}components/PageShell.tsx`, "utf8");
    const card = readFileSync(`${PORTAL}components/os/ProfileCard.tsx`, "utf8");
    const os = readFileSync(`${PORTAL}components/os/YugcOs.tsx`, "utf8");
    expect(shell).toMatch(/consoleLink && <a href=\{links\.console\(\)\}>控制台<\/a>/);
    expect(card).toMatch(/account\.consoleLink && <a href=\{links\.console\(\)\}>控制台<\/a>/);
    expect(os).not.toMatch(/OS_APPS\.map/);
  });
});

describe("YUGC OS 应用与启动器", () => {
  it("三个主入口有 1/2/3 快捷键，加入我们是唯一的主操作", () => {
    expect(appByKey("1")?.id).toBe("join");
    expect(appByKey("2")?.id).toBe("forum");
    expect(appByKey("3")?.id).toBe("gitlab");
    // GitHub 组织应用删掉了（#275）：代码放在自建的代码仓库
    expect(appById("github")).toBeUndefined();
    expect(OS_APPS.filter((app) => app.primary).map((app) => app.id)).toEqual(["join"]);
    expect(new Set(OS_APPS.map((app) => app.id)).size).toBe(OS_APPS.length);
  });

  it("入口指向：加入我们（#279）和意见箱（#275）在桌面开窗口，论坛直达（#185），代码仓库直达（#311），控制台 /console", () => {
    const open = Object.fromEntries(OS_APPS.map((app) => [app.id, app.open]));
    expect(open.join).toEqual({ kind: "window" });
    expect(open.forum).toEqual({ kind: "site", link: "forumHome" });
    expect(open.gitlab).toEqual({ kind: "site", link: "gitlab" });
    expect(open.github).toBeUndefined();
    expect(open.feedback).toEqual({ kind: "window" });
    expect(open.console).toEqual({ kind: "site", link: "console" });
    // 没有哪个应用再经过 /forum-3d、/github 场景页
    expect(JSON.stringify(OS_APPS)).not.toMatch(/forum-3d|"\/github"/);
  });

  it("站外应用的地址与打开方式：论坛、代码仓库、控制台当前标签页；留在官网里的应用没有站外地址", () => {
    expect(appLink(appById("forum")!)).toEqual({ href: links.forumHome(), newTab: false });
    expect(appLink(appById("gitlab")!)).toEqual({ href: links.gitlab(), newTab: false });
    expect(appLink(appById("console")!)).toEqual({ href: links.console(), newTab: false });
    for (const id of ["join", "promo", "about", "org", "competitions", "terminal", "wallpaper", "feedback"]) expect(appLink(appById(id)!), id).toBeNull();
    expect(appLinkById("forum")).toEqual({ href: links.forumHome(), newTab: false });
    expect(appLinkById("gitlab")).toEqual({ href: links.gitlab(), newTab: false });
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
    expect(filterCommands(commands, "github")).toEqual([]);
    expect(filterCommands(commands, "gitlab")[0].id).toBe("app:gitlab");
    expect(filterCommands(commands, "代码")[0].id).toBe("app:gitlab");
    expect(filterCommands(commands, "zzz-没有这个")).toEqual([]);
  });

  it("上下选择两端夹紧", () => {
    expect(moveSelection(0, -1, 5)).toBe(0);
    expect(moveSelection(4, 1, 5)).toBe(4);
    expect(moveSelection(2, 1, 5)).toBe(3);
    expect(moveSelection(3, 1, 0)).toBe(0);
  });

  it("终端命令：help 有说明，join 和桌面应用能打开，repos 列代码仓库里的公开项目", () => {
    const repos: CodeProject[] = [
      { name: "geek-cli", path: "geek/geek-cli", description: "CLI", url: "https://git.example.invalid/geek/geek-cli", cloneUrl: "", activeAt: null },
      { name: "notes", path: "geek/notes", description: "", url: "https://git.example.invalid/geek/notes", cloneUrl: "", activeAt: null },
    ];
    const shell = terminal(visibleApps(false), repos);
    expect(shell.run("help").lines.length).toBeGreaterThan(3);
    expect(shell.run("./join --yugc").open).toEqual(["join"]);
    expect(shell.run("open github")).toMatchObject({ open: [] });
    expect(shell.run("open gitlab").open).toEqual(["gitlab"]);
    expect(shell.run("open nope").lines.at(-1)?.kind).toBe("err");
    const listed = shell.run("repos").lines.map((line) => line.text).join("\n");
    expect(listed).toContain("https://git.example.invalid/geek/geek-cli");
    expect(listed).toContain("geek/notes");
    expect(shell.run("clear")).toMatchObject({ lines: [], clear: true });
    expect(shell.run("rm -rf /").lines.at(-1)?.kind).toBe("err");
  });
});

describe("入口直达，不再经过 3D 场景页（#185）", () => {
  it("源码里指向 /forum-3d、/github 的只剩路由表和论坛窗口里写明的「3D 版块」", () => {
    const hits = sources(PORTAL)
      .filter((file) => /["'`]\/(forum-3d|github)["'`]/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(PORTAL.length))
      .sort();
    // Windows.tsx 里那一处是「论坛最新」窗口的「3D 版块」按钮，渲染后点下去进 /forum-3d 由 portal-os-entries.test.tsx 核对
    expect(hits).toEqual(["App.tsx", "components/os/Windows.tsx"]);
  });

  it("「加入我们」窗口回执里的「去论坛看看」和桌面上的论坛应用取同一个地址：论坛首页，当前标签页", () => {
    expect(appLinkById("forum")).toEqual({ href: links.forumHome(), newTab: false });
    // 只认取地址的那一句，不认 JSX 的写法（属性顺序、换行改了不影响）
    expect(readFileSync(`${PORTAL}components/os/JoinBox.tsx`, "utf8")).toMatch(/appLinkById\("forum"\)/);
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
