// YUGC OS 的应用清单、启动器过滤、终端命令与时间文案（纯逻辑，tests/web/portal-os.test.ts 覆盖）。
// 每个应用打开什么只写在 OS_APPS 里：桌面图标、Dock、1/2/3、菜单栏「前往」、⌘K、便签、终端和「加入我们」回执页都从这里取。
// 去别的站点的应用（论坛、控制台、GitHub 组织）只写指向 ./links 里的哪一条，由 appLink 解析成地址；地址规则仍只在 ./links。
import type { IconName } from "./icons";
import { links } from "./links";

export type AppId = "join" | "forum" | "github" | "promo" | "about" | "org" | "terminal" | "feedback" | "console" | "wallpaper";

/**
 * scene：进入官网内的 3D 场景页（只有「加入我们」）；window：在桌面里开窗口；panel：桌面自带的全屏面板（换壁纸、重看宣传片）；
 * route：站内普通页面；site：同一个域名下的另一个端（论坛、控制台），当前标签页整页跳过去；
 * external：别人的网站（GitHub 组织），新标签页打开。
 * 论坛与 GitHub 组织点一下直达（#185），不再先进 /forum-3d、/github 场景页；那两个页面留给旧地址，直接打开照常能用。
 */
export type AppOpen =
  | { kind: "scene"; path: "/join-us" }
  | { kind: "window" }
  | { kind: "panel"; panel: "wallpaper" | "promo" }
  | { kind: "route"; path: string }
  | { kind: "site"; link: "forumHome" | "console" }
  | { kind: "external"; link: "githubOrg" };

export type OsApp = {
  id: AppId;
  name: string;
  icon: IconName;
  /** 桌面图标底色（只用于图标方块） */
  tint: string;
  blurb: string;
  open: AppOpen;
  /** 单键快捷键，只给三个主入口 */
  key?: "1" | "2" | "3";
  primary?: boolean;
  lock?: boolean;
  /** 启动器搜索用的额外关键词（名称和 id 之外） */
  keywords?: string;
};

export const OS_APPS: readonly OsApp[] = [
  { id: "join", name: "加入我们", icon: "mail-send-line", tint: "#3346c8", key: "1", primary: true, open: { kind: "scene", path: "/join-us" }, blurb: "写封信报名，我们用邮件联系你" },
  { id: "forum", name: "论坛", icon: "discuss-line", tint: "#5b5fd6", key: "2", open: { kind: "site", link: "forumHome" }, blurb: "班级公告，课程、竞赛和求职讨论", keywords: "bbs home 首页" },
  { id: "github", name: "GitHub 组织", icon: "github-line", tint: "#1b2140", key: "3", open: { kind: "external", link: "githubOrg" }, blurb: "极客班的公开仓库" },
  { id: "promo", name: "宣传片", icon: "film-line", tint: "#d4478a", open: { kind: "panel", panel: "promo" }, blurb: "极客班宣传片，1 分 45 秒" },
  { id: "about", name: "关于极客班", icon: "book-2-line", tint: "#0e8fc9", open: { kind: "window" }, blurb: "极客班是做什么的" },
  { id: "org", name: "组织架构", icon: "organization-chart", tint: "#128a7e", open: { kind: "window" }, blurb: "有哪些部门，谁负责什么" },
  { id: "terminal", name: "终端", icon: "terminal-box-line", tint: "#2b3150", open: { kind: "window" }, blurb: "输入 help 查看命令" },
  { id: "wallpaper", name: "壁纸", icon: "image-line", tint: "#0e9f8f", open: { kind: "panel", panel: "wallpaper" }, blurb: "换一张桌面壁纸" },
  { id: "feedback", name: "意见箱", icon: "feedback-line", tint: "#c9821a", open: { kind: "route", path: "/feedback" }, blurb: "提建议或报 bug，不用登录" },
  { id: "console", name: "控制台", icon: "shield-user-line", tint: "#c9453c", lock: true, open: { kind: "site", link: "console" }, blurb: "管理组织、成员和论坛" },
];

/**
 * 这个人能看到的应用：控制台只给在里面能管点什么的人（`/auth/me` 的 `console_link`）；没登录和没有管理能力的人，
 * 桌面、Dock、菜单、启动器和终端里都没有它。控制台自己的准入不变。
 */
export function visibleApps(consoleLink: boolean): OsApp[] {
  return OS_APPS.filter((app) => consoleLink || app.id !== "console");
}

export function appById(id: string): OsApp | undefined {
  return OS_APPS.find((app) => app.id === id);
}

export function appByKey(key: string): OsApp | undefined {
  return OS_APPS.find((app) => app.key === key);
}

export type AppLink = { href: string; newTab: boolean };

/**
 * 去别的站点的应用指向哪里、怎么打开：本域名下的论坛和控制台在当前标签页打开（和官网其它论坛链接一样）；
 * GitHub 组织在新标签页打开（和页脚、GitHub 场景页里的 GitHub 链接一样）。留在官网里的应用返回 null。
 */
export function appLink(app: OsApp): AppLink | null {
  switch (app.open.kind) {
    case "site":
      return { href: links[app.open.link](), newTab: false };
    case "external":
      return { href: links[app.open.link](), newTab: true };
    default:
      return null;
  }
}

/**
 * 打开站外应用：新标签页（noopener，不带 referrer，和页脚的 rel="noreferrer" 一样）或当前标签页整页跳转。
 * 要在点击（按键）的当下同步调用：放进计时器里的新标签页，浏览器可能当成弹窗拦掉。
 */
