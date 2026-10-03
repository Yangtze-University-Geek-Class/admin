/**
 * 邮箱分组仅用于展示重复投递，不证明身份；不复用发信限流的别名规则。
 * 姓名班级只用于人工核对提示，不参与合并，不自动改状态。
 */

export type GroupReason = "email";
export const GROUP_REASONS: readonly GroupReason[] = ["email"];

export type GroupableApplication = { id: string; name: string; class_name: string; email: string; created_at: number };
export type GroupMember<T> = T & { linked_by: GroupReason[] };
export type PersonGroup<T> = {
  /** 本邮箱组最早一份投递的 id；导出 CSV 的 person_group 列是同一个值。 */
  key: string;
  /** 多份同邮箱投递为 email；只有一份投递时为空。 */
  reasons: GroupReason[];
  /** 新的在前（created_at DESC, id），和列表原来的顺序一样。 */
  members: GroupMember<T>[];
};

/** 仅提示疑似重复：任一项为空时不参与匹配。 */
export function nameClassKey(name: string, className: string): string | null {
  const fold = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const [n, c] = [fold(name), fold(className)];
  return n && c ? `${n}\u0000${c}` : null;
}

/** 不剥离 + 标签、点、域名别名，不将收件箱路由规则视为身份。 */
export function emailKey(email: string): string | null {
  return email.trim().toLowerCase() || null;
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

  const keys = rows.map(row => ({ email: emailKey(row.email) }));
  const seen = { email: new Map<string, number>() };
  const sizes = { email: new Map<string, number>() };
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

export function nameClassIndex<T extends GroupableApplication>(rows: readonly T[]): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const row of rows) {
    const key = nameClassKey(row.name, row.class_name);
    if (key === null) continue;
    const matches = index.get(key);
    if (matches) matches.push(row);
    else index.set(key, [row]);
  }
  return index;
}

/** 只匹配本邮箱组直接出现过的姓名班级，不沿疑似关系扩展。 */
export function possibleDuplicates<T extends GroupableApplication>(group: PersonGroup<T>, index: ReadonlyMap<string, readonly T[]>): T[] {
  const ownIds = new Set(group.members.map(row => row.id));
  const keys = new Set(group.members.map(row => nameClassKey(row.name, row.class_name)));
  const candidates = new Map<string, T>();
  for (const key of keys) {
    if (key === null) continue;
    for (const row of index.get(key) ?? []) {
      if (!ownIds.has(row.id)) candidates.set(row.id, row);
    }
  }
  return [...candidates.values()].sort(newestFirst);
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
