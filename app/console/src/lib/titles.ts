// 称号的显示与编辑规则。纯函数，tests/console 直接测。
// 称号的名字、英文标签、图标、色调、说明和权限包都是数据：/api/console/catalogue 下发，提督在控制台里改。
// 本文件的 DEFAULT_TITLES 是控制台里唯一写死称号的地方，只在 catalogue 还没加载或读不到时兜底。
import type { Capability, Catalogue, CatalogueTitle, DepartmentView, TitleConfig, TitleId, TitlePatch, Tone, TitleView } from "./types";

/** 服务端 roles.ts 的 TONES；catalogue 还没加载时用它兜底，避免徽章闪成默认蓝。 */
export const FALLBACK_TONES: Record<Tone, string> = {
  amber: "#855700", cobalt: "#3346C8", violet: "#6E44C9", jade: "#18694A",
  sky: "#08609A", coral: "#A63F16", rose: "#B4235A", slate: "#5B6475",
};

/** 色调的中文名，给编辑称号时的色调选择用（色板本身固定在服务端代码里）。 */
export const TONE_NAMES: Record<Tone, string> = {
  amber: "琥珀", cobalt: "钴蓝", violet: "紫罗兰", jade: "翡翠绿",
  sky: "天蓝", coral: "珊瑚红", rose: "玫红", slate: "石板灰",
};

/**
 * 服务端 roles.ts 的称号默认值（顺序同 catalogue.titles）。只在 catalogue 不可用时兜底，
 * 一旦 catalogue 到了，名字、标签、图标、色调、说明一律以它为准。tests/console/mock-sync.test.ts 核对与服务端一致。
 */
export const DEFAULT_TITLES: readonly CatalogueTitle[] = [
  { id: "admin", label: "提督", tag: "ADMIRAL", icon: "user-admin", tone: "violet", rank: 0, description: "GitHub 组织的所有者，拥有全部权限，任命舰长" },
  { id: "captain", label: "舰长", tag: "CAPTAIN", icon: "star-filled", tone: "amber", rank: 1, description: "带领全班，权限仅次于提督" },
  { id: "head", label: "队长", tag: "LEADER", icon: "badge", tone: "cobalt", rank: 2, description: "负责一个部门的日常事务" },
  { id: "member", label: "舰员", tag: "CREW", icon: "code", tone: "sky", rank: 5, description: "在读成员；加入 GitHub 组织后自动获得" },
  { id: "alumni", label: "领航员", tag: "NAVIGATOR", icon: "compass", tone: "jade", rank: 4, description: "已毕业的学长学姐" },
  { id: "guest", label: "乘客", tag: "PASSENGER", icon: "user", tone: "slate", rank: 9, description: "没登录的人，只能看帖子" },
];
/** 带部门的 member：排在队长之后，中性色调。同服务端 CREW_TITLE。 */
export const DEFAULT_CREW: Catalogue["crew"] = { tag: "CREW", tone: "slate", rank: 3 };

export const toneColor = (tone: Tone, catalogue?: Catalogue | null) => catalogue?.tones[tone] ?? FALLBACK_TONES[tone];

/** 某个称号当前的显示设置：优先 catalogue，没有时用默认值。 */
export function titleDef(id: TitleId, catalogue?: Catalogue | null): CatalogueTitle {
  return catalogue?.titles.find(item => item.id === id) ?? DEFAULT_TITLES.find(item => item.id === id)!;
}
export const titleLabel = (id: TitleId, catalogue?: Catalogue | null) => titleDef(id, catalogue).label;
const crewOf = (catalogue?: Catalogue | null) => catalogue?.crew ?? DEFAULT_CREW;

/** 能指派称号的人（admin 与 captain），用在「请联系……」一类的提示里。 */
export const assignerText = (catalogue?: Catalogue | null) => `${titleLabel("admin", catalogue)}或${titleLabel("captain", catalogue)}`;

/** 名单里的称号类别：带部门的 member 是 crew，不带的是 member。 */
export type PeopleKind = "admin" | "captain" | "head" | "crew" | "member" | "alumni";
export type TitleKind = PeopleKind | "guest";

export function titleKind(title: Pick<TitleView, "id" | "department">): TitleKind {
  if (title.id === "member") return title.department ? "crew" : "member";
  return title.id;
}

/** 类别的名字：crew 是「部门」+ member 的名字，其余就是称号的名字。 */
export function kindLabel(kind: TitleKind, catalogue?: Catalogue | null): string {
  return kind === "crew" ? `部门${titleLabel("member", catalogue)}` : titleLabel(kind, catalogue);
}

/** 类别的层级（越小越靠前）：只有层级是服务端代码里固定的。 */
export function kindRank(kind: TitleKind, catalogue?: Catalogue | null): number {
  return kind === "crew" ? crewOf(catalogue).rank : titleDef(kind, catalogue).rank;
}

