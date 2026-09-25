// 组织架构的数据：称号与部门都由提督在控制台改（名字、标签、图标、色调、说明），官网读 GET /api/public/org。
// 代码里固定的只有称号 id（admin/captain/head/member/alumni/guest）和调色板的色调 id。
// ORG_DEFAULTS 与服务端 app/server/src/lib/roles.ts 的 DEFAULT_TITLE_CONFIGS / DEFAULT_DEPARTMENTS 一致
// （tests/web/portal-org.test.ts 核对），只在数据还没到或读不到时顶上：窗口不会空着，也不会闪成报错。
import { useEffect, useState } from "react";
import { api } from "@shared/lib/api";
import type { IconName } from "./icons";

export type OrgTitleId = "admin" | "captain" | "head" | "member" | "alumni" | "guest";
export type OrgTitle = { id: OrgTitleId; label: string; tag: string; icon: string; tone: string; description: string; rank: number };
export type OrgDepartment = { id: string; name: string; tag: string; icon: string; tone: string; description: string };
/** GET /api/public/org 的响应：色调 id → 色值，称号按 admin、captain、head、member、alumni、guest 排，部门按排序、不含已归档。 */
export type OrgPayload = { tones: Record<string, string>; titles: OrgTitle[]; departments: OrgDepartment[] };
export type Org = { tones: Record<string, string>; titles: Record<OrgTitleId, OrgTitle>; departments: OrgDepartment[] };

export const ORG_URL = "/api/public/org";

/** 唯一的一份默认值（与服务端默认值逐字一致），只用来顶上还没到的数据。 */
export const ORG_DEFAULTS: OrgPayload = {
  tones: {
    amber: "#855700",
    cobalt: "#3346C8",
    violet: "#6E44C9",
    jade: "#18694A",
    sky: "#08609A",
    coral: "#A63F16",
    rose: "#B4235A",
    slate: "#5B6475",
  },
  titles: [
    { id: "admin", label: "提督", tag: "ADMIRAL", icon: "user-admin", tone: "violet", rank: 0, description: "GitHub 组织的 owner，拥有全部能力，任命舰长" },
    { id: "captain", label: "舰长", tag: "CAPTAIN", icon: "star-filled", tone: "amber", rank: 1, description: "带领全班，权限仅次于提督" },
    { id: "head", label: "队长", tag: "LEADER", icon: "badge", tone: "cobalt", rank: 2, description: "负责一个部门的日常事务" },
    { id: "member", label: "舰员", tag: "CREW", icon: "code", tone: "sky", rank: 5, description: "在读成员；GitHub 组织的 active 成员自动获得" },
    { id: "alumni", label: "领航员", tag: "NAVIGATOR", icon: "compass", tone: "jade", rank: 4, description: "已毕业的学长学姐" },
    { id: "guest", label: "乘客", tag: "PASSENGER", icon: "user", tone: "slate", rank: 9, description: "没登录的人，只能看帖子" },
  ],
  departments: [
    { id: "recruitment", name: "招新部", tag: "RECRUIT", icon: "user-follow", tone: "coral", description: "负责招新宣传、投递评估与面试安排" },
    { id: "tech", name: "技术部", tag: "TECH", icon: "terminal", tone: "jade", description: "负责组织仓库、基础设施与技术规范" },
    { id: "community", name: "社区部", tag: "COMMUNITY", icon: "forum", tone: "rose", description: "负责论坛版务、意见箱与社区氛围" },
    { id: "projects", name: "项目部", tag: "PROJECTS", icon: "application", tone: "cobalt", description: "负责项目立项、协作仓库与项目展示" },
  ],
};

/**
 * 服务端下发的是 Carbon 图标名（论坛和控制台直接用 Carbon），官网只装 Remix 线性图标：逐个按外形对照。
 * 键与服务端 DEPARTMENT_ICONS 完全一致（测试核对）；认不出的名字用中性的圆圈。
 */
export const ORG_ICONS = {
  "star-filled": "star-line",
  badge: "award-line",
  code: "code-s-slash-line",
  compass: "compass-3-line",
  user: "user-line",
  "user-follow": "user-add-line",
  terminal: "terminal-box-line",
  forum: "discuss-line",
  application: "function-line",
  bullhorn: "megaphone-line",
  education: "graduation-cap-line",
  idea: "lightbulb-line",
  trophy: "trophy-line",
  "user-favorite": "user-heart-line",
  "chart-network": "flow-chart",
  "logo-github": "github-line",
  book: "book-open-line",
  "user-admin": "user-follow-line",
} as const satisfies Record<string, IconName>;
export const ORG_FALLBACK_ICON: IconName = "circle-line";

export function orgIcon(name: string): IconName {
  return Object.prototype.hasOwnProperty.call(ORG_ICONS, name) ? ORG_ICONS[name as keyof typeof ORG_ICONS] : ORG_FALLBACK_ICON;
}

