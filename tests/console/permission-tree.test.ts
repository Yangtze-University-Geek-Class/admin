import { describe, expect, it } from "vitest";
import { buildPermissionTree } from "../../app/console/src/lib/permission-tree";
import type { PermissionNode } from "../../app/console/src/lib/permission-tree";
import type { Catalogue, ConsoleMe, Department, TitleId, TitleView } from "../../app/console/src/lib/types";

const titleIds: TitleId[] = ["admin", "captain", "head", "member", "alumni", "guest"];
function catalogue(): Catalogue {
  return {
    titles: titleIds.map((id, rank) => ({ id, label: `当前${id}`, tag: id.toUpperCase(), icon: "user", tone: "cobalt", rank, description: `${id}说明` })),
    crew: { tag: "CREW", tone: "slate", rank: 3 },
    tones: { amber: "#855700", cobalt: "#3346C8", violet: "#6E44C9", jade: "#18694A", sky: "#08609A", coral: "#A63F16", rose: "#B4235A", slate: "#5B6475" },
    capabilities: ["console.access", "work.read", "work.edit", "work.export", "github.org.read", "github.org.manage"].map(id => ({
      id, domain: id.split(".")[0]!, label: `当前${id}`, description: `${id}说明`,
    })),
    domains: [{ id: "console", label: "控制台" }, { id: "work", label: "工作" }, { id: "github", label: "GitHub" }, { id: "empty", label: "空域" }],
    role_base: {
      admin: ["console.access", "work.read", "work.edit", "work.export", "github.org.read", "github.org.manage"],
      captain: ["work.export"], head: ["work.edit"], member: ["work.read"], alumni: ["github.org.read"], guest: [],
    },
    implies: { "work.edit": ["work.read"], "work.export": ["work.read"], "github.org.manage": ["github.org.read"] },
    captain_only: [], department_icons: ["user"], application_statuses: [],
  };
}
function department(id: string): Department {
  return {
    id, name: `当前部门${id}`, tag: "TEAM", icon: "user", tone: "jade", description: "部门说明", sort_order: 1,
    head_capabilities: ["work.export"], member_capabilities: ["github.org.manage"], archived: false, heads: [], crew_count: 1,
  };
}
function title(id: TitleId, team: Department | null = null): TitleView {
  return { id, label: "旧称号名", tag: "OLD", icon: "user", tone: "slate", department: team, source: "assignment", assignment_id: 1 };
}
function me(titles: TitleView[], capabilities: string[] = []): ConsoleMe {
  return {
    login: "fixture", avatar_url: null, org: "fixture-org", github_role: "member", title: titles[0] ?? title("guest"),
    titles, capabilities, blocked: [], head_of: [],
  };
}
function keys(nodes: PermissionNode[]): string[] {
  return nodes.flatMap(node => [node.key, ...keys(node.children ?? [])]);
}

