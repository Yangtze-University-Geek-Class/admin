import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_DEPARTMENTS, DEFAULT_TITLE_CONFIGS, DEPARTMENT_ICONS, TITLES, TITLE_IDS, TONES } from "../../app/server/src/lib/roles";
import { isIconName } from "../../app/web/sites/portal/lib/icons";
import {
  DEFAULT_ORG,
  ORG_DEFAULTS,
  ORG_FALLBACK_ICON,
  ORG_ICONS,
  orgChartModel,
  orgColor,
  orgIcon,
  orgSummary,
  readOrg,
  type OrgPayload,
} from "../../app/web/sites/portal/lib/org";

const PORTAL = new URL("../../app/web/sites/portal/", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

/** 一份「提督改过」的响应：换了名字、色调、图标，删了三个部门、加了一个新部门。 */
function edited(): OrgPayload {
  const payload = structuredClone(ORG_DEFAULTS);
  const title = (id: string) => payload.titles.find((item) => item.id === id)!;
  Object.assign(title("admin"), { description: "GitHub 组织的 owner，任命大副" });
  Object.assign(title("captain"), { label: "大副", tone: "rose", icon: "trophy", description: "带全班的人" });
  Object.assign(title("head"), { label: "组长", icon: "idea" });
  Object.assign(title("member"), { label: "水手", description: "在读的同学" });
  Object.assign(title("alumni"), { label: "老水手", tone: "sky" });
  Object.assign(title("guest"), { label: "游客", description: "看看就走" });
  payload.departments = [
    payload.departments[1],
    { id: "design", name: "设计部", tag: "DESIGN", icon: "education", tone: "violet", description: "负责视觉和海报" },
  ];
  return payload;
}

describe("组织架构的默认值与服务端一致", () => {
  it("色调、称号（顺序、显示字段、层级）与服务端 DEFAULT_TITLE_CONFIGS 相同", () => {
    expect(ORG_DEFAULTS.tones).toEqual(TONES);
    expect(ORG_DEFAULTS.titles).toEqual(
      TITLE_IDS.map((id) => {
        const { label, tag, icon, tone, description } = DEFAULT_TITLE_CONFIGS[id];
        return { id, label, tag, icon, tone, description, rank: TITLES[id].rank };
      }),
    );
  });

  it("部门（顺序与显示字段）与服务端 DEFAULT_DEPARTMENTS 相同", () => {
    const expected = [...DEFAULT_DEPARTMENTS]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ id, name, tag, icon, tone, description }) => ({ id, name, tag, icon, tone, description }));
    expect(ORG_DEFAULTS.departments).toEqual(expected);
  });
});

describe("Carbon 图标名换成官网图标", () => {
  it("对照表正好覆盖服务端的 DEPARTMENT_ICONS，每个都换成注册表里的图标", () => {
    expect(Object.keys(ORG_ICONS).sort()).toEqual([...DEPARTMENT_ICONS].sort());
    expect(Object.values(ORG_ICONS).filter((name) => !isIconName(name))).toEqual([]);
    for (const name of DEPARTMENT_ICONS) expect(orgIcon(name)).toBe(ORG_ICONS[name]);
  });

  it("认不出的名字用中性图标，不会拿到原型链上的东西", () => {
    expect(isIconName(ORG_FALLBACK_ICON)).toBe(true);
    for (const name of ["", "rocket", "i-carbon-code", "constructor", "__proto__", "toString"]) expect(orgIcon(name)).toBe(ORG_FALLBACK_ICON);
  });
});

describe("读组织架构", () => {
  it("读不出来的响应就是默认值", () => {
    for (const body of [null, undefined, "oops", 42, [], { titles: 5, departments: "x" }]) expect(readOrg(body)).toEqual(DEFAULT_ORG);
  });

  it("单个字段缺了或类型不对，用这个称号的默认值补上；空说明照样显示为空", () => {
    const org = readOrg({
      tones: { rose: "#123456", slate: "red", violet: 3 },
      titles: [{ id: "captain", label: "", tag: 7, description: "" }, { id: "nobody", label: "谁" }, "x"],
      departments: [{ id: "a", name: "A 部" }, { id: "b", name: "  " }, { name: "没有 id" }, null],
    });
    expect(org.titles.captain).toMatchObject({ label: "舰长", tag: "CAPTAIN", icon: "star-filled", tone: "amber", description: "" });
    expect(org.titles.admin).toEqual(DEFAULT_ORG.titles.admin);
    expect(org.tones.rose).toBe("#123456");
    expect(org.tones.slate).toBe(TONES.slate);
    expect(org.tones.violet).toBe(TONES.violet);
    expect(org.departments).toEqual([{ id: "a", name: "A 部", tag: "", icon: "", tone: "slate", description: "" }]);
  });

  it("色调按 id 取色值，认不出的色调是中性灰", () => {
    expect(orgColor(DEFAULT_ORG, "jade")).toBe(TONES.jade);
    expect(orgColor(DEFAULT_ORG, "neon")).toBe(TONES.slate);
    expect(orgColor(DEFAULT_ORG, "constructor")).toBe(TONES.slate);
  });
});

