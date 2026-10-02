import { limitKey } from "./mail/outbox.js";

/**
 * 投递按人归并（#184）：两份投递的邮箱按发信队列的收件箱规则（mail/outbox.ts 的 limitKey：大小写、`+` 标签、
 * Gmail 的点、googlemail.com、IDNA 写法、末尾的点）归并后相同，或者姓名和班级都相同，就算同一个人；
 * 两两连通的投递归成一组（A、B 同邮箱，B、C 姓名班级相同，A、B、C 是一个人）。
 * 只在查询时算，不落库；只用来展示，不自动改任何投递的状态。
 */

export type GroupReason = "email" | "name_class";
export const GROUP_REASONS: readonly GroupReason[] = ["email", "name_class"];

export type GroupableApplication = { id: string; name: string; class_name: string; email: string; created_at: number };
export type GroupMember<T> = T & { linked_by: GroupReason[] };
export type PersonGroup<T> = {
  /** 这个人最早一份投递的 id；导出 CSV 的 person_group 列是同一个值。 */
  key: string;
  /** 这一组为什么归成一个人：组里有没有同邮箱的、有没有姓名班级相同的。只有一份投递时是空的。 */
  reasons: GroupReason[];
  /** 新的在前（created_at DESC, id），和列表原来的顺序一样。 */
  members: GroupMember<T>[];
};

/** 姓名 + 班级的比较键：NFKC（全角数字、字母算半角）、去掉所有空白、转小写。任一项为空时不参与归并。 */
export function nameClassKey(name: string, className: string): string | null {
  const fold = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const [n, c] = [fold(name), fold(className)];
  return n && c ? `${n}\u0000${c}` : null;
}

/** 邮箱的比较键：和发信队列按收件箱限量用同一套规则。 */
export function emailKey(email: string): string | null {
  const key = limitKey(email);
  return key && key !== "@" ? key : null;
}

const newestFirst = (a: GroupableApplication, b: GroupableApplication) => b.created_at - a.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** 把投递按人分组。返回的组按组里最新一份投递排（新的在前）；byId 从投递 id 找到它所在的组。 */
export function groupApplications<T extends GroupableApplication>(rows: readonly T[]): { groups: PersonGroup<T>[]; byId: Map<string, PersonGroup<T>> } {
  const parent = rows.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const keys = rows.map(row => ({ email: emailKey(row.email), name_class: nameClassKey(row.name, row.class_name) }));
  const seen = { email: new Map<string, number>(), name_class: new Map<string, number>() };
  const sizes = { email: new Map<string, number>(), name_class: new Map<string, number>() };
  keys.forEach((key, index) => {
    for (const reason of GROUP_REASONS) {
      const value = key[reason];
      if (value === null) continue;
      sizes[reason].set(value, (sizes[reason].get(value) ?? 0) + 1);
      const first = seen[reason].get(value);
      if (first === undefined) seen[reason].set(value, index);
      else union(first, index);
    }
  });

  const buckets = new Map<number, number[]>();
  rows.forEach((_, index) => {
    const root = find(index);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(index);
    else buckets.set(root, [index]);
  });

  const groups: PersonGroup<T>[] = [];
  const byId = new Map<string, PersonGroup<T>>();
  for (const indexes of buckets.values()) {
    const members = indexes.map(index => {
      const linked_by = GROUP_REASONS.filter(reason => {
        const value = keys[index][reason];
        return value !== null && (sizes[reason].get(value) ?? 0) > 1;
      });
      return { ...rows[index], linked_by };
    }).sort(newestFirst);
    const earliest = members[members.length - 1];
    const reasons = GROUP_REASONS.filter(reason => members.some(member => member.linked_by.includes(reason)));
    const group = { key: earliest.id, reasons, members };
    groups.push(group);
    for (const member of members) byId.set(member.id, group);
  }
  groups.sort((a, b) => newestFirst(a.members[0], b.members[0]));
  return { groups, byId };
}

export type MatchedPerson<T> = { group: PersonGroup<T>; primary: GroupMember<T>; matched: GroupMember<T>[] };

/**
 * 筛选后的人：每个人只留符合条件的投递（新的在前），一份都不剩的人不出现；主记录是留下的投递里最新一份没取消的，
 * 都取消了就是最新一份。按主记录的投递时间排（新的在前），和列表上「投递时间」一列对得上。列表和导出都用它。
 */
export function matchPeople<T extends GroupableApplication & { status: string }>(groups: readonly PersonGroup<T>[], keep: (row: T) => boolean): MatchedPerson<T>[] {
  const people: MatchedPerson<T>[] = [];
  for (const group of groups) {
    const matched = group.members.filter(keep);
    if (!matched.length) continue;
    people.push({ group, matched, primary: matched.find(row => row.status !== "cancelled") ?? matched[0] });
  }
  return people.sort((a, b) => newestFirst(a.primary, b.primary));
}