/** 色调 id → 色值；认不出的色调用中性灰。 */
export function orgColor(org: Pick<Org, "tones">, tone: string): string {
  return Object.prototype.hasOwnProperty.call(org.tones, tone) ? org.tones[tone] : ORG_DEFAULTS.tones.slate;
}

const HEX = /^#[0-9a-f]{6}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const filled = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value : fallback);
const str = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);

/** 把响应读成组织架构：缺的、类型不对的字段用默认值补上；整份读不出来就是默认值。 */
export function readOrg(body: unknown): Org {
  const data = isRecord(body) ? body : {};
  const tones: Record<string, string> = { ...ORG_DEFAULTS.tones };
  if (isRecord(data.tones)) {
    for (const [id, hex] of Object.entries(data.tones)) if (typeof hex === "string" && HEX.test(hex)) tones[id] = hex;
  }
  const incoming = new Map((Array.isArray(data.titles) ? data.titles : []).filter(isRecord).map((item) => [item.id, item]));
  const titles = Object.fromEntries(
    ORG_DEFAULTS.titles.map((fallback) => {
      const item = incoming.get(fallback.id);
      if (!item) return [fallback.id, fallback];
      return [
        fallback.id,
        {
          id: fallback.id,
          label: filled(item.label, fallback.label),
          tag: filled(item.tag, fallback.tag),
          icon: filled(item.icon, fallback.icon),
          tone: filled(item.tone, fallback.tone),
          description: str(item.description, fallback.description),
          rank: typeof item.rank === "number" ? item.rank : fallback.rank,
        },
      ];
    }),
  ) as Record<OrgTitleId, OrgTitle>;
  const departments = Array.isArray(data.departments)
    ? data.departments
        .filter(isRecord)
        .filter((item) => typeof item.id === "string" && typeof item.name === "string" && item.name.trim() !== "")
        .map((item) => ({
          id: item.id as string,
          name: item.name as string,
          tag: str(item.tag, ""),
          icon: str(item.icon, ""),
          tone: str(item.tone, "slate"),
          description: str(item.description, ""),
        }))
    : ORG_DEFAULTS.departments;
  return { tones, titles, departments };
}

export const DEFAULT_ORG: Org = readOrg(ORG_DEFAULTS);

// ── 组织架构窗口 ────────────────────────────────────────────────────────

export type OrgBadge = { id: string; label: string; icon: IconName; color: string; description: string };
export type OrgChartModel = {
  /** 从上往下的直属链：admin → captain */
  chain: OrgBadge[];
  /** 每个部门一张卡片，卡片上是部门负责人的称号 */
  departments: Array<{ id: string; name: string; icon: IconName; color: string; description: string; head: OrgBadge }>;
  crew: OrgBadge;
  /** 图底部：alumni、guest */
  foot: OrgBadge[];
};

function badge(org: Org, id: OrgTitleId): OrgBadge {
  const title = org.titles[id];
  return { id, label: title.label, icon: orgIcon(title.icon), color: orgColor(org, title.tone), description: title.description };
}

/** 窗口里显示的一切（名字、说明、图标、颜色）都从数据来，结构按称号 id 固定。 */
export function orgChartModel(org: Org): OrgChartModel {
  return {
    chain: [badge(org, "admin"), badge(org, "captain")],
    departments: org.departments.map((department) => {
      const color = orgColor(org, department.tone);
      return {
        id: department.id,
        name: department.name,
        icon: orgIcon(department.icon),
        color,
        description: department.description,
        head: { ...badge(org, "head"), color },
      };
    }),
    crew: badge(org, "member"),
    foot: [badge(org, "alumni"), badge(org, "guest")],
  };
}

/** 「关于极客班」里讲成员和分工的两句话，称号和部门的名字都取自数据。 */
export function orgSummary(org: Org): { members: string; roles: string } {
  const { admin, captain, head, member, alumni } = org.titles;
  const names = org.departments.map((department) => department.name).join("、");
  return {
    members: `在读的同学是${member.label}，毕业的学长学姐是${alumni.label}。`,
    roles: `${admin.label}和${captain.label}总负责${names ? `，下面有${names}，部门里是${head.label}和${member.label}` : ""}`,
  };
}

/** 窗口打开时读一次组织架构，关掉就取消请求；读到之前和读不到时显示默认值。 */
export function useOrg(): Org {
  const [org, setOrg] = useState<Org>(DEFAULT_ORG);
  useEffect(() => {
    const controller = new AbortController();
    api<unknown>(ORG_URL, { signal: controller.signal, headers: { Accept: "application/json" } }).then(
      (body) => {
        if (!controller.signal.aborted) setOrg(readOrg(body));
      },
      () => {
        // 读不到（离线、接口不通、开发预览没有这份数据）就继续显示默认值
      },
    );
    return () => controller.abort();
  }, []);
  return org;
}