describe("组织架构窗口显示的内容来自数据", () => {
  it("默认值：直属链、四个部门、成员行与底部", () => {
    const chart = orgChartModel(DEFAULT_ORG);
    expect(chart.chain.map((item) => [item.id, item.label, item.icon, item.color])).toEqual([
      ["admin", "提督", ORG_ICONS["user-admin"], TONES.violet],
      ["captain", "舰长", ORG_ICONS["star-filled"], TONES.amber],
    ]);
    expect(chart.departments.map((dept) => [dept.name, dept.icon, dept.color, dept.head.label, dept.head.color])).toEqual([
      ["招新部", ORG_ICONS["user-follow"], TONES.coral, "队长", TONES.coral],
      ["技术部", ORG_ICONS.terminal, TONES.jade, "队长", TONES.jade],
      ["社区部", ORG_ICONS.forum, TONES.rose, "队长", TONES.rose],
      ["项目部", ORG_ICONS.application, TONES.cobalt, "队长", TONES.cobalt],
    ]);
    expect(chart.crew).toMatchObject({ label: "舰员", description: DEFAULT_TITLE_CONFIGS.member.description, color: TONES.sky });
    expect(chart.foot.map((item) => item.label)).toEqual(["领航员", "乘客"]);
  });

  it("提督改了名字、图标、色调、说明和部门后，窗口显示改过的样子", () => {
    const chart = orgChartModel(readOrg(edited()));
    expect(chart.chain[1]).toEqual({ id: "captain", label: "大副", icon: "trophy-line", color: TONES.rose, description: "带全班的人" });
    expect(chart.departments.map((dept) => [dept.id, dept.name, dept.icon, dept.color, dept.head.label, dept.head.icon])).toEqual([
      ["tech", "技术部", ORG_ICONS.terminal, TONES.jade, "组长", "lightbulb-line"],
      ["design", "设计部", ORG_ICONS.education, TONES.violet, "组长", "lightbulb-line"],
    ]);
    expect(chart.crew).toMatchObject({ label: "水手", description: "在读的同学" });
    expect(chart.foot.map((item) => [item.label, item.color])).toEqual([["老水手", TONES.sky], ["游客", TONES.slate]]);
    expect(JSON.stringify(chart)).not.toMatch(/舰长|队长|舰员|领航员|乘客|招新部/);
  });

  it("没有部门时不出部门卡片", () => {
    expect(orgChartModel(readOrg({ ...ORG_DEFAULTS, departments: [] })).departments).toEqual([]);
  });

  it("「关于极客班」的两句话跟着称号和部门的名字变", () => {
    expect(orgSummary(DEFAULT_ORG)).toEqual({
      members: "在读的同学是舰员，毕业的学长学姐是领航员。",
      roles: "提督和舰长总负责，下面有招新部、技术部、社区部、项目部，部门里是队长和舰员",
    });
    expect(orgSummary(readOrg(edited()))).toEqual({
      members: "在读的同学是水手，毕业的学长学姐是老水手。",
      roles: "提督和大副总负责，下面有技术部、设计部，部门里是组长和水手",
    });
    expect(orgSummary(readOrg({ ...ORG_DEFAULTS, departments: [] })).roles).toBe("提督和舰长总负责");
  });
});

describe("称号名字只写在默认值里", () => {
  it("官网源码除了 lib/org.ts 都不写死称号的名字（提督可以改名）", () => {
    const names = TITLE_IDS.map((id) => TITLES[id].label);
    const hits: string[] = [];
    for (const file of sources(PORTAL)) {
      const name = file.slice(PORTAL.length);
      if (name === "lib/org.ts") continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (names.some((label) => line.includes(label))) hits.push(`${name}:${index + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
