// 投递管理按人合并（#184）的展示逻辑：归并理由怎么说、列表一人一行加展开后的历次投递、列表上方那一行数字。
// 归并本身在服务端算（GET /api/console/applications 的 person），这里只排版。不导入 Vue，tests/console/application-groups.test.ts 直接测。
import { APPLICATION_STATUS, isApplicationStatus } from "./statuses";
import type { ApplicationItem, ApplicationList, ApplicationSummary, GroupReason } from "./types";

export const GROUP_REASON_LABEL: Record<GroupReason, string> = { email: "同一邮箱", name_class: "姓名班级相同" };

/** 归并理由的说法；不认识的原样显示。 */
export function reasonLabels(reasons: readonly string[]): string[] {
  return reasons.map(reason => GROUP_REASON_LABEL[reason as GroupReason] ?? reason);
}

export type PersonRow = {
  kind: "person"; key: string; personKey: string; item: ApplicationItem;
  /** 筛选结果里这个人有几份；多于一份才能展开 */
  shown: number; expandable: boolean; expanded: boolean;
  /** 这个人还有几份不在当前筛选结果里 */
  hidden: number;
};
export type HistoryRow = {
  kind: "history"; key: string; personKey: string; application: ApplicationSummary & { linked_by: GroupReason[] };
  /** 这一份的姓名或班级和这一行的人（主记录）写得不一样：只靠邮箱连上的，要把这一份自己写的名字显示出来 */
  nameDiffers: boolean;
};
export type ListRow = PersonRow | HistoryRow;

/**
 * 表格的行：一人一行；展开的人下面紧跟他在筛选结果里的每一份投递（时间、来源邮箱、状态）。
 * 只有一份的人不展开。旧服务端没有 person 时按一人一份处理。
 */
export function listRows(items: readonly ApplicationItem[], expanded: ReadonlySet<string>): ListRow[] {
  const rows: ListRow[] = [];
  for (const item of items) {
    const key = item.person?.key ?? item.id;
    const applications = item.person?.applications ?? [];
    const shown = Math.max(1, applications.length);
    const expandable = applications.length > 1;
    const open = expandable && expanded.has(key);
    rows.push({ kind: "person", key: `person:${key}`, personKey: key, item, shown, expandable, expanded: open, hidden: Math.max(0, (item.person?.size ?? shown) - shown) });
    if (!open) continue;
    for (const application of applications) rows.push({
      kind: "history", key: `history:${key}:${application.id}`, personKey: key, application,
      nameDiffers: application.name !== item.name || application.class_name !== item.class_name,
    });
  }
  return rows;
}

/** 展开或收起一个人；返回新的集合，不改原来的。 */
export function toggleExpanded(expanded: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * 列表上方的一行：「共 7 人、10 份投递」「「已取消」：1 人、1 份投递」「搜索结果：1 人、1 份投递」。
 * 不带搜索时这里的份数就是筛选按钮上的数字（服务端保证）。旧服务端没有 total_applications 时只说人数。
 */
export function listSummary(list: Pick<ApplicationList, "total"> & { total_applications?: number }, status: string, searching: boolean): string {
  const label = isApplicationStatus(status) ? APPLICATION_STATUS[status].label : "";
  const head = label ? (searching ? `「${label}」里的搜索结果：` : `「${label}」：`) : searching ? "搜索结果：" : "共 ";
  const applications = typeof list.total_applications === "number" ? `、${list.total_applications} 份投递` : "";
  return `${head}${list.total} 人${applications}`;
}

/** 「全部」的数字：各状态投递份数之和（counts 是整张表的，和筛选、搜索无关）。 */
export function totalCount(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce((sum, n) => sum + n, 0);
}
