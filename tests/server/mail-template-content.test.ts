import { describe, expect, it } from "vitest";
import { MailTemplateError, renderEnvelope } from "../../app/server/src/lib/mail/envelope";
import {
  DEFAULT_TEMPLATES,
  RECRUITMENT_KINDS,
  SEED_TEMPLATES,
  TEMPLATE_LIMITS,
  TEMPLATE_VARIABLES,
  fillTemplate,
  normalizeContent,
  placeholdersOf,
  type TemplateContent,
} from "../../app/server/src/lib/mail/template-content";

const CDN = "https://cdn.crosery.com/yzgc/mail/v1/";
const CONTEXT = { siteOrigin: "https://yangtzeu.work", sentAt: Date.UTC(2026, 8, 26, 17, 31) };

/** 最小的合法模板：每个用例只改它要测的那一处。 */
const BASE = {
  subject: "极客班的信",
  preheader: "",
  kicker: "",
  blocks: [{ kind: "paragraph", text: "你好。" }],
};

function check(kind: Parameters<typeof normalizeContent>[0], patch: Record<string, unknown>) {
  return normalizeContent(kind, { ...BASE, ...patch });
}

const paths = (issues: { path: string }[]) => issues.map(issue => issue.path);

describe("招聘信模板的内容", () => {
  it("内置默认和迁移种子都通过编辑时用的同一套校验，规整之后不变", () => {
    expect(SEED_TEMPLATES.map(seed => seed.id)).toEqual(["default-received", "default-interview", "default-accepted", "default-rejected", "interview-short"]);
    for (const seed of SEED_TEMPLATES) {
      const { content, issues } = normalizeContent(seed.kind, seed.content as unknown as Record<string, unknown>);
      expect(issues, seed.id).toEqual([]);
      expect(content, seed.id).toEqual(seed.content);
    }
    expect(RECRUITMENT_KINDS.map(kind => DEFAULT_TEMPLATES[kind].kind)).toEqual([...RECRUITMENT_KINDS]);
  });

  it("变量清单里的名字不重复，描述不为空", () => {
    const names = TEMPLATE_VARIABLES.map(variable => variable.name);
    expect(new Set(names).size).toBe(names.length);
    for (const variable of TEMPLATE_VARIABLES) {
      expect(variable.description.length, variable.name).toBeGreaterThan(0);
      expect(variable.kinds.length, variable.name).toBeGreaterThan(0);
    }
  });

  describe("保存时的校验", () => {
    it("清单之外的变量被拒绝，并且指出是哪一个、在哪一处", () => {
      const { issues } = check("received", { subject: "给 {{部门}} 的信", blocks: [{ kind: "paragraph", text: "{{姓名}}，{{电话}}" }] });
      expect(issues.map(issue => issue.path)).toEqual(["subject", "blocks[0].text"]);
      expect(issues[0].message).toContain("部门");
      expect(issues[1].message).toContain("电话");
      expect(issues[1].message).not.toContain("姓名");
    });

    it("只在别的类别里才有的变量被拒绝，并说明它属于哪几类", () => {
      const { issues } = check("rejected", { blocks: [{ kind: "paragraph", text: "面试在 {{面试时间}}。" }] });
      expect(paths(issues)).toEqual(["blocks[0].text"]);
      expect(issues[0].message).toContain("面试时间");
      expect(issues[0].message).toContain("待面试");
      expect(issues[0].message).toContain("未通过");
      expect(check("interview", { blocks: [{ kind: "paragraph", text: "面试在 {{面试时间}}。" }] }).issues).toEqual([]);
    });

    it("变量两边的空格不影响，空的 {{ }} 和没配成对的括号被拒绝", () => {
      expect(check("received", { subject: "{{ 姓名 }}" }).issues).toEqual([]);
      expect(check("received", { subject: "{{ }}" }).issues[0].message).toContain("空的");
      expect(check("received", { subject: "{{姓名" }).issues[0].message).toContain("配成对");
      expect(check("received", { subject: "姓名}}" }).issues[0].message).toContain("配成对");
      expect(placeholdersOf("{{ 称呼 }}，{{姓名}}")).toEqual(["称呼", "姓名"]);
    });

    it("按钮只能指向官网自己的页面", () => {
      for (const path of ["https://evil.example/", "//evil.example/x", "forum/", "javascript:alert(1)", "/a b", "/\\evil.example", ""]) {
        expect(paths(check("received", { button: { label: "去看看", path } }).issues), JSON.stringify(path)).toContain("button.path");
      }
      for (const path of ["/", "/forum/", "/forum/?from=mail#top"]) {
        expect(check("received", { button: { label: "去看看", path } }).issues, path).toEqual([]);
      }
      expect(paths(check("received", { button: { label: "", path: "/forum/" } }).issues)).toEqual(["button.label"]);
    });

    it("长度、块数和整份文字的上限", () => {
      expect(paths(check("received", { subject: "字".repeat(TEMPLATE_LIMITS.subject + 1) }).issues)).toEqual(["subject"]);
      expect(paths(check("received", { subject: "" }).issues)).toEqual(["subject"]);
      expect(paths(check("received", { blocks: [] }).issues)).toEqual(["blocks"]);
      const many = Array.from({ length: TEMPLATE_LIMITS.blocks + 1 }, () => ({ kind: "paragraph", text: "一段。" }));
      expect(paths(check("received", { blocks: many }).issues)).toEqual(["blocks"]);
      const heavy = Array.from({ length: 4 }, () => ({ kind: "paragraph", text: "字".repeat(TEMPLATE_LIMITS.paragraph) }));
      const { issues } = check("received", { blocks: heavy });
      expect(paths(issues)).toEqual(["blocks"]);
      expect(issues[0].message).toContain(String(TEMPLATE_LIMITS.totalText));
    });

    it("块的结构不对时逐块指出，不认识的字段也被拒绝", () => {
      const { issues } = check("received", {
        blocks: [
          { kind: "html", text: "<b>x</b>" },
          { kind: "paragraph", text: "ok", style: "color:red" },
          { kind: "list", items: [] },
          { kind: "facts", items: [{ label: "名称", value: "x", color: "red" }] },
          "段落",
        ],
      });
      expect(paths(issues)).toEqual(["blocks[0]", "blocks[1]", "blocks[2].items", "blocks[3].items[0]", "blocks[4]"]);
    });

    it("单行文字去掉换行和控制字符，多行文字保留换行", () => {
      const { content, issues } = check("received", { subject: "一\r\n二\u0007‮三", blocks: [{ kind: "paragraph", text: "第一行\r\n\r\n第二行\u0000" }] });
      expect(issues).toEqual([]);
      expect(content.subject).not.toMatch(/[\r\n\u0007‮]/);
      expect(content.blocks[0]).toEqual({ kind: "paragraph", text: "第一行\n\n第二行" });
    });

    it("摘要、小标题、按钮、页脚可以不写", () => {
      const { content, issues } = check("received", {});
      expect(issues).toEqual([]);
      expect(content).toMatchObject({ preheader: "", kicker: "", greeting: "{{称呼}}", button: null, footer: [] });
    });
  });

  describe("拼成一封信", () => {
    const values = { 称呼: "小同学，你好：", 姓名: "小明", 班级: "计科 2301 班", 说明: "带上学生证。\n\n  提前十分钟到。 \n", 特长: "", 报名编号: "5f0c2a8e-1" };

    it("每个变量只替换一次，值里再写 {{…}} 也只是普通文字", () => {
      const content: TemplateContent = { ...DEFAULT_TEMPLATES.received.content, blocks: [{ kind: "paragraph", text: "{{姓名}} / {{班级}}" }] };
      const message = fillTemplate(content, { ...values, 姓名: "{{班级}}" }, CONTEXT);
      expect(message.blocks).toEqual([{ kind: "paragraph", text: "{{班级}} / 计科 2301 班" }]);
    });

    it("整条只写一个多行变量的列表项，每一行展开成一条；替换后为空的块和行直接去掉", () => {
      const content: TemplateContent = {
        ...DEFAULT_TEMPLATES.interview.content,
        blocks: [
          { kind: "list", title: "说明", items: ["{{说明}}", "固定的一条"] },
          { kind: "list", items: ["{{特长}}"] },
          { kind: "paragraph", text: "{{特长}}" },
          { kind: "facts", items: [{ label: "特长", value: "{{特长}}" }, { label: "班级", value: "{{班级}}" }] },
        ],
      };
      const message = fillTemplate(content, values, CONTEXT);
      expect(message.blocks).toEqual([
        { kind: "list", title: "说明", items: ["带上学生证。", "提前十分钟到。", "固定的一条"] },
        { kind: "facts", items: [{ label: "班级", value: "计科 2301 班" }] },
      ]);
    });

    it("信息表里只写报名编号的行用等宽字体", () => {
      const content: TemplateContent = { ...DEFAULT_TEMPLATES.received.content, blocks: [{ kind: "facts", items: [{ label: "编号", value: "{{ 报名编号 }}" }, { label: "班级", value: "{{班级}}" }] }] };
      expect(fillTemplate(content, values, CONTEXT).blocks).toEqual([
        { kind: "facts", items: [{ label: "编号", value: "5f0c2a8e-1", mono: true }, { label: "班级", value: "计科 2301 班" }] },
      ]);
    });

    it("按钮的链接拼在官网地址后面，指到官网之外会被链接白名单拒绝", () => {
      const ok = fillTemplate({ ...DEFAULT_TEMPLATES.received.content, button: { label: "去看看", path: "/forum/" } }, values, CONTEXT);
      expect(ok.action).toEqual({ label: "去看看", url: "https://yangtzeu.work/forum/" });
      expect(ok.siteUrl).toBe("https://yangtzeu.work/");
      const preview = fillTemplate({ ...DEFAULT_TEMPLATES.received.content, button: { label: "去看看", path: "/forum/" } }, values, { ...CONTEXT, siteOrigin: "https://prev.yangtzeu.work" });
      expect(preview.action?.url).toBe("https://prev.yangtzeu.work/forum/");
      for (const path of ["//evil.example/x", "https://evil.example/"]) {
        expect(() => fillTemplate({ ...DEFAULT_TEMPLATES.received.content, button: { label: "去看看", path } }, values, CONTEXT), path).toThrowError(MailTemplateError);
      }
      expect(() => fillTemplate(DEFAULT_TEMPLATES.received.content, values, { ...CONTEXT, siteOrigin: "https://evil.example" })).toThrowError(MailTemplateError);
    });

    it("替换进去的值在 HTML 里被转义，值里的链接不会变成可点的链接", () => {
      const hostile = {
        ...values,
        姓名: `<script>alert(1)</script>`,
        班级: `<a href="https://evil.example/">点这里</a>`,
        说明: `<img src=x onerror=alert(1)>\njavascript:alert(2)`,
      };
      const content: TemplateContent = {
        ...DEFAULT_TEMPLATES.interview.content,
        blocks: [
          { kind: "paragraph", text: "{{姓名}}" },
          { kind: "facts", items: [{ label: "{{姓名}}", value: "{{班级}}" }] },
          { kind: "list", items: ["{{说明}}"] },
        ],
      };
      const mail = renderEnvelope(fillTemplate(content, hostile, CONTEXT), { assetBase: CDN });
      expect(mail.html).not.toContain("<script>");
      expect(mail.html).not.toContain("<img src=x");
      expect(mail.html).not.toContain(`<a href="https://evil.example/">`);
      expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(mail.html).not.toMatch(/href="javascript:/i);
      const hrefs = [...mail.html.matchAll(/href="([^"]*)"/g)].map(match => match[1]);
      expect(hrefs.every(href => /^https:\/\/(prev\.)?yangtzeu\.work\//.test(href) || href.startsWith("mailto:"))).toBe(true);
    });

    it("文字用满上限的模板，连同最长的投递内容渲染出来仍小于 Gmail 会截断的 102KB", () => {
      // 20 块、一共 5980 个字；全是要转义的 & 是体积最大的情形（每个字变成 5 个字符）
      const worst = (filler: string) => normalizeContent("received", {
        subject: "主题",
        blocks: Array.from({ length: 20 }, (_, index) => ({ kind: "paragraph", text: filler.repeat(index < 19 ? 300 : 280) })),
        button: { label: "去论坛", path: "/forum/" },
        footer: ["页脚一", "页脚二"],
      });
      for (const filler of ["字", "&"]) {
        const { content, issues } = worst(filler);
        expect(issues, filler).toEqual([]);
        const longest = { ...values, 称呼: `${"名".repeat(40)}同学，你好：`, 姓名: "名".repeat(40), 班级: "班".repeat(40), 特长: "特".repeat(2000) };
        const { html } = renderEnvelope(fillTemplate(content, longest, CONTEXT), { assetBase: CDN });
        expect(Buffer.byteLength(html, "utf8"), filler).toBeLessThan(102 * 1024);
      }
    });
  });
});
