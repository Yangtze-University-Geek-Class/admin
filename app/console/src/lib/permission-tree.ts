import { closure } from "./titles";
import type { BlockReason, Capability, Catalogue, CatalogueCapability, ConsoleMe, Department, TitleId } from "./types";

export type PermissionNode = {
  key: string; label: string; children?: PermissionNode[]; capability?: string; sourceKey?: string;
  description?: string; searchText: string; icon?: string;
};
export type PermissionSource = {
  key: string; label: string; description: string; direct: string[]; inherited: string[];
  active: boolean; archived: boolean; kind: "title" | "department" | "automatic";
};
export type PermissionGrant = {
  sourceKey: string; label: string; active: boolean; kind: "direct" | "implied" | "automatic"; via: string[];
};
export interface PermissionDetail extends CatalogueCapability {
  status: "effective" | "blocked" | "ungranted";
  reason: BlockReason | null;
  grants: PermissionGrant[];
  implies: string[];
  impliedBy: string[];
}

const TITLE_IDS: readonly TitleId[] = ["admin", "captain", "head", "member", "alumni", "guest"];

export function permissionDomainLabel(catalogue: Catalogue, domain: string): string {
  return catalogue.domains.find(item => item.id === domain)?.label
    ?? (domain === "unknown" ? "未识别能力" : domain);
}

export function configuredPerspectiveDetails(catalogue: Catalogue, direct: Capability[], sourceKey: string, sourceLabel: string): PermissionDetail[] {
  const directSet = new Set(direct);
  const effective = closure(direct, catalogue.implies);
  const capabilities = new Map(catalogue.capabilities.map(item => [item.id, item]));
  for (const id of effective) {
    if (!capabilities.has(id)) capabilities.set(id, {
      id, domain: "unknown", label: id,
      description: "当前能力清单没有此标识的说明；保留原始标识，不据此推断权限。",
    });
  }
  return [...capabilities.values()].map(item => {
    const isDirect = directSet.has(item.id);
    const isImplied = !isDirect && effective.has(item.id);
    return {
      ...item,
      status: effective.has(item.id) ? "effective" as const : "ungranted" as const,
      reason: null,
      grants: isDirect || isImplied ? [{
        sourceKey, label: sourceLabel, active: true,
        kind: isDirect ? "direct" as const : "implied" as const,
        via: isDirect ? [] : direct.filter(root => closure([root], catalogue.implies).has(item.id)),
      }] : [],
      implies: [...closure([item.id], catalogue.implies)].filter(id => id !== item.id),
      impliedBy: [...capabilities.keys()].filter(id => id !== item.id && closure([id], catalogue.implies).has(item.id)),
    };
  });
}

