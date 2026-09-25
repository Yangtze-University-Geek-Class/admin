// tests/ 是中立位置：这里同时读取服务端清单，核对控制台的导航、图标、兜底默认值与开发预览没有和服务端漂移。
import { describe, expect, it } from "vitest";
import { CONSOLE_NAV } from "../../app/console/src/lib/nav";
import { DEPARTMENT_ICONS as CONSOLE_DEPARTMENT_ICONS } from "../../app/console/src/lib/icons";
import { DEFAULT_CREW, DEFAULT_TITLES, FALLBACK_TONES, TONE_NAMES, titleBundleError as consoleBundleError } from "../../app/console/src/lib/titles";
import { APPLICATION_STATUS } from "../../app/console/src/lib/statuses";
import {
  MOCK_ASSIGNMENTS, MOCK_CAPABILITIES, MOCK_CAPTAIN_ONLY, MOCK_DEPARTMENTS, MOCK_IMPLIES, MOCK_MEMBERS, MOCK_PERSONAS, MOCK_ROLE_BASE, MOCK_TITLES, MOCK_TONES,
  mockPeople,
} from "../../app/console/src/mock/console";
import {
  APPLICATION_STATUSES, CAPABILITIES, CAPABILITY_IDS, CAPTAIN_ONLY, CREW_TITLE, DEFAULT_DEPARTMENTS, DEFAULT_TITLE_CONFIGS, DEPARTMENT_ICONS, IMPLIES,
  ROLE_BASE, TITLES, TITLE_IDS, TONES, computeAccess, orderedCapabilities, titleBundleError, titleRank, type AssignmentRow, type OrgRole,
} from "../../app/server/src/lib/roles";

const departments = DEFAULT_DEPARTMENTS.map(item => ({ ...item, archived: false }));
const titleShape = (t: { id: string; label: string; tag: string; icon: string; tone: string; source: string }) => [t.id, t.label, t.tag, t.icon, t.tone, t.source];