/**
 * 与服务端 titleView 同一规则拼出称号：head 显示「部门名 · 名字」并用部门的图标和色调；
 * 带部门的 member 显示「部门名 · 名字」，用部门图标和中性色调；其余直接用称号自己的设置。
 */
export function makeTitle(
  id: TitleId,
  department: DepartmentView | null,
  catalogue?: Catalogue | null,
  origin: Pick<TitleView, "source" | "assignment_id"> = { source: "assignment", assignment_id: null },
): TitleView {
  const base = titleDef(id, catalogue);
  if (id === "head") {
    return {
      ...origin, id, label: department ? `${department.name} · ${base.label}` : base.label, tag: base.tag,
      icon: department?.icon ?? base.icon, tone: department?.tone ?? base.tone, department,
    };
  }
  if (id === "member" && department) {
    return { ...origin, id, label: `${department.name} · ${base.label}`, tag: base.tag, icon: department.icon, tone: crewOf(catalogue).tone, department };
  }
  return { ...origin, id, label: base.label, tag: base.tag, icon: base.icon, tone: base.tone, department: null };
}

/** 徽章色调：head 跟部门走，其余用称号自己的色调（都来自 catalogue）。 */
export function badgeTone(title: Pick<TitleView, "id" | "tone" | "department">): Tone {
  if (title.id === "head" && title.department) return title.department.tone;
  return title.tone;
}

/** 蕴含关系的闭包：持有左边即同时获得右边。 */
export function closure(values: Iterable<Capability>, implies: Record<string, Capability[]> = {}): Set<Capability> {
  const result = new Set<Capability>(values);
  const queue = [...result];
  while (queue.length) {
    for (const implied of implies[queue.pop()!] ?? []) {
      if (!result.has(implied)) { result.add(implied); queue.push(implied); }
    }
  }
  return result;
}

/**
 * 与服务端 titleBundleError 同一规则：admin 永远是全部权限、guest 没有权限，这两个的权限包不能改；
 * `captainOnly`（catalogue.captain_only）里的能力除了 admin 只能放进 captain 的权限包。
 */
export function titleBundleError(id: TitleId, bundle: readonly Capability[], captainOnly: readonly Capability[]): "title_capabilities_fixed" | "captain_only_capability" | null {
  if (id === "admin" || id === "guest") return "title_capabilities_fixed";
  if (id !== "captain" && bundle.some(capability => captainOnly.includes(capability))) return "captain_only_capability";
  return null;
}

export const TITLE_TAG = /^[A-Z][A-Z0-9-]{1,15}$/;
export const TITLE_LABEL_MAX = 8;
export const TITLE_DESCRIPTION_MAX = 200;
/** 按字符（码点）计数，与服务端 JSON Schema 的 maxLength 一致。 */
const charCount = (value: string) => [...value].length;

export type TitleDraft = Omit<TitleConfig, "id">;
export type TitleDraftErrors = Partial<Record<"label" | "tag" | "description", string>>;

/** 提交前按服务端的校验规则检查（名字 1-8 个字、英文标签格式、说明不超过 200 字）。 */
export function titleDraftErrors(draft: Pick<TitleDraft, "label" | "tag" | "description">): TitleDraftErrors {
  const errors: TitleDraftErrors = {};
  const label = draft.label.trim();
  if (!label) errors.label = "名字不能为空。";
  else if (charCount(label) > TITLE_LABEL_MAX) errors.label = `名字最多 ${TITLE_LABEL_MAX} 个字。`;
  if (!TITLE_TAG.test(draft.tag.trim())) errors.tag = "以大写字母开头，2 到 16 位，只能用大写字母、数字和连字符。";
  if (charCount(draft.description.trim()) > TITLE_DESCRIPTION_MAX) errors.description = `说明最多 ${TITLE_DESCRIPTION_MAX} 个字。`;
  return errors;
}

/** 只提交改动的字段；文字去掉首尾空白，权限包按集合比较（顺序不算改动）。 */
export function titlePatch(original: TitleConfig, draft: TitleDraft): TitlePatch {
  const patch: TitlePatch = {};
  for (const key of ["label", "tag", "description"] as const) {
    const value = draft[key].trim();
    if (value !== original[key]) patch[key] = value;
  }
  if (draft.icon !== original.icon) patch.icon = draft.icon;
  if (draft.tone !== original.tone) patch.tone = draft.tone;
  const before = new Set(original.capabilities);
  const after = new Set(draft.capabilities);
  if (before.size !== after.size || [...after].some(id => !before.has(id))) patch.capabilities = [...draft.capabilities];
  return patch;
}