/** 配置只解释来源；是否生效与受限原因只读 /me，不在前端再次授权。 */
export function buildPermissionTree(catalogue: Catalogue, departments: Department[], me: ConsoleMe): {
  byDomain: PermissionNode[]; bySource: PermissionNode[]; details: Map<string, PermissionDetail>;
  sources: PermissionSource[]; warnings: string[];
} {
  const warnings = new Set<string>();
  const capabilities = new Map(catalogue.capabilities.map(item => [item.id, item]));
  const knownIds = [...capabilities.keys()];
  const domains = new Map(catalogue.domains.map(item => [item.id, item.label]));
  const titleDefs = new Map(catalogue.titles.map(item => [item.id, item]));
  const departmentsById = new Map(departments.map(item => [item.id, item]));
  const effective = new Set(me.capabilities);
  const blocked = new Map(me.blocked.map(item => [item.capability, item.reason]));
  const implications = catalogue.implies ?? {};
  const closures = new Map<string, Set<string>>();
  const expand = (id: string): Set<string> => {
    let result = closures.get(id);
    if (!result) { result = closure([id], implications); closures.set(id, result); }
    return result;
  };
  const ensureCapability = (id: string) => {
    if (capabilities.has(id)) return;
    capabilities.set(id, { id, domain: "unknown", label: id, description: "当前能力清单没有此标识的说明；保留原始标识，不据此推断权限。" });
    warnings.add(`当前能力清单缺少 ${id}，请刷新身份与配置后核对。`);
  };
  const titleLabel = (id: TitleId) => {
    const title = titleDefs.get(id);
    if (!title) warnings.add(`当前称号清单缺少 ${id}，使用原始标识。`);
    return title?.label ?? id;
  };

  // /me 已包含服务端派生的称号；不按 GitHub member、主称号或 rank 补出任何称号。
  const validTitles = me.titles.filter(title => {
    if (title.id === "admin") return me.github_role === "admin";
    if (title.id === "guest") return true;
    if (title.source === "none" || (title.source === "github" &&
      (title.id !== "member" || title.department !== null || me.github_role !== "member"))) {
      warnings.add(`身份中的 ${title.id} 没有有效来源，不用于解释授权。`);
      return false;
    }
    if (title.id === "head" || (title.id === "member" && title.department)) {
      const department = title.department && departmentsById.get(title.department.id);
      if (!department || department.archived) {
        warnings.add(`身份中的 ${title.id} 引用了已归档或不存在的部门 ${title.department?.id ?? "（未指定）"}，不用于解释授权。`);
        return false;
      }
    }
    return true;
  });
  const sources: PermissionSource[] = [];
  const addSource = (source: Omit<PermissionSource, "inherited">) => {
    const direct = [...new Set(source.direct)];
    const directSet = new Set(direct);
    const inherited = new Set<string>();
    for (const id of direct) {
      ensureCapability(id);
      if (source.kind === "automatic") continue;
      for (const implied of expand(id)) {
        ensureCapability(implied);
        if (!directSet.has(implied)) inherited.add(implied);
      }
    }
    sources.push({ ...source, direct, inherited: [...inherited] });
  };
  for (const id of TITLE_IDS) {
    const fixed = id === "admin" || id === "guest";
    addSource({
      key: `title:${id}`, label: titleLabel(id), kind: "title", archived: false,
      description: id === "admin"
        ? "GitHub 组织所有者自动获得全部清单能力，不读取可编辑权限包；这是固定规则，不是称号层级继承。"
        : id === "guest" ? "没有称号时的身份，固定不授予任何能力。"
          : `${titleDefs.get(id)?.description ?? ""} 权限取当前称号基础包；层级只用于排序，不继承其它称号。`.trim(),
      direct: id === "admin" ? knownIds : id === "guest" ? [] : catalogue.role_base[id],
      active: id === "admin" ? me.github_role === "admin" : validTitles.some(title => title.id === id),
    });
    if (fixed) {
      const expected = new Set(id === "admin" ? knownIds : []);
      const configured = new Set(catalogue.role_base[id]);
      if (expected.size !== configured.size || [...configured].some(capability => !expected.has(capability))) {
        warnings.add(`${titleLabel(id)}的配置快照与服务端固定规则不一致；来源解释遵循固定规则，生效状态仍以 /me 为准。`);
      }
      for (const capability of configured) ensureCapability(capability);
    }
  }
  for (const department of [...departments].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))) {
    for (const id of ["head", "member"] as const) {
      addSource({
        key: `department:${department.id}:${id}`, label: `${department.name} · ${titleLabel(id)}`,
        description: `${department.description}${department.description ? " " : ""}${department.archived ? "部门已归档，不参与当前授权。" : "部门权限包与对应称号基础包叠加。"}`,
        direct: id === "head" ? department.head_capabilities : department.member_capabilities,
        active: !department.archived && validTitles.some(title => title.id === id && title.department?.id === department.id),
        archived: department.archived, kind: "department",
      });
    }
  }
  // 自动入口以 /me 的其它有效能力作依据，不让受限能力或配置包自行打开入口。
  const entryVia = [...effective].filter(id => id !== "console.access" && !blocked.has(id));
  addSource({
    key: "automatic:console.access", label: "控制台自动入口", kind: "automatic", archived: false,
    description: "服务端在至少一项能力通过 GitHub 上限后自动补入 console.access；仅受限能力不会触发。",
    direct: ["console.access"], active: entryVia.length > 0,
  });
  for (const id of [...effective, ...blocked.keys()]) ensureCapability(id);
  for (const [id, implied] of Object.entries(implications)) {
    ensureCapability(id);
    for (const target of implied) ensureCapability(target);
  }

  const details = new Map<string, PermissionDetail>();
  for (const capability of capabilities.values()) {
    const reason = blocked.get(capability.id) ?? null;
    if (reason && effective.has(capability.id)) {
      warnings.add(`/me 同时将 ${capability.id} 标为生效和受限；保守显示受限，请刷新身份。`);
    }
    details.set(capability.id, {
      ...capability, status: reason ? "blocked" : effective.has(capability.id) ? "effective" : "ungranted",
      reason, grants: [], implies: [...expand(capability.id)].filter(id => id !== capability.id), impliedBy: [],
    });
    if (!domains.has(capability.domain)) {
      domains.set(capability.domain, capability.domain === "unknown" ? "未识别能力" : capability.domain);
      if (capability.domain !== "unknown") warnings.add(`当前业务域清单缺少 ${capability.domain}，使用原始标识。`);
    }
  }
  for (const detail of details.values()) {
    for (const id of detail.implies) details.get(id)?.impliedBy.push(detail.id);
  }
  for (const source of sources) {
    const direct = new Set(source.direct);
    for (const id of [...source.direct, ...source.inherited]) {
      const automatic = source.kind === "automatic" || source.key === "title:admin";
      details.get(id)!.grants.push({
        sourceKey: source.key, label: source.label, active: source.active,
        kind: automatic ? "automatic" : direct.has(id) ? "direct" : "implied",
        via: source.kind === "automatic" ? [...entryVia]
          : direct.has(id) ? [] : source.direct.filter(root => expand(root).has(id)),
      });
    }
  }
  for (const detail of details.values()) {
    const explained = detail.grants.some(grant => grant.active);
    if (detail.status !== "ungranted" && !explained) {
      warnings.add(`${detail.id} 的 /me 状态在当前配置中没有可对应的有效来源；保留服务端状态，请刷新身份与配置。`);
    } else if (detail.status === "ungranted" && explained) {
      warnings.add(`当前配置可解释 ${detail.id} 的来源，但 /me 未授予也未列为受限；不将配置解释当作实际授权。`);
    }
  }

  const leaf = (detail: PermissionDetail, context: string, source?: PermissionSource): PermissionNode => ({
    key: `${context}:capability:${detail.id}`, label: detail.label, capability: detail.id,
    sourceKey: source?.key, description: detail.description,
    searchText: [detail.id, detail.label, detail.description, domains.get(detail.domain), source?.label,
      ...detail.grants.map(grant => grant.label)].filter(Boolean).join(" ").toLocaleLowerCase(),
  });
  const domainChildren = new Map<string, PermissionNode[]>([...domains.keys()].map(id => [id, []]));
  for (const detail of details.values()) domainChildren.get(detail.domain)!.push(leaf(detail, `domain:${detail.domain}`));
  const byDomain: PermissionNode[] = [...domains].map(([id, label]) => ({
    key: `domain:${id}`, label, children: domainChildren.get(id), searchText: `${id} ${label}`.toLocaleLowerCase(),
  }));
  const bySource: PermissionNode[] = sources.map(source => ({
    key: source.key, sourceKey: source.key, label: source.label, description: source.description,
    searchText: `${source.key} ${source.label} ${source.description}`.toLocaleLowerCase(),
    children: [
      { key: `${source.key}:direct`, label: source.kind === "automatic" || source.key === "title:admin" ? "自动授予" : "直接配置", ids: source.direct },
      { key: `${source.key}:inherited`, label: "能力蕴含", ids: source.inherited },
    ].filter(group => group.ids.length > 0).map(group => ({
      key: group.key, label: group.label, sourceKey: source.key, searchText: `${source.label} ${group.label}`.toLocaleLowerCase(),
      children: group.ids.map(id => leaf(details.get(id)!, group.key, source)),
    })),
  }));
  return { byDomain, bySource, details, sources, warnings: [...warnings] };
}
