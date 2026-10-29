// YUGC OS 的应用清单、启动器过滤与时间文案（纯逻辑，tests/web/portal-os.test.ts 覆盖）；终端在 ./shell（#279）。
// 每个应用打开什么只写在 OS_APPS 里：桌面图标、Dock、1/2/3、菜单栏「前往」、⌘K、便签、终端和「加入我们」窗口的回执都从这里取。
// 去别的站点的应用（论坛、控制台）只写指向 ./links 里的哪一条，由 appLink 解析成地址；地址规则仍只在 ./links。
import type { IconName } from "./icons";
import { links } from "./links";

export type AppId = "join" | "forum" | "gitlab" | "promo" | "about" | "org" | "competitions" | "terminal" | "feedback" | "console" | "wallpaper";

/**
 * window：在桌面里开窗口；panel：桌面自带的全屏面板（换壁纸）；site：同一个域名下的另一个端（论坛、控制台），当前标签页整页跳过去。
 * 论坛点一下直达论坛首页（#185），不再先进 /forum-3d 场景页；那个页面留给旧地址和「论坛最新」窗口里的「3D 版块」。
 * 「代码仓库」「意见箱」（#275）、「加入我们」（#279）和「宣传片」（#284，原来是全屏面板）都是桌面里的窗口，不再跳到单独的页面；旧地址 /feedback、/join-us、/apply
 * 跳到 /?open=<id>，进桌面打开对应窗口。
 */
export type AppOpen =
  | { kind: "window" }
  | { kind: "panel"; panel: "wallpaper" }
  | { kind: "site"; link: "forumHome" | "console" | "gitlab" };

export type OsApp = {
  id: AppId;
  name: string;
  icon: IconName;
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
  { id: "join", name: "加入我们", icon: "mail-send-line", key: "1", primary: true, open: { kind: "window" }, blurb: "写封信报名，我们用邮件联系你" },
  { id: "forum", name: "论坛", icon: "discuss-line", key: "2", open: { kind: "site", link: "forumHome" }, blurb: "班级公告，课程、竞赛和求职讨论", keywords: "bbs home 首页" },
  { id: "gitlab", name: "代码仓库", icon: "git-repository-line", key: "3", open: { kind: "site", link: "gitlab" }, blurb: "极客班自己的 GitLab，用极客班账号登录", keywords: "gitlab git repo code 代码 仓库" },
  { id: "promo", name: "宣传片", icon: "film-line", open: { kind: "window" }, blurb: "极客班宣传片，1 分 45 秒" },
  { id: "about", name: "关于极客班", icon: "book-2-line", open: { kind: "window" }, blurb: "极客班是做什么的" },
  { id: "org", name: "组织架构", icon: "organization-chart", open: { kind: "window" }, blurb: "有哪些部门，谁负责什么" },
  { id: "competitions", name: "比赛", icon: "trophy-line", open: { kind: "window" }, blurb: "近期有什么比赛，哪天截止", keywords: "contest 赛事 竞赛 报名" },
  { id: "terminal", name: "终端", icon: "terminal-box-line", open: { kind: "window" }, blurb: "输入 help 查看命令" },
  { id: "wallpaper", name: "壁纸", icon: "image-line", open: { kind: "panel", panel: "wallpaper" }, blurb: "换一张桌面壁纸" },
  { id: "feedback", name: "意见箱", icon: "feedback-line", open: { kind: "window" }, blurb: "提建议或报 bug，不用登录" },
  { id: "console", name: "控制台", icon: "shield-user-line", lock: true, open: { kind: "site", link: "console" }, blurb: "管理组织、成员和论坛" },
];

/** 图标方块的底色：YUGC 四个字母的品牌色（styles/portal.css 的 --os-y/-u/-g/-c） */
export type AppTone = "y" | "u" | "g" | "c";
const TONES: readonly AppTone[] = ["y", "u", "g", "c"];

/** 按应用在 OS_APPS 里的顺序在四个字母色里轮换（SPEC §4.2）；同一个应用在桌面、Dock、启动动画里颜色一样 */
export function appTone(app: OsApp): AppTone {
  return TONES[Math.max(0, OS_APPS.findIndex((candidate) => candidate.id === app.id)) % TONES.length];
}

/** 招新关着时「加入我们」图标、启动器和终端里的说明（#284）：不再写「报名」，窗口里是招新暂未开放的页面 */
const JOIN_CLOSED_BLURB = "招新暂未开放";

/**
 * 这个人能看到的应用：控制台只给在里面能管点什么的人（`/auth/me` 的 `console_link`）；没登录和没有管理能力的人，
 * 桌面、Dock、菜单、启动器和终端里都没有它。控制台自己的准入不变。
 * `applyOpen` 是招新总开关（lib/applyOpen.ts）：关着时「加入我们」的说明换成「招新暂未开放」，应用本身仍在，点开是关闭页。
 */
export function visibleApps(consoleLink: boolean, applyOpen = true): OsApp[] {
  return OS_APPS.filter((app) => consoleLink || app.id !== "console").map((app) => (app.id === "join" && !applyOpen ? { ...app, blurb: JOIN_CLOSED_BLURB } : app));
}

export function appById(id: string): OsApp | undefined {
  return OS_APPS.find((app) => app.id === id);
}

export function appByKey(key: string): OsApp | undefined {
  return OS_APPS.find((app) => app.key === key);
}

export type AppLink = { href: string; newTab: boolean };

/** 去别的站点的应用指向哪里：本域名下的论坛和控制台，在当前标签页打开（和官网其它论坛链接一样）。留在官网里的应用返回 null。 */
export function appLink(app: OsApp): AppLink | null {
  return app.open.kind === "site" ? { href: links[app.open.link](), newTab: false } : null;
}

/**
 * 打开站外应用：新标签页（noopener，不带 referrer，和页脚的 rel="noreferrer" 一样）或当前标签页整页跳转。
 * 要在点击（按键）的当下同步调用：放进计时器里的新标签页，浏览器可能当成弹窗拦掉。
 */
export function followAppLink(link: AppLink, win: Pick<Window, "open" | "location"> = window): void {
  if (link.newTab) win.open(link.href, "_blank", "noopener,noreferrer");
  else win.location.assign(link.href);
}

/**
 * 点下去在新标签页打开的链接（代码仓库里的项目、比赛官网）给读屏补的一句：焦点会直接跑到新标签页，先说一声。
 * 只放进视觉上隐藏的 .pt-sr 里，界面上看不到。
 */
export const NEW_TAB_NOTE = "（新标签页打开）";

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

// ── 时间 ───────────────────────────────────────────────────────────────

/** 距今多久（中文）：今天 / N 天前 / N 个月前 / N 年前 */
export function agoLabel(timestamp: number, now: number): string {
  const days = Math.max(0, (now - timestamp) / 864e5);
  if (days < 1) return "今天";
  if (days < 30) return `${Math.floor(days)} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}