describe("console catalogue mirrors the server", () => {
  it("uses capability ids the server knows", () => {
    for (const item of CONSOLE_NAV) for (const capability of item.anyOf) expect(CAPABILITY_IDS).toContain(capability);
  });

  it("safelists every icon the server can send", () => {
    expect([...CONSOLE_DEPARTMENT_ICONS]).toEqual([...DEPARTMENT_ICONS]);
    for (const title of Object.values(TITLES)) expect(CONSOLE_DEPARTMENT_ICONS).toContain(title.icon);
  });

  it("falls back to the server's tones, title defaults and status labels", () => {
    expect(FALLBACK_TONES).toEqual(TONES);
    expect(Object.keys(TONE_NAMES).sort()).toEqual(Object.keys(TONES).sort());
    expect(DEFAULT_TITLES.map(({ id, label, tag, icon, tone, rank, description }) => ({ id, label, tag, icon, tone, rank, description })))
      .toEqual(TITLE_IDS.map(id => TITLES[id]).map(({ id, label, tag, icon, tone, rank, description }) => ({ id, label, tag, icon, tone, rank, description })));
    expect(DEFAULT_CREW).toEqual(CREW_TITLE);
    expect(Object.entries(APPLICATION_STATUS).map(([id, meta]) => ({ id, label: meta.label }))).toEqual(APPLICATION_STATUSES.map(s => ({ id: s.id, label: s.label })));
  });

  it("keeps the development preview's catalogue in sync", () => {
    expect(MOCK_CAPABILITIES).toEqual(CAPABILITIES.map(({ id, domain, label, description }) => ({ id, domain, label, description })));
    expect(MOCK_TITLES.map(({ id, label, tag, icon, tone, rank, description }) => ({ id, label, tag, icon, tone, rank, description })))
      .toEqual(TITLE_IDS.map(id => ({ ...TITLES[id], description: DEFAULT_TITLE_CONFIGS[id].description })));
    expect(MOCK_TONES).toEqual(TONES);
    expect(MOCK_DEPARTMENTS).toEqual(DEFAULT_DEPARTMENTS);
    expect(MOCK_IMPLIES).toEqual(IMPLIES);
    expect(MOCK_CAPTAIN_ONLY).toEqual(CAPTAIN_ONLY);
  });

  it("gives every preview title the server's default permission bundle", () => {
    expect(Object.keys(MOCK_ROLE_BASE).sort()).toEqual([...TITLE_IDS].sort());
    for (const id of TITLE_IDS) {
      expect(MOCK_ROLE_BASE[id], id).toEqual(ROLE_BASE[id]);
      expect(MOCK_ROLE_BASE[id], id).toEqual(DEFAULT_TITLE_CONFIGS[id].capabilities);
    }
  });

  it("applies the server's title bundle rules before a save is sent", () => {
    const bundles = [[], ["console.access"], ["roles.manage"], ["roles.department.manage"], [...CAPABILITY_IDS]];
    for (const id of TITLE_IDS) {
      for (const bundle of bundles) {
        expect(consoleBundleError(id, bundle, CAPTAIN_ONLY), `${id} ${bundle.join(",")}`).toBe(titleBundleError(id, bundle as never));
      }
    }
  });

  it("derives every preview persona exactly as computeAccess would", () => {
    const row = (login: string, role: AssignmentRow["role"], department_id = ""): AssignmentRow =>
      ({ id: 1, github_login: login, github_user_id: 1, role, department_id, note: null, granted_by: "x", created_at: 0 });
    const cases: Record<string, { orgRole: OrgRole; rows: AssignmentRow[] }> = {
      admin: { orgRole: "admin", rows: [] },
      captain: { orgRole: "member", rows: [row("chen-hang", "captain")] },
      recruitment: { orgRole: "member", rows: [row("li-xiaoman", "head", "recruitment")] },
      tech: { orgRole: "member", rows: [row("wang-zhe", "head", "tech")] },
      community: { orgRole: "member", rows: [row("sun-qiao", "head", "community")] },
      projects: { orgRole: "member", rows: [row("zhao-yi", "head", "projects")] },
      crew: { orgRole: "member", rows: [row("he-miao", "member", "recruitment")] },
      member: { orgRole: "member", rows: [row("liu-xing", "member")] },
      alumni: { orgRole: "member", rows: [row("gao-yuan", "alumni")] },
      guest: { orgRole: null, rows: [] },
    };
    expect(Object.keys(MOCK_PERSONAS).sort()).toEqual(Object.keys(cases).sort());
    for (const [name, input] of Object.entries(cases)) {
      const persona = MOCK_PERSONAS[name];
      const access = computeAccess({ login: persona.login, orgRole: input.orgRole, assignments: input.rows, departments });
      expect(persona.github_role, name).toBe(input.orgRole);
      expect(persona.capabilities, name).toEqual(orderedCapabilities(access.capabilities));
      expect(persona.blocked, name).toEqual(access.blocked);
      expect(persona.head_of, name).toEqual(access.headOf);
      expect(persona.titles.map(titleShape), name).toEqual(access.titles.map(titleShape));
    }
    expect(MOCK_PERSONAS.admin.titles[0].id).toBe("admin");
  });

  it("lists preview people exactly as the server's people route would", () => {
    const rows: AssignmentRow[] = MOCK_ASSIGNMENTS.map(a => ({ ...a }));
    const belongsTo = (row: AssignmentRow, login: string, userId: number | null) =>
      row.github_user_id !== null ? row.github_user_id === userId : row.github_login === login.toLowerCase();
    const claimed = new Set<number>();
    const person = (login: string, userId: number | null, orgRole: OrgRole) => {
      const mine = rows.filter(row => belongsTo(row, login, userId));
      for (const row of mine) claimed.add(row.id);
      return { login, github_role: orgRole, titles: computeAccess({ login, orgRole, assignments: mine, departments }).titles };
    };
    const expected = MOCK_MEMBERS.map(member => person(member.login, member.id, member.role));
    for (const row of rows) if (!claimed.has(row.id)) expected.push(person(row.github_login, row.github_user_id, null));
    expected.sort((a, b) => titleRank(a.titles[0]) - titleRank(b.titles[0]) || a.login.localeCompare(b.login));

    const people = mockPeople();
    expect(people.map(p => [p.login, p.github_role])).toEqual(expected.map(p => [p.login, p.github_role]));
    people.forEach((p, index) => {
      expect(p.titles.map(titleShape), p.login).toEqual(expected[index].titles.map(titleShape));
      expect(p.titles.map(t => t.assignment_id), p.login).toEqual(expected[index].titles.map(t => t.assignment_id));
    });
    // 预览里要有一位不在组织里、只剩称号的人，名单才能展示这种情况。
    expect(people.some(p => p.github_role === null)).toBe(true);
  });
});