describe("permission explanation tree", () => {
  it("keeps provider status authoritative when current packs disagree, including blocked overlap", () => {
    const config = catalogue();
    config.role_base.member = ["github.org.manage", "work.edit"];
    const identity = me([title("member")], ["github.org.manage", "work.export", "console.access"]);
    identity.blocked = [{ capability: "github.org.manage", reason: "github_admin_required" }];
    const tree = buildPermissionTree(config, [], identity);
    expect(tree.details.get("github.org.manage")).toMatchObject({ status: "blocked", reason: "github_admin_required" });
    expect(tree.details.get("work.export")?.status).toBe("effective");
    expect(tree.details.get("work.edit")?.status).toBe("ungranted");
    expect(tree.details.get("work.edit")?.grants).toContainEqual({ sourceKey: "title:member", label: "当前member", active: true, kind: "direct", via: [] });
    expect(tree.warnings.some(warning => warning.includes("work.export"))).toBe(true);
    expect(tree.warnings.some(warning => warning.includes("work.edit"))).toBe(true);
    expect(tree.warnings.some(warning => warning.includes("github.org.manage"))).toBe(true);
  });

  it("explains multiple direct roots and transitive cycles without duplicate contextual keys or input mutation", () => {
    const config = catalogue();
    config.implies = { "work.edit": ["work.export"], "work.export": ["work.read"], "work.read": ["work.edit"] };
    const team = department("lab");
    const identity = me([title("head", team)], ["work.read", "work.edit", "work.export", "console.access"]);
    const before = JSON.stringify({ config, team, identity });
    const tree = buildPermissionTree(config, [team], identity);
    expect(tree.details.get("work.read")?.grants.filter(grant => grant.active)).toEqual([
      { sourceKey: "title:head", label: "当前head", active: true, kind: "implied", via: ["work.edit"] },
      { sourceKey: "department:lab:head", label: "当前部门lab · 当前head", active: true, kind: "implied", via: ["work.export"] },
    ]);
    expect(tree.details.get("work.read")?.implies).toEqual(["work.edit", "work.export"]);
    expect(tree.details.get("work.read")?.impliedBy).toEqual(["work.edit", "work.export"]);
    const nodeKeys = [...keys(tree.byDomain), ...keys(tree.bySource)];
    expect(new Set(nodeKeys).size).toBe(nodeKeys.length);
    expect(tree.byDomain.find(node => node.key === "domain:empty")?.children).toEqual([]);
    expect(JSON.stringify({ config, team, identity })).toBe(before);
  });

  it("uses current names and packs, and disables both base and department sources for archived or missing departments", () => {
    const config = catalogue();
    const team = department("lab");
    const staleTeam = { ...team, name: "旧部门名" };
    const identity = me([title("head", staleTeam)], ["work.edit", "work.read", "work.export", "console.access"]);
    let tree = buildPermissionTree(config, [team], identity);
    expect(tree.sources.find(source => source.key === "department:lab:head")).toMatchObject({ label: "当前部门lab · 当前head", active: true, direct: ["work.export"] });
    config.role_base.head = ["github.org.read"];
    team.head_capabilities = ["work.read"];
    tree = buildPermissionTree(config, [team], identity);
    expect(tree.sources.find(source => source.key === "title:head")?.direct).toEqual(["github.org.read"]);
    expect(tree.sources.find(source => source.key === "department:lab:head")?.direct).toEqual(["work.read"]);
    team.archived = true;
    tree = buildPermissionTree(config, [team], identity);
    expect(tree.sources.find(source => source.key === "department:lab:head")).toMatchObject({ active: false, archived: true });
    expect(tree.sources.find(source => source.key === "title:head")?.active).toBe(false);
    expect(tree.details.get("work.edit")?.status).toBe("effective");
    expect(tree.warnings.some(warning => warning.includes("lab"))).toBe(true);
    tree = buildPermissionTree(config, [], identity);
    expect(tree.sources.find(source => source.key === "title:head")?.active).toBe(false);
    expect(tree.warnings.some(warning => warning.includes("lab"))).toBe(true);
  });

  it("never derives member from alumni, GitHub membership or rank; explicit valid member still contributes", () => {
    const config = catalogue();
    const identity = me([title("alumni")], ["github.org.read", "console.access"]);
    let tree = buildPermissionTree(config, [], identity);
    expect(tree.sources.find(source => source.key === "title:member")?.active).toBe(false);
    expect(tree.details.get("work.read")?.status).toBe("ungranted");
    identity.titles.push(title("member"));
    tree = buildPermissionTree(config, [], identity);
    expect(tree.sources.find(source => source.key === "title:member")?.active).toBe(true);
    identity.titles = [title("captain")];
    tree = buildPermissionTree(config, [], identity);
    expect(tree.sources.find(source => source.key === "title:head")?.active).toBe(false);
    expect(tree.sources.find(source => source.key === "title:member")?.active).toBe(false);
    const archived = { ...department("old"), archived: true };
    tree = buildPermissionTree(config, [archived], me([title("member", archived)]));
    expect(tree.sources.find(source => source.key === "title:member")?.active).toBe(false);
  });

  it("explains the fixed owner and guest rules without substituting them for provider state", () => {
    const config = catalogue();
    config.role_base.admin = [];
    config.role_base.guest = ["work.edit"];
    const identity = me([], ["work.read", "console.access"]);
    identity.github_role = "admin";
    const tree = buildPermissionTree(config, [], identity);
    expect(tree.sources.find(source => source.key === "title:admin")).toMatchObject({ active: true, direct: config.capabilities.map(capability => capability.id) });
    expect(tree.details.get("work.edit")?.status).toBe("ungranted");
    expect(tree.details.get("work.read")?.grants).toContainEqual({ sourceKey: "title:admin", label: "当前admin", active: true, kind: "automatic", via: [] });
    const guest = buildPermissionTree(config, [], me([title("guest")]));
    expect(guest.sources.find(source => source.key === "title:guest")?.direct).toEqual([]);
    expect(guest.sources.find(source => source.key === "title:admin")?.active).toBe(false);
  });

  it("keeps raw unknown IDs visible and separates automatic entry from blocked-only grants", () => {
    const config = catalogue();
    config.role_base.head = ["github.org.manage", "future.write"];
    config.implies = { "future.write": ["future.read"] };
    const team = department("lab");
    team.head_capabilities = [];
    const identity = me([title("head", team)]);
    identity.blocked = [{ capability: "github.org.manage", reason: "github_admin_required" }];
    let tree = buildPermissionTree(config, [team], identity);
    expect(tree.sources.find(source => source.key === "automatic:console.access")?.active).toBe(false);
    expect(tree.details.get("console.access")?.status).toBe("ungranted");
    expect(tree.details.get("future.read")).toMatchObject({ label: "future.read", domain: "unknown", status: "ungranted" });
    expect(tree.warnings.some(warning => warning.includes("future.read"))).toBe(true);
    identity.capabilities = ["future.read", "console.access"];
    tree = buildPermissionTree(config, [team], identity);
    expect(tree.details.get("future.read")?.status).toBe("effective");
    expect(tree.details.get("console.access")?.grants).toContainEqual({ sourceKey: "automatic:console.access", label: "控制台自动入口", active: true, kind: "automatic", via: ["future.read"] });
  });
});
