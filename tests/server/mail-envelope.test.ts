import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ENVELOPE_PIECES } from "../../app/server/src/lib/mail/envelope-pieces";
import {
  MAIL_SENDER_NAME,
  MailTemplateError,
  escapeHtml,
  formatMailDateTime,
  renderEnvelope,
  safeMailLink,
  type EnvelopeMessage,
} from "../../app/server/src/lib/mail/envelope";
import { greetingFor, recruitmentMessage, type RecruitmentInput, type RecruitmentKind } from "../../app/server/src/lib/mail/recruitment";

const CDN = "https://cdn.crosery.com/yzgc/mail/v1/";
const HOSTILE = `<img src=x onerror=alert(1)> & "q"`;
const APPLICATION_ID = "5f0c2a8e-3d41-4b6f-9a7e-1c2d3e4f5a6b";
// 2026-09-27 01:30 北京时间
const SUBMITTED = Date.UTC(2026, 8, 26, 17, 30);
const SENT = Date.UTC(2026, 8, 26, 17, 31);

function inputs(name: string): RecruitmentInput {
  const common = { name, applicationId: APPLICATION_ID, siteOrigin: "https://yangtzeu.work", sentAt: SENT };
  return {
    received: { ...common, className: "计科 2301 班", submittedAt: SUBMITTED },
    interview: { ...common, time: "9 月 30 日（周三）19:00", place: "东校区 3 教 301", notes: ["面试大约 20 分钟。", "带上学生证。"] },
    accepted: { ...common, steps: ["留意 GitHub 发来的组织邀请，接受后就能登录官网、论坛和控制台。"] },
    rejected: common,
  };
}

const KINDS: RecruitmentKind[] = ["received", "interview", "accepted", "rejected"];

function render(kind: RecruitmentKind, name = "小明") {
  return renderEnvelope(recruitmentMessage(kind, inputs(name)[kind]), { assetBase: CDN });
}

function srcs(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)].map(match => match[1]);
}

