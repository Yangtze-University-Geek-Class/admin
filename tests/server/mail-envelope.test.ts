import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ENVELOPE_PIECES } from "../../app/server/src/lib/mail/envelope-pieces";
import {
  MAIL_SENDER_NAME,
  MailTemplateError,
  escapeHtml,
  formatMailDate,
  formatMailDateTime,
  renderEnvelope,
  safeMailLink,
  safeReplyTo,
  type EnvelopeMessage,
} from "../../app/server/src/lib/mail/envelope";
import { COMPOUND_SURNAMES, greetingFor, recruitmentMessage, type RecruitmentInput, type RecruitmentKind } from "../../app/server/src/lib/mail/recruitment";

const CDN = "https://cdn.crosery.com/yzgc/mail/v1/";
const HOSTILE = `<img src=x onerror=alert(1)> & "q"`;
const APPLICATION_ID = "5f0c2a8e-3d41-4b6f-9a7e-1c2d3e4f5a6b";
// 2026-09-27 01:30 北京时间
const SUBMITTED = Date.UTC(2026, 8, 26, 17, 30);
const SENT = Date.UTC(2026, 8, 26, 17, 31);
const REPLY_TO = "join@example.com";

const STRENGTHS = "做过一个课表小程序，\n后端用 Go，前端用 Vue。<b>喜欢</b> & 折腾。";

