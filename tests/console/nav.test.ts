import { describe, expect, it } from "vitest";
import { CONSOLE_NAV, activeNavId, navState, visibleNav } from "../../app/console/src/lib/nav";
import { MOCK_PERSONAS, mockMe } from "../../app/console/src/mock/console";

const identity = (permissions: string[]) => ({ permissions });

describe("navState", () => {
  const item = { anyOf: ["invite.manage"] };
  it("shows an item whose node is held", () => {
    expect(navState(item, identity(["console.access", "invite.manage"]))).toBe("visible");
  });
  it("hides an item whose node is missing", () => {
    expect(navState(item, identity(["console.access"]))).toBe("hidden");
  });
  it("treats anyOf as a union", () => {
    expect(navState({ anyOf: ["perm.view", "perm.manage"] }, identity(["perm.manage"]))).toBe("visible");
  });
});

describe("console navigation per persona (#274)", () => {
  const me = (name: string) => mockMe(MOCK_PERSONAS[name]);
  const ids = (name: string) => visibleNav(me(name)).map(item => item.id);

  it("shows security management only when its permission is granted", () => {
    expect(ids("owner")).toContain("security");
    expect(visibleNav(identity(["console.access"])).map(item => item.id)).not.toContain("security");
    expect(visibleNav(identity(["console.access", "security.manage"])).map(item => item.id)).toContain("security");
    expect(ids("management_head")).not.toContain("security");
  });
  it("gives the site owner every page, whichever way they signed in, including backup (#282, root wildcard *)", () => {
    expect(ids("owner")).toEqual(CONSOLE_NAV.map(item => item.id));
    expect(ids("owner")).toContain("backup");
    expect(ids("owner_email")).toEqual(ids("owner"));
  });
  it("gives the management head users, permissions (read only), invites, GitLab and the activity log, but not backup (#282: only the owner's root wildcard has system.backup)", () => {
    const list = ids("management_head");
    for (const id of ["overview", "users", "permissions", "invites", "gitlab-overview", "gitlab-settings", "activity", "competitions"]) expect(list, id).toContain(id);
    expect(list).not.toContain("applications");
    expect(list).not.toContain("feedback");
    expect(list).not.toContain("backup");
    expect(me("management_head").permissions).toContain("perm.view");
    expect(me("management_head").permissions).not.toContain("perm.manage");
    expect(me("management_head").permissions).not.toContain("system.backup");
  });
  it("gives a department head the overview, applications, users and the activity log of their own department", () => {
    const list = ids("ai_head");
    for (const id of ["overview", "applications", "users", "activity"]) expect(list, id).toContain(id);
    for (const id of ["permissions", "invites", "gitlab-overview", "feedback"]) expect(list, id).not.toContain(id);
  });
  it("lets a custom group open the console for one job: the AI staff member in 活动志愿者 sees competitions", () => {
    expect(me("ai_staff").permissions).toContain("console.access");
    expect(ids("ai_staff")).toContain("competitions");
    expect(ids("ai_staff")).not.toContain("users");
  });
  it("shows the mail templates page only to whoever holds mail.template.manage, which only the owner's root wildcard has by default (#285)", () => {
    expect(ids("owner")).toContain("mail-templates");
    expect(me("owner").permissions).toContain("mail.template.manage");
    for (const name of ["management_head", "ai_head", "ai_staff"]) {
      expect(ids(name), name).not.toContain("mail-templates");
      expect(me(name).permissions, name).not.toContain("mail.template.manage");
    }
    expect(CONSOLE_NAV.find(item => item.id === "mail-templates")).toMatchObject({ to: "/console/mail-templates", anyOf: ["mail.template.manage"], group: "recruit" });
  });
  it("keeps members, alumni and registered users out: /api/console/me answers but without console.access", () => {
    for (const name of ["member", "alumni", "registered"]) expect(me(name).permissions, name).not.toContain("console.access");
    expect(me("registered").level).toBe("registered");
    expect(me("registered").permissions).toContain("apply.submit");
  });
});

describe("activeNavId", () => {
  it("matches the overview only exactly", () => {
    expect(activeNavId("/console")).toBe("overview");
    expect(activeNavId("/console/")).toBe("overview");
    expect(activeNavId("/console/applications/abc")).toBe("applications");
  });
  it("keeps the GitLab overview exact and picks the longest prefix below it", () => {
    expect(activeNavId("/console/gitlab")).toBe("gitlab-overview");
    expect(activeNavId("/console/gitlab/accounts")).toBe("gitlab-accounts");
    expect(activeNavId("/console/gitlab/settings")).toBe("gitlab-settings");
  });
  it("returns null outside the console", () => {
    expect(activeNavId("/signin")).toBeNull();
  });
});
