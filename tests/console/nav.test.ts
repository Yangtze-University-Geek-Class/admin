import { describe, expect, it } from "vitest";
import { CONSOLE_NAV, activeNavId, navState, visibleNav } from "../../app/console/src/lib/nav";
import { MOCK_PERSONAS } from "../../app/console/src/mock/console";

const identity = (capabilities: string[], blocked: { capability: string; reason: "github_admin_required" | "github_membership_required" }[] = []) => ({ capabilities, blocked });

describe("navState", () => {
  const item = { anyOf: ["github.invites.manage"] };
  it("shows an item whose capability is held", () => {
    expect(navState(item, identity(["console.access", "github.invites.manage"]))).toBe("visible");
  });
  it("disables an item whose capability is capped by the GitHub role", () => {
    expect(navState(item, identity(["console.access"], [{ capability: "github.invites.manage", reason: "github_admin_required" }]))).toBe("disabled");
  });
  it("hides an item the title never granted", () => {
    expect(navState(item, identity(["console.access"]))).toBe("hidden");
  });
  it("treats anyOf as a union", () => {
    expect(navState({ anyOf: ["roles.manage", "roles.department.manage"] }, identity(["roles.department.manage"]))).toBe("visible");
  });
});

describe("console navigation per persona", () => {
  const ids = (name: string) => visibleNav(MOCK_PERSONAS[name] as never).map(item => item.id);
  const groups = (name: string) => [...new Set(visibleNav(MOCK_PERSONAS[name] as never).map(item => item.group ?? "home"))];

  it("gives the captain every page", () => {
    expect(ids("captain")).toEqual(CONSOLE_NAV.map(item => item.id));
  });
  it("gives a plain member only the overview and the GitHub read pages", () => {
    expect(groups("member")).toEqual(["home", "github"]);
    expect(ids("member")).not.toContain("github-invitations");
    expect(ids("member")).not.toContain("people");
  });
  it("shows invites as disabled, with the reason, for a recruitment head who is not an org admin", () => {
    const invites = visibleNav(MOCK_PERSONAS.recruitment as never).find(item => item.id === "github-invitations");
    expect(invites).toMatchObject({ state: "disabled", reason: "github_admin_required" });
  });
  it("gives a department head the people page but not the audit log unless the bundle grants it", () => {
    expect(ids("recruitment")).toContain("people");
    expect(ids("recruitment")).not.toContain("audit");
    expect(ids("tech")).toContain("audit");
  });
  it("gives a guest nothing", () => {
    expect(ids("guest")).toEqual([]);
  });
  it("only links to console routes", () => {
    for (const item of CONSOLE_NAV) expect(item.to.startsWith("/console")).toBe(true);
  });
});

describe("activeNavId", () => {
  it("matches the overview only exactly", () => {
    expect(activeNavId("/console")).toBe("overview");
    expect(activeNavId("/console/")).toBe("overview");
    expect(activeNavId("/console/applications/abc")).toBe("applications");
  });
  it("prefers the longest prefix and keeps the GitHub overview exact", () => {
    expect(activeNavId("/console/github")).toBe("github-overview");
    expect(activeNavId("/console/github/repos/geek-main/issues/3")).toBe("github-repos");
    expect(activeNavId("/console/github/invite-links")).toBe("github-invite-links");
  });
  it("returns null outside the console", () => {
    expect(activeNavId("/signin")).toBeNull();
  });
});