export function followAppLink(link: AppLink, win: Pick<Window, "open" | "location"> = window): void {
  if (link.newTab) win.open(link.href, "_blank", "noopener,noreferrer");
  else win.location.assign(link.href);
}

/** 按 id 取应用的站外地址；不是站外应用时抛错（只给写死 id 的调用方用，例如「加入我们」回执页的「去论坛看看」） */
export function appLinkById(id: AppId): AppLink {
  const app = appById(id);
  const link = app ? appLink(app) : null;
  if (!link) throw new Error(`应用 ${id} 不指向别的站点`);
  return link;
}

// ── 启动器（⌘K）──────────────────────────────────────────────────────────

export type LauncherCommand = {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  /** 搜索用的额外关键词（中英文、拼写变体） */
  keywords: string;
};

export function launcherCommands(apps: readonly OsApp[] = OS_APPS): LauncherCommand[] {
  return [
    // 论坛应用本身就直达论坛首页（#185），原来单独的「进入论坛首页」命令和它重复，已并进论坛应用的关键词
    ...apps.map((app) => ({ id: `app:${app.id}`, label: app.name, hint: app.blurb, icon: app.icon, keywords: [app.id, app.name, app.keywords].filter(Boolean).join(" ") })),
    { id: "forum-feed", label: "论坛最新", hint: "最近的话题", icon: "fire-line", keywords: "latest feed 最新 帖子 话题 topic" },
    { id: "docs", label: "文档", hint: "官网和论坛的使用说明", icon: "file-text-line", keywords: "docs 文档 guide 指南 help" },
    { id: "back", label: "回到书桌", hint: "Esc", icon: "arrow-left-line", keywords: "back desk 书桌 返回 exit" },
  ];
}

/**
 * 过滤启动器命令：空查询返回全部；否则按「名称前缀 > 名称包含 > 关键词包含」排序，
 * 大小写与首尾空白不敏感，空白分隔的多个词必须全部命中。
 */
export function filterCommands(commands: readonly LauncherCommand[], query: string): LauncherCommand[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...commands];
  const scored: Array<{ command: LauncherCommand; score: number; index: number }> = [];
  commands.forEach((command, index) => {
    const label = command.label.toLowerCase();
    const haystack = `${label} ${command.keywords.toLowerCase()} ${command.hint.toLowerCase()}`;
    if (!words.every((word) => haystack.includes(word))) return;
    const first = words[0];
    const score = label.startsWith(first) ? 0 : label.includes(first) ? 1 : 2;
    scored.push({ command, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((item) => item.command);
}

/** 在列表里上下移动选中项，两端夹紧；空列表返回 0 */
export function moveSelection(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, current + delta));
}

// ── 终端 ────────────────────────────────────────────────────────────────

export type TerminalLine = { kind: "echo" | "out" | "ok" | "err" | "dim"; text: string; key?: string; href?: string };
export type TerminalResult = { lines: TerminalLine[]; open?: AppId; clear?: boolean };

export type RepoSnapshot = { name: string; description: string | null; language: string | null; pushed: string; url: string; stars: number };

const HELP: Array<[string, string]> = [
  ["help", "显示这份帮助"],
  ["ls", "列出应用"],
  ["open <app>", "打开应用，例如 open forum"],
  ["./join", "打开「加入我们」"],
  ["repos", "列出公开仓库"],
  ["whoami", "显示当前身份"],
  ["clear", "清屏"],
];

export function runTerminal(input: string, repos: readonly RepoSnapshot[], apps: readonly OsApp[] = OS_APPS): TerminalResult {
  const [command = "", ...rest] = input.trim().split(/\s+/);
  const echo: TerminalLine = { kind: "echo", text: input.trim() };
  if (!command) return { lines: [echo] };
  const reply = (lines: TerminalLine[], open?: AppId): TerminalResult => ({ lines: [echo, ...lines], open });
  switch (command) {
    case "help":
      return reply(HELP.map(([key, text]) => ({ kind: "out", key, text })));
    case "ls":
      return reply(apps.map((app) => ({ kind: "out", key: app.id, text: app.name })));
    case "clear":
      return { lines: [], clear: true };
    case "whoami":
      return reply([{ kind: "out", text: "访客（官网不需要登录）" }]);
    case "repos":
      return reply(
        repos.length
          ? repos.map((repo) => ({ kind: "out", key: repo.name, text: `${repo.language ?? "—"} · ${repo.description ?? ""}`, href: repo.url }))
          : [{ kind: "dim", text: "没有公开仓库" }],
      );
    case "./join":
      return reply([{ kind: "ok", text: "打开 加入我们" }], "join");
    case "sudo":
      return reply([{ kind: "err", text: "sudo: 这个终端没有管理员权限。管理组织请用控制台。" }]);
    case "open": {
      const app = apps.find((candidate) => candidate.id === (rest[0] ?? ""));
      if (!app) return reply([{ kind: "err", text: `open: 没有叫 ${rest[0] ?? "（空）"} 的应用，试试 ls` }]);
      return reply([{ kind: "ok", text: `打开 ${app.name}` }], app.id);
    }
    default:
      return reply([{ kind: "err", text: `zsh: command not found: ${command}  试试 help` }]);
  }
}

// ── 时间 ───────────────────────────────────────────────────────────────

/** 距今多久（中文）：今天 / N 天前 / N 个月前 / N 年前 */
export function agoLabel(timestamp: number, now: number): string {
  const days = Math.max(0, (now - timestamp) / 864e5);
  if (days < 1) return "今天";
  if (days < 30) return `${Math.floor(days)} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}