function inputs(name: string): RecruitmentInput {
  const common = {
    name, className: "计科 2301 班", email: "xiaoming@example.com", submittedAt: SUBMITTED,
    applicationId: APPLICATION_ID, siteOrigin: "https://yangtzeu.work", sentAt: SENT,
  };
  return {
    received: { ...common, strengths: STRENGTHS },
    interview: { ...common, time: "9 月 30 日（周三）19:00", place: "东校区 3 教 301", notes: ["面试大约 20 分钟。", "带上学生证。"], replyTo: REPLY_TO },
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
      expect(new JSDOM(mail.html).window.document.querySelector("h1")?.textContent, kind).toBe("小同学，你好：");
      expect(mail.html, kind).toContain(MAIL_SENDER_NAME);
      expect(mail.text, kind).toContain("小同学，你好：");
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
        { kind: "facts", title: `事实 ${HOSTILE}`, items: [{ label: `标签 ${HOSTILE}`, value: `值 ${HOSTILE}` }] },
        { kind: "list", title: `标题 ${HOSTILE}`, items: [`条目 ${HOSTILE}`] },
        { kind: "quote", title: `引用 ${HOSTILE}`, text: `第一行 ${HOSTILE}\n第二行` },
      ],
      action: { label: `按钮 ${HOSTILE}`, url: "https://yangtzeu.work/forum/?a=1&b=<2>" },
      signedAt: SENT,
      footer: [`页脚 ${HOSTILE}`],
      siteUrl: "https://yangtzeu.work/",
    };
    const { html } = renderEnvelope(message, { assetBase: CDN });
    expect(html).not.toContain("<img src=x");
    expect(html.match(/&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;q&quot;/g)?.length).toBe(14);
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
    expect(received).toContain("投递时间：2026 年 9 月 27 日 01:30（北京时间）");
    expect(received).toContain("班级：计科 2301 班");
    expect(received).toContain("去论坛看看：https://yangtzeu.work/forum/");
    expect(received).toContain("2026 年 9 月 27 日");
    // 模板不往纯文本里放标签；引用的特长原样保留投递人写的 <b>
    expect(received.replace("<b>喜欢</b>", "")).not.toMatch(/<[a-z]/i);

    const interview = render("interview").text;
    expect(interview).toContain("时间：9 月 30 日（周三）19:00");
    expect(interview).toContain("地点：东校区 3 教 301");
    expect(interview).toContain("1. 面试大约 20 分钟。");
    expect(interview).toContain("2. 带上学生证。");

    expect(render("accepted").text).toContain("1. 留意 GitHub 发来的组织邀请");
    expect(render("rejected").text).toContain("这一轮没能请你加入极客班。");
  });

  it("does not promise the rejected applicant anything the forum or the process does not give", () => {
    const { html, text } = render("rejected");
    for (const body of [html, text]) {
      // 游客只能看帖、用昵称回复，发不了帖（docs/services/forum/README.md）
      expect(body).toContain("论坛不登录也能看帖，也可以用昵称回复。");
      expect(body).not.toMatch(/对所有人开放|发帖/);
      // 面试之后才改成未通过的人也会收到这封信，名额的理由不由模板替每个人写
      expect(body).not.toMatch(/没能给你发出邀请|名额/);
    }
    const reason = "这一轮我们更想找做过后端项目的同学。";
    expect(renderEnvelope(recruitmentMessage("rejected", { ...inputs("小明").rejected, reason }), { assetBase: CDN }).text).toContain(reason);
    expect(text).not.toContain(reason);
  });

  it("asks for a reply only when there is a reply-to address, and hands that address to the sender", () => {
    const withoutReply = render("received");
    expect(withoutReply.replyTo).toBeNull();
    expect(withoutReply.html).not.toContain("回复这封邮件");
    expect(withoutReply.html).toContain("有问题可以到官网的意见箱留言，联系方式一栏填这个邮箱。");
    expect(render("accepted").html).toContain("可以到官网的意见箱留言");
    expect(render("accepted").replyTo).toBeNull();

    for (const kind of ["received", "accepted"] as const) {
      const mail = renderEnvelope(recruitmentMessage(kind, { ...inputs("小明")[kind], replyTo: ` ${REPLY_TO} ` }), { assetBase: CDN });
      expect(mail.replyTo, kind).toBe(REPLY_TO);
      expect(mail.html, kind).toContain("直接回复这封邮件");
      expect(mail.text, kind).toContain("直接回复这封邮件");
    }
    const interview = render("interview");
    expect(interview.replyTo).toBe(REPLY_TO);
    expect(interview.text).toContain("直接回复这封邮件说一声");

    // 待面试的信没有回信地址时，改约也指向意见箱，不请人直接回复
    const noReply = renderEnvelope(recruitmentMessage("interview", { ...inputs("小明").interview, replyTo: undefined }), { assetBase: CDN });
    expect(noReply.replyTo).toBeNull();
    expect(noReply.text).toContain("这个时间来不了的话，到官网的意见箱留言，联系方式一栏填这个邮箱，我们再约。");
    expect(noReply.html + noReply.text).not.toMatch(/回复这封邮件|直接回信/);
    // 以后的站内通知也一样：文字里请人回复却没给地址
    const custom: EnvelopeMessage = { ...recruitmentMessage("rejected", inputs("小明").rejected), blocks: [{ kind: "paragraph", text: "有事直接回复这封邮件。" }] };
    expect(() => renderEnvelope(custom, { assetBase: CDN })).toThrow(MailTemplateError);

    for (const replyTo of ["", "not-an-email", "a@b.com\r\nBcc: x@evil.example", "<a@b.com>", "a@b.com, c@d.com", "a b@c.com", "a@localhost"]) {
      expect(() => renderEnvelope({ ...custom, replyTo }, { assetBase: CDN }), JSON.stringify(replyTo)).toThrow(MailTemplateError);
      expect(() => safeReplyTo(replyTo), JSON.stringify(replyTo)).toThrow(MailTemplateError);
    }
  });

  it("requires the interview time and place, and only mentions interview notes when there are some", () => {
    const base = inputs("小明").interview;
    for (const blank of [{ time: "" }, { time: " \n " }, { place: "" }]) {
      expect(() => recruitmentMessage("interview", { ...base, ...blank }), JSON.stringify(blank)).toThrow(MailTemplateError);
    }
    expect(recruitmentMessage("interview", base).preheader).toBe("9 月 30 日（周三）19:00，东校区 3 教 301。面试说明在信里。");
    const bare = recruitmentMessage("interview", { ...base, notes: [" ", ""] });
    expect(bare.preheader).toBe("9 月 30 日（周三）19:00，东校区 3 教 301。");
    const mail = renderEnvelope(bare, { assetBase: CDN });
    expect(mail.html).not.toContain("面试说明");
    expect(mail.text).not.toContain("面试说明");
  });

  it("lets long names and long words wrap instead of widening the letter", () => {
    const longName = "AlexanderMaximilianWellingtonTheThirdJr";
    const { document } = new JSDOM(render("interview", longName).html).window;
    const h1 = document.querySelector("h1");
    expect(h1?.textContent).toContain(longName);
    const wraps = (element: Element | null) => (element?.getAttribute("style") ?? "").includes("overflow-wrap:anywhere");
    expect(wraps(h1)).toBe(true);
    expect(wraps(document.querySelector(".em-kicker"))).toBe(true);
    // 正文段落、事实栏的值、列表条目、页脚
    const texts = [...document.querySelectorAll("td.em-sheet > p.em-ink, td.em-ink, .em-foot")];
    expect(texts.length).toBeGreaterThanOrEqual(8);
    for (const element of texts) expect(wraps(element), element.outerHTML.slice(0, 80)).toBe(true);
    // 邮票格按比例缩：不支持 <style> 的客户端在窄屏上也不会把抬头挤成一列
    const stampCell = document.querySelector<HTMLElement>(".em-stamp-cell");
    expect(stampCell?.getAttribute("width")).toBe("29%");
    const stamp = document.querySelector<HTMLImageElement>("img.em-stamp");
    expect(stamp?.style.width).toBe("100%");
    expect(stamp?.style.maxWidth).toBe("150px");
    expect(stamp?.getAttribute("width")).toBe("150");
  });

  it("gives the button padding that Outlook desktop keeps", () => {
    const { html } = render("received");
    expect(html).toMatch(/<td class="em-btn"[^>]*style="[^"]*mso-padding-alt:13px 28px;/);
    expect(html).toMatch(/<a class="em-btn-a"[^>]*style="[^"]*padding:13px 28px;/);
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
    const allowed = new Set(["lang", "xmlns", "charset", "name", "content", "class", "bgcolor", "style", "role", "width", "height", "cellpadding", "cellspacing", "border", "align", "valign", "src", "alt", "referrerpolicy", "href", "target"]);
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

  it("points every image at assetBase with width, height and alt, and sends no Referer (the CDN refuses webmail Referers)", () => {
    for (const kind of KINDS) {
      const { html } = render(kind);
      const images = [...html.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
      expect(images.length, kind).toBe(4);
      for (const tag of images) {
        expect(tag).toMatch(/\bwidth="\d+"/);
        expect(tag).toMatch(/\bheight="\d+"/);
        expect(tag).toMatch(/\balt="[^"]*"/);
        expect(tag).toContain('referrerpolicy="no-referrer"');
      }
      for (const src of srcs(html)) expect(src.startsWith(CDN), src).toBe(true);
      expect(srcs(html).sort()).toEqual(Object.values(ENVELOPE_PIECES).map(piece => CDN + piece.file).sort());
    }
    const preview = renderEnvelope(recruitmentMessage("received", inputs("小明").received), { assetBase: "file:///tmp/mail-envelope/assets/", allowFileAssets: true });
    for (const src of srcs(preview.html)) expect(src.startsWith("file:///tmp/mail-envelope/assets/")).toBe(true);
  });

  it("rejects an asset base that is not https, or does not end with a slash; file:// only when preview asks for it", () => {
    const message = recruitmentMessage("received", inputs("小明").received);
    for (const assetBase of ["http://cdn.crosery.com/yzgc/mail/v1/", "https://cdn.crosery.com/yzgc/mail/v1", "javascript:alert(1)//", "https://cdn.crosery.com/x/?a=1", "file:///tmp/mail-envelope/assets/"]) {
      expect(() => renderEnvelope(message, { assetBase }), assetBase).toThrow(MailTemplateError);
    }
    expect(() => renderEnvelope(message, { assetBase: "file:///tmp/mail-envelope/assets", allowFileAssets: true })).toThrow(MailTemplateError);
    expect(() => renderEnvelope(message, { assetBase: "http://cdn.crosery.com/yzgc/mail/v1/", allowFileAssets: true })).toThrow(MailTemplateError);
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
    // U+2028 / U+2029 有的客户端会显示成换行，也换成空格
    const separators = renderEnvelope(recruitmentMessage("interview", { ...inputs("小明").interview, time: "9 月 30 日\u2028Bcc: a@b.c\u202919:00" }), { assetBase: CDN });
    expect(separators.subject).toBe("极客班面试安排：9 月 30 日 Bcc: a@b.c 19:00");
    expect(/[\u2028\u2029]/.test(separators.html + separators.text)).toBe(false);
    expect(formatMailDateTime(Date.UTC(2026, 11, 31, 16, 5))).toBe("2027 年 1 月 1 日 00:05");
  });

  it("greets by surname for Chinese names and by the whole name otherwise", () => {
    expect(greetingFor("张三")).toBe("张同学，你好：");
    expect(greetingFor("测试")).toBe("测同学，你好：");
    expect(greetingFor(" 李小满 ")).toBe("李同学，你好：");
    expect(greetingFor("欧阳娜娜")).toBe("欧阳同学，你好：");
    expect(greetingFor("司马光")).toBe("司马同学，你好：");
    expect(greetingFor("叱干阿利")).toBe("叱干同学，你好：");
    // 两个字的名字分不清复姓还是姓加名，按单姓
    expect(greetingFor("欧阳")).toBe("欧同学，你好：");
    // 不在复姓清单里的前两个字不算复姓
    expect(greetingFor("张王五")).toBe("张同学，你好：");
    // 补充平面的汉字不会被切开
    expect(greetingFor("\u{20BB7}野家")).toBe("\u{20BB7}同学，你好：");
    expect(greetingFor("Alice")).toBe("Alice 同学，你好：");
    expect(greetingFor("Alice 张")).toBe("Alice 张同学，你好：");
    expect(greetingFor("  ")).toBe("你好：");
    expect(greetingFor("")).toBe("你好：");
    // 「单于」是称号不是常见的姓：姓单、名字以「于」开头的按单姓
    expect(greetingFor("单于洋")).toBe("单同学，你好：");
    expect(COMPOUND_SURNAMES).not.toContain("单于");
    expect(COMPOUND_SURNAMES).toHaveLength(37);
    for (const surname of COMPOUND_SURNAMES) expect(greetingFor(`${surname}某`), surname).toBe(`${surname}同学，你好：`);

    // 信里：抬头写姓，事实栏写全名；「你好：」不拆开，窄屏折在逗号后面；没有任何头像
    const mail = render("received", "欧阳娜娜");
    const { document } = new JSDOM(mail.html).window;
    expect(document.querySelector("h1")?.innerHTML).toBe('欧阳同学，<span style="white-space:nowrap;">你好：</span>');
    expect(mail.text).toContain("欧阳同学，你好：");
    expect(mail.text).toContain("姓名：欧阳娜娜");
    for (const kind of KINDS) expect(render(kind, "欧阳娜娜").html, kind).not.toMatch(/avatar/i);
    // 恶意的名字不是汉字开头，照写全名并转义
    expect(render("received", HOSTILE).html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot; 同学，");
  });

  it("puts the applicant's own details in every letter", () => {
    const facts = [
      "你的报名信息",
      "姓名：小明",
      "班级：计科 2301 班",
      "邮箱：xiaoming@example.com",
      "投递时间：2026 年 9 月 27 日 01:30（北京时间）",
      `报名编号：${APPLICATION_ID}`,
    ];
    for (const kind of KINDS) {
      const { html, text } = render(kind);
      for (const line of facts) expect(text, `${kind} ${line}`).toContain(line);
      const { document } = new JSDOM(html).window;
      const labels = [...document.querySelectorAll(".em-fact-label")].map(cell => cell.textContent);
      expect(labels, kind).toEqual(expect.arrayContaining(["姓名", "班级", "邮箱", "投递时间", "报名编号"]));
      expect(html, kind).toContain("你的报名信息");
    }
  });

  it("quotes the strengths in full, escaped and line by line, only in the received letter", () => {
    const { html, text } = render("received");
    expect(html).toContain("你写的特长与优点");
    expect(html).toContain("做过一个课表小程序，<br>后端用 Go，前端用 Vue。&lt;b&gt;喜欢&lt;/b&gt; &amp; 折腾。");
    expect(html).not.toContain("<b>喜欢</b>");
    expect(text).toContain("你写的特长与优点\n> 做过一个课表小程序，\n> 后端用 Go，前端用 Vue。<b>喜欢</b> & 折腾。\n");
    for (const kind of ["interview", "accepted", "rejected"] as const) expect(render(kind).text, kind).not.toContain("课表小程序");
    // 投递人自己写了「回复这封邮件」也不算我们请人回信，没有回信地址照样能渲染
    const own = { ...inputs("小明").received, strengths: "看到招新就想直接回复这封邮件报名。" };
    expect(renderEnvelope(recruitmentMessage("received", own), { assetBase: CDN }).text).toContain("> 看到招新就想直接回复这封邮件报名。");
  });

  it("stays under the 102KB clipping limit with a 2000-character strengths text and a 40-character name", () => {
    const long = { ...inputs("张".repeat(40)).received, strengths: "我".repeat(1000) + "\n" + "a".repeat(999) };
    const { html } = renderEnvelope(recruitmentMessage("received", long), { assetBase: CDN });
    expect(html).toContain("我".repeat(1000));
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(102 * 1024);
  });

  it("writes every time and date in Beijing time whatever the process time zone is", () => {
    const saved = process.env.TZ;
    try {
      for (const zone of ["UTC", "America/Los_Angeles", "Asia/Shanghai"]) {
        process.env.TZ = zone;
        // 03:00Z 是北京时间 11:00；先证明这个进程的本地时区真的换了
        const at = Date.parse("2026-09-27T03:00:00Z");
        if (zone === "UTC") expect(new Date(at).getHours()).toBe(3);
        if (zone === "America/Los_Angeles") expect(new Date(at).getHours()).toBe(20);
        expect(formatMailDateTime(at), zone).toBe("2026 年 9 月 27 日 11:00");
        // 北京时间已经过了零点、UTC 还是前一天
        expect(formatMailDate(Date.UTC(2026, 8, 26, 17, 30)), zone).toBe("2026 年 9 月 27 日");
        const letter = renderEnvelope(recruitmentMessage("received", { ...inputs("小明").received, submittedAt: at, sentAt: Date.UTC(2026, 8, 26, 16, 5) }), { assetBase: CDN });
        expect(letter.text, zone).toContain("投递时间：2026 年 9 月 27 日 11:00（北京时间）");
        // 落款日期
        expect(letter.text, zone).toContain("长江大学极客班\n2026 年 9 月 27 日\n");
      }
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it("drops control and bidi override characters from dynamic text", () => {
    const rlo = String.fromCharCode(0x202e);
    const nul = String.fromCharCode(0);
    // 控制字符先去掉再取姓：去不掉的话第一个字是 U+202E，会照写全名
    const { html, text, subject } = render("received", `${rlo}小${nul}明`);
    expect(new JSDOM(html).window.document.querySelector("h1")?.textContent).toBe("小同学，你好：");
    expect(text).toContain("小同学，你好：");
    expect(text).toContain("姓名：小明");
    expect(html.includes(rlo) || html.includes(nul) || text.includes(rlo) || subject.includes(rlo)).toBe(false);
  });
});