describe("mail envelope renderer", () => {
  it("builds every recruitment message with subject, html and text", () => {
    for (const kind of KINDS) {
      const mail = render(kind);
      expect(mail.subject.length, kind).toBeGreaterThan(0);
      expect(mail.subject, kind).not.toMatch(/[\r\n]/);
      expect(mail.html.startsWith("<!DOCTYPE html>"), kind).toBe(true);
      expect(mail.html, kind).toContain("小明同学，你好：");
      expect(mail.html, kind).toContain(MAIL_SENDER_NAME);
      expect(mail.text, kind).toContain("小明同学，你好：");
      expect(mail.text, kind).toContain(APPLICATION_ID);
    }
  });

  it("escapes a hostile name everywhere in the html", () => {
    for (const kind of KINDS) {
      const { html, text } = render(kind, HOSTILE);
      expect(html, kind).not.toContain("<img src=x");
      expect(html, kind).not.toContain("onerror=alert(1)>");
      expect(html, kind).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;");
      // 纯文本版本原样保留（text/plain 不会被当成 HTML）
      expect(text, kind).toContain(HOSTILE);
    }
    expect(escapeHtml(`'`)).toBe("&#39;");
  });

  it("escapes every dynamic field of a message, not only the name", () => {
    const message: EnvelopeMessage = {
      subject: `主题 ${HOSTILE}`,
      preheader: `摘要 ${HOSTILE}`,
      kicker: `小字 ${HOSTILE}`,
      greeting: `抬头 ${HOSTILE}`,
      blocks: [
        { kind: "paragraph", text: `段落 ${HOSTILE}` },
        { kind: "facts", items: [{ label: `标签 ${HOSTILE}`, value: `值 ${HOSTILE}` }] },
        { kind: "list", title: `标题 ${HOSTILE}`, items: [`条目 ${HOSTILE}`] },
      ],
      action: { label: `按钮 ${HOSTILE}`, url: "https://yangtzeu.work/forum/?a=1&b=<2>" },
      signedAt: SENT,
      footer: [`页脚 ${HOSTILE}`],
      siteUrl: "https://yangtzeu.work/",
    };
    const { html } = renderEnvelope(message, { assetBase: CDN });
    expect(html).not.toContain("<img src=x");
    expect(html.match(/&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;q&quot;/g)?.length).toBe(11);
    expect(html).toContain('href="https://yangtzeu.work/forum/?a=1&amp;b=%3C2%3E"');
  });

  it("rejects javascript:, http: and foreign action links", () => {
    const base = recruitmentMessage("accepted", inputs("小明").accepted);
    const bad = [
      "javascript:alert(1)",
      "JavaScript:alert(document.cookie)",
      "http://yangtzeu.work/join/abc",
      "https://evil.example/",
      "https://yangtzeu.work.evil.example/",
      "https://yangtzeu.work@evil.example/",
      "https://user:pass@yangtzeu.work/",
      "https://yangtzeu.work:8443/",
      "data:text/html,<script>alert(1)</script>",
      "//yangtzeu.work/",
      "not a url",
    ];
    for (const url of bad) {
      expect(() => renderEnvelope({ ...base, action: { label: "打开", url } }, { assetBase: CDN }), url).toThrow(MailTemplateError);
    }
    expect(safeMailLink("https://prev.yangtzeu.work/join/abc")).toBe("https://prev.yangtzeu.work/join/abc");
    expect(safeMailLink("https://YANGTZEU.WORK/forum/")).toBe("https://yangtzeu.work/forum/");
    expect(() => recruitmentMessage("received", { ...inputs("小明").received, siteOrigin: "http://yangtzeu.work" })).toThrow(MailTemplateError);
  });

  it("keeps the key facts in the plain-text version", () => {
    const received = render("received").text;
    expect(received).toContain("报名编号：" + APPLICATION_ID);
    expect(received).toContain("提交时间：2026 年 9 月 27 日 01:30");
    expect(received).toContain("班级：计科 2301 班");
    expect(received).toContain("去论坛看看：https://yangtzeu.work/forum/");
    expect(received).toContain("2026 年 9 月 27 日");
    expect(received).not.toMatch(/<[a-z]/i);

    const interview = render("interview").text;
    expect(interview).toContain("时间：9 月 30 日（周三）19:00");
    expect(interview).toContain("地点：东校区 3 教 301");
    expect(interview).toContain("1. 面试大约 20 分钟。");
    expect(interview).toContain("2. 带上学生证。");

    expect(render("accepted").text).toContain("1. 留意 GitHub 发来的组织邀请");
    expect(render("rejected").text).toContain("这一轮我们没能给你发出邀请");
  });

  it("uses only inline styles plus one <style> block, and no external css, scripts or layout css", () => {
    for (const kind of KINDS) {
      const { html } = render(kind);
      expect(html, kind).not.toMatch(/<link\b[^>]*rel=["']?stylesheet/i);
      expect(html, kind).not.toMatch(/<script\b/i);
      expect(html, kind).not.toMatch(/@import|@font-face|var\(--/i);
      expect(html, kind).not.toMatch(/display:\s*(flex|grid)|position:\s*(absolute|fixed|relative)/i);
      expect(html.match(/<style\b/g)?.length, kind).toBe(1);
      const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
      expect(style, kind).toContain("@media (prefers-color-scheme: dark)");
      expect(style, kind).toContain("@media only screen and (max-width: 620px)");
    }
  });

  it("parses into well-formed attributes, so inline styles actually apply", () => {
    const allowed = new Set(["lang", "xmlns", "charset", "name", "content", "class", "bgcolor", "style", "role", "width", "height", "cellpadding", "cellspacing", "border", "align", "valign", "src", "alt", "href", "target"]);
    for (const kind of KINDS) {
      const { document } = new JSDOM(render(kind).html).window;
      for (const element of document.querySelectorAll("*")) {
        for (const attribute of element.getAttributeNames()) expect(allowed.has(attribute), `${kind} <${element.tagName.toLowerCase()} ${attribute}>`).toBe(true);
      }
      const texts = [...document.querySelectorAll<HTMLElement>("p, h1, td, a")].filter(element => element.style.fontFamily);
      expect(texts.length, kind).toBeGreaterThanOrEqual(8);
      for (const element of texts) expect(element.style.fontFamily, kind).toMatch(/"PingFang SC"|"SF Mono"/);
      const button = document.querySelector<HTMLAnchorElement>("a.em-btn-a");
      if (button) {
        expect(button.style.color).toBe("rgb(255, 255, 255)");
        expect(button.style.textDecoration).toBe("none");
      }
      expect(document.querySelector<HTMLElement>(".em-kicker")?.style.color, kind).toBe("rgb(51, 70, 200)");
    }
  });

  it("points every image at assetBase with width, height and alt", () => {
    for (const kind of KINDS) {
      const { html } = render(kind);
      const images = [...html.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
      expect(images.length, kind).toBe(4);
      for (const tag of images) {
        expect(tag).toMatch(/\bwidth="\d+"/);
        expect(tag).toMatch(/\bheight="\d+"/);
        expect(tag).toMatch(/\balt="[^"]*"/);
      }
      for (const src of srcs(html)) expect(src.startsWith(CDN), src).toBe(true);
      expect(srcs(html).sort()).toEqual(Object.values(ENVELOPE_PIECES).map(piece => CDN + piece.file).sort());
    }
    const preview = renderEnvelope(recruitmentMessage("received", inputs("小明").received), { assetBase: "file:///tmp/mail-envelope/assets/" });
    for (const src of srcs(preview.html)) expect(src.startsWith("file:///tmp/mail-envelope/assets/")).toBe(true);
  });

  it("rejects an asset base that is not https or file, or does not end with a slash", () => {
    const message = recruitmentMessage("received", inputs("小明").received);
    for (const assetBase of ["http://cdn.crosery.com/yzgc/mail/v1/", "https://cdn.crosery.com/yzgc/mail/v1", "javascript:alert(1)//", "https://cdn.crosery.com/x/?a=1"]) {
      expect(() => renderEnvelope(message, { assetBase }), assetBase).toThrow(MailTemplateError);
    }
  });

  it("stays well under the 102KB clipping limit even with long content", () => {
    for (const kind of KINDS) {
      const bytes = Buffer.byteLength(render(kind).html, "utf8");
      expect(bytes, kind).toBeLessThan(40 * 1024);
    }
    const long = recruitmentMessage("interview", { ...inputs("小明").interview, notes: Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 条说明，写得长一点，看看会不会撑破版面和大小。`.repeat(3)) });
    expect(Buffer.byteLength(renderEnvelope(long, { assetBase: CDN }).html, "utf8")).toBeLessThan(102 * 1024);
  });

  it("keeps line breaks out of the subject and formats dates in Beijing time", () => {
    const message = recruitmentMessage("interview", { ...inputs("小明").interview, time: "9 月 30 日\r\nBcc: someone@example.com" });
    const mail = renderEnvelope(message, { assetBase: CDN });
    expect(mail.subject).toBe("极客班面试安排：9 月 30 日 Bcc: someone@example.com");
    expect(formatMailDateTime(Date.UTC(2026, 11, 31, 16, 5))).toBe("2027 年 1 月 1 日 00:05");
  });

  it("writes the greeting for Chinese, Latin and empty names", () => {
    expect(greetingFor("小明")).toBe("小明同学，你好：");
    expect(greetingFor("Alice")).toBe("Alice 同学，你好：");
    expect(greetingFor("  ")).toBe("你好：");
  });

  it("drops control and bidi override characters from dynamic text", () => {
    const rlo = String.fromCharCode(0x202e);
    const nul = String.fromCharCode(0);
    const { html, text, subject } = render("received", `小${rlo}明${nul}`);
    expect(html).toContain("小明同学，你好：");
    expect(text).toContain("小明同学，你好：");
    expect(html.includes(rlo) || html.includes(nul) || text.includes(rlo) || subject.includes(rlo)).toBe(false);
  });
});
