// tests/ 是中立位置：这里同时读取服务端清单，核对控制台的导航、图标与开发预览没有和服务端漂移。
import { describe, expect, it } from "vitest";
import { CONSOLE_NAV } from "../../app/console/src/lib/nav";
import { DEPARTMENT_ICONS as CONSOLE_DEPARTMENT_ICONS, TITLE_ICONS } from "../../app/console/src/lib/icons";
import { FALLBACK_TONES } from "../../app/console/src/lib/titles";
import { APPLICATION_STATUS } from "../../app/console/src/lib/statuses";
import { MOCK_CAPABILITIES, MOCK_DEPARTMENTS, MOCK_PERSONAS, MOCK_TITLES, MOCK_TONES } from "../../app/console/src/mock/console";
import {
  APPLICATION_STATUSES, CAPABILITIES, CAPABILITY_IDS, DEFAULT_DEPARTMENTS, DEPARTMENT_ICONS, TITLES, TONES,
  computeAccess, orderedCapabilities, type AssignmentRow,
} from "../../app/server/src/lib/roles";

describe("console catalogue mirrors the server", () => {
  it("uses capability ids the server knows", () => {
    for (const item of CONSOLE_NAV) for (const capability of item.anyOf) expect(CAPABILITY_IDS).toContain(capability);
  });

  it("safelists every icon the server can send", () => {
    expect([...CONSOLE_DEPARTMENT_ICONS]).toEqual([...DEPARTMENT_ICONS]);
    for (const title of Object.values(TITLES)) expect(TITLE_ICONS).toContain(title.icon);
  });

  it("falls back to the server's tones and status labels", () => {
    expect(FALLBACK_TONES).toEqual(TONES);
    expect(Object.entries(APPLICATION_STATUS).map(([id, meta]) => ({ id, label: meta.label }))).toEqual(APPLICATION_STATUSES.map(s => ({ id: s.id, label: s.label })));
  });

  it("keeps the development preview's catalogue in sync", () => {
    expect(MOCK_CAPABILITIES.map(({ id, domain, label }) => ({ id, domain, label }))).toEqual(CAPABILITIES.map(({ id, domain, label }) => ({ id, domain, label })));
    expect(MOCK_TITLES.map(({ id, label, tag, icon, tone, rank }) => ({ id, label, tag, icon, tone, rank })))
      .toEqual(Object.values(TITLES).map(({ id, label, tag, icon, tone, rank }) => ({ id, label, tag, icon, tone, rank })));
    expect(MOCK_TONES).toEqual(TONES);
    expect(MOCK_DEPARTMENTS).toEqual(DEFAULT_DEPARTMENTS);
  });

  it("derives every preview persona exactly as computeAccess would", () => {
    const departments = DEFAULT_DEPARTMENTS.map(item => ({ ...item, archived: false }));
    const row = (login: string, role: AssignmentRow["role"], department_id = ""): AssignmentRow =>
      ({ id: 1, github_login: login, github_user_id: 1, role, department_id, note: null, granted_by: "x", created_at: 0 });
    const cases: Record<string, { orgRole: "admin" | "member" | null; rows: AssignmentRow[]; captainExists: boolean }> = {
      captain: { orgRole: "admin", rows: [row("chen-hang", "captain")], captainExists: true },
      bootstrap: { orgRole: "admin", rows: [], captainExists: false },
      recruitment: { orgRole: "member", rows: [row("li-xiaoman", "head", "recruitment")], captainExists: true },
      tech: { orgRole: "admin", rows: [row("wang-zhe", "head", "tech")], captainExists: true },
      community: { orgRole: "member", rows: [row("sun-qiao", "head", "community")], captainExists: true },
      projects: { orgRole: "member", rows: [row("zhao-yi", "head", "projects")], captainExists: true },
      crew: { orgRole: "member", rows: [row("he-miao", "member", "recruitment")], captainExists: true },
      member: { orgRole: "member", rows: [row("liu-xing", "member")], captainExists: true },
      alumni: { orgRole: "member", rows: [row("gao-yuan", "alumni")], captainExists: true },
      guest: { orgRole: null, rows: [], captainExists: true },
    };
    expect(Object.keys(MOCK_PERSONAS).sort()).toEqual(Object.keys(cases).sort());
    for (const [name, input] of Object.entries(cases)) {
      const access = computeAccess({ login: MOCK_PERSONAS[name].login, orgRole: input.orgRole, assignments: input.rows, departments, captainExists: input.captainExists });
      const persona = MOCK_PERSONAS[name];
      expect(persona.capabilities, name).toEqual(orderedCapabilities(access.capabilities));
      expect(persona.blocked, name).toEqual(access.blocked);
      expect(persona.bootstrap, name).toBe(access.bootstrap);
      expect(persona.head_of, name).toEqual(access.headOf);
      expect(persona.titles.map(t => [t.id, t.label, t.tag, t.icon, t.tone, t.source]), name)
        .toEqual(access.titles.map(t => [t.id, t.label, t.tag, t.icon, t.tone, t.source]));
    }
  });
});
