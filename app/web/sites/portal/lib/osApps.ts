// YUGC OS 的应用清单、启动器过滤、终端命令与时间文案（纯逻辑，tests/web/portal-os.test.ts 覆盖）。
// 链接的实际地址在组件里按站点规则解析（externalUrl / Router），这里只描述「打开什么」。
import type { IconName } from "./icons";

export type AppId = "join" | "forum" | "github" | "about" | "org" | "terminal" | "feedback" | "console" | "wallpaper";

/** scene：进入官网内的 3D 场景页；window：在桌面里开窗口；panel：桌面自带的面板（换壁纸）；route：站内普通页面；site：跨站 */
export type AppOpen =
  | { kind: "scene"; path: "/join-us" | "/forum-3d" | "/github" }
  | { kind: "window" }
  | { kind: "panel" }
  | { kind: "route"; path: string }
  | { kind: "site"; site: "admin"; path: string };

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
};

export const OS_APPS: readonly OsApp[] = [
  { id: "join", name: "加入我们", icon: "mail-send-line", tint: "#3346c8", key: "1", primary: true, open: { kind: "scene", path: "/join-us" }, blurb: "写封信报名，我们用邮件联系你" },
  { id: "forum", name: "论坛", icon: "discuss-line", tint: "#5b5fd6", key: "2", open: { kind: "scene", path: "/forum-3d" }, blurb: "班级公告，课程、竞赛和求职讨论" },
  { id: "github", name: "GitHub 组织", icon: "github-line", tint: "#1b2140", key: "3", open: { kind: "scene", path: "/github" }, blurb: "极客班的公开仓库" },
  { id: "about", name: "关于极客班", icon: "book-2-line", tint: "#0e8fc9", open: { kind: "window" }, blurb: "极客班是做什么的" },
  { id: "org", name: "组织架构", icon: "organization-chart", tint: "#128a7e", open: { kind: "window" }, blurb: "提督、舰长、各部门的队长和舰员" },
  { id: "terminal", name: "终端", icon: "terminal-box-line", tint: "#2b3150", open: { kind: "window" }, blurb: "输入 help 查看命令" },
  { id: "wallpaper", name: "壁纸", icon: "image-line", tint: "#0e9f8f", open: { kind: "panel" }, blurb: "换一张桌面壁纸" },
  { id: "feedback", name: "意见箱", icon: "feedback-line", tint: "#c9821a", open: { kind: "route", path: "/feedback" }, blurb: "提建议或报 bug，不用登录" },
  { id: "console", name: "控制台", icon: "shield-user-line", tint: "#c9453c", lock: true, open: { kind: "site", site: "admin", path: "/console" }, blurb: "成员用 GitHub 账号登录" },
];

export function appById(id: string): OsApp | undefined {
  return OS_APPS.find((app) => app.id === id);
}

export function appByKey(key: string): OsApp | undefined {
  return OS_APPS.find((app) => app.key === key);
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

export function launcherCommands(): LauncherCommand[] {
  return [
    ...OS_APPS.map((app) => ({ id: `app:${app.id}`, label: app.name, hint: app.blurb, icon: app.icon, keywords: `${app.id} ${app.name}` })),
    { id: "forum-home", label: "进入论坛首页", hint: "全部话题", icon: "external-link-line", keywords: "forum home 论坛 首页 bbs" },
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

export function runTerminal(input: string, repos: readonly RepoSnapshot[]): TerminalResult {
  const [command = "", ...rest] = input.trim().split(/\s+/);
  const echo: TerminalLine = { kind: "echo", text: input.trim() };
  if (!command) return { lines: [echo] };
  const reply = (lines: TerminalLine[], open?: AppId): TerminalResult => ({ lines: [echo, ...lines], open });
  switch (command) {
    case "help":
      return reply(HELP.map(([key, text]) => ({ kind: "out", key, text })));
    case "ls":
      return reply(OS_APPS.map((app) => ({ kind: "out", key: app.id, text: app.name })));
    case "clear":
      return { lines: [], clear: true };
    case "whoami":
      return reply([{ kind: "out", text: "乘客（官网不需要登录）" }]);
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
      const app = appById(rest[0] ?? "");
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
