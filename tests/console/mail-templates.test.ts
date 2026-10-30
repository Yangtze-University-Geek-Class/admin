// 「邮件模板」页的纯逻辑（lib/mail-templates）和开发预览里的样板（mock/mail-templates），不挂载组件（#285）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../app/console/src/lib/http";
import {
  IDLE_PREVIEW, blocksToText, copyName, createBody, createPreviewer, draftContent, draftFromTemplate, draftSnapshot, fieldValue,
  groupByKind, insertAtCaret, insertFence, insertVariable, issueCount, issuesOf, newDraft, placeIssues, previewFailure, previewPayload,
  setFieldValue, statusRoutes, templateFlags, testAddressError, testSendFailure, testSendOutcome, textToBlocks, updateBody, variableToken, variablesFor,
  type PreviewPayload, type PreviewState, type Timers,
} from "../../app/console/src/lib/mail-templates";
import { SEED_TEMPLATES } from "../../app/server/src/lib/mail/template-content";
import { MOCK_MAIL_LIST, MOCK_MAIL_TEMPLATES, mockLetterTemplates } from "../../app/console/src/mock/mail-templates";
import { routeConsole } from "../../app/console/src/mock/console";
import { mockApi } from "../../app/console/src/mock";
import type { MailRendered, MailTemplate, MailTemplateContent, MailTemplateList } from "../../app/console/src/lib/types";

afterEach(() => vi.unstubAllGlobals());
const as = (persona: string) => vi.stubGlobal("window", { location: { search: `?__persona=${persona}` } });
const get = <T>(path: string) => routeConsole(new URL(path, "http://mock.local")) as T;
const post = (path: string, body: unknown) => mockApi(path, { method: "POST", body: JSON.stringify(body) });

const content = (patch: Partial<MailTemplateContent> = {}): MailTemplateContent => ({
  subject: "极客班面试：{{面试时间}}", preheader: "{{面试时间}}，{{面试地点}}", kicker: "招新进度 · 待面试", greeting: "{{称呼}}",
  blocks: [
    { kind: "paragraph", text: "请按下面的时间和地点来面试。" },
    { kind: "facts", items: [{ label: "时间", value: "{{面试时间}}" }, { label: "地点", value: "{{面试地点}}" }] },
    { kind: "list", title: "面试说明", items: ["{{说明}}", "带上学生证"] },
    { kind: "quote", title: "你写的", text: "{{特长}}" },
  ],
  button: { label: "去论坛看看", path: "/forum/" }, footer: ["第一行", "第二行"], ...patch,
});
const template = (patch: Partial<MailTemplate> = {}): MailTemplate => ({
  id: "t-1", name: "简短", kind: "interview", enabled: true, is_default: false, ...content(),
  created_by: "fixture-owner", created_at: 1, updated_by: "fixture-owner", updated_at: 7, ...patch,
});

describe("draft and request body", () => {
  it("turns a saved template into a form draft and back without changing a word", () => {
    const original = template();
    expect(draftContent(draftFromTemplate(original))).toEqual(content());
  });

  it("writes the body as plain text: paragraphs split by a blank line, a fact table, a list and a quote as fenced parts", () => {
    const draft = draftFromTemplate(template());
    expect(draft.body).toBe([
      "请按下面的时间和地点来面试。",
      "",
      ":::信息",
      "时间：{{面试时间}}",
      "地点：{{面试地点}}",
      ":::",
      "",
      ":::要点 面试说明",
      "{{说明}}",
      "带上学生证",
      ":::",
      "",
      ":::引用 你写的",
      "{{特长}}",
      ":::",
    ].join("\n"));
    expect(draft.footer).toBe("第一行\n第二行");
  });

  it("reads typed text back into blocks, dropping blank lines and blank titles and trimming each item", () => {
    const draft = draftFromTemplate(template());
    draft.body = "第一段\n接着写\n\n\n第二段\n\n:::要点\n\n  一条  \n\n另一条\n:::\n\n:::信息   \n时间 : {{面试时间}}\n地点：东校区：3 教\n:::";
    draft.footer = "只有一行\n\n";
    const out = draftContent(draft);
    expect(out.blocks).toEqual([
      { kind: "paragraph", text: "第一段\n接着写" },
      { kind: "paragraph", text: "第二段" },
      { kind: "list", items: ["一条", "另一条"] },
      { kind: "facts", items: [{ label: "时间", value: "{{面试时间}}" }, { label: "地点", value: "东校区：3 教" }] },
    ]);
    expect(out.footer).toEqual(["只有一行"]);
  });

  it("sends the button as null when it is off and trims its path when on", () => {
    const draft = draftFromTemplate(template());
    draft.buttonPath = " /forum/ ";
    expect(draftContent(draft).button).toEqual({ label: "去论坛看看", path: "/forum/" });
    draft.buttonOn = false;
    expect(draftContent(draft).button).toBeNull();
  });

  it("builds a create body with the kind and an update body with the version it was read at, never the kind", () => {
    const draft = draftFromTemplate(template());
    expect(createBody(draft)).toMatchObject({ name: "简短", kind: "interview", subject: "极客班面试：{{面试时间}}", button: { path: "/forum/" } });
    const update = updateBody(draft, 7);
    expect(update).toMatchObject({ name: "简短", expected_updated_at: 7, subject: "极客班面试：{{面试时间}}" });
    expect(update).not.toHaveProperty("kind");
  });

  it("starts a new draft from the default of its kind, with no id, or with an empty body", () => {
    const fromDefault = newDraft("interview", content(), "新的一套");
    expect(fromDefault.id).toBeNull();
    expect(fromDefault.name).toBe("新的一套");
    expect(draftContent(fromDefault)).toEqual(content());
    const empty = newDraft("rejected", null);
    expect(empty.body).toBe("");
    expect(empty.greeting).toBe("{{称呼}}");
    expect(empty.buttonOn).toBe(false);
    expect(draftContent(empty).blocks).toEqual([]);
  });

  it("sees an edit in the snapshot, in the body too", () => {
    const a = draftFromTemplate(template());
    const b = draftFromTemplate(template());
    expect(draftSnapshot(a)).toBe(draftSnapshot(b));
    b.subject = "改过了";
    expect(draftSnapshot(a)).not.toBe(draftSnapshot(b));
    const c = draftFromTemplate(template());
    c.body += "\n\n多一段";
    expect(draftSnapshot(a)).not.toBe(draftSnapshot(c));
  });

  it("names a copy after the original and skips names already taken in the same kind, ignoring case", () => {
    expect(copyName("简短", ["简短", "默认"], 40)).toBe("简短（副本）");
    expect(copyName("简短", ["简短", "简短（副本）"], 40)).toBe("简短（副本 2）");
    expect(copyName("Short", ["short（副本）"], 40)).toBe("Short（副本 2）");
    expect([...copyName("一".repeat(40), [], 40)]).toHaveLength(40);
  });
});

describe("body text", () => {
  it("turns every built-in template into text and back without changing a block", () => {
    expect(SEED_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    for (const seed of SEED_TEMPLATES) expect(textToBlocks(blocksToText(seed.content.blocks as never))).toEqual(seed.content.blocks);
  });

  it("keeps a line that starts with ::: as plain text by escaping it, in a paragraph, a list item and a quote", () => {
    const blocks = [
      { kind: "paragraph" as const, text: "第一行\n:::要点 不是块\n第三行" },
      { kind: "list" as const, items: [":::", "正常一条"] },
      { kind: "quote" as const, title: "标题", text: ":::\n引用里的冒号：不用转义" },
    ];
    const text = blocksToText(blocks);
    expect(text).toContain("\\:::要点 不是块");
    expect(textToBlocks(text)).toEqual(blocks);
  });

  it("accepts the longer names and a block that was never closed, leaving the server to say what is missing", () => {
    expect(textToBlocks(":::要点列表 说明\n一条")).toEqual([{ kind: "list", title: "说明", items: ["一条"] }]);
    expect(textToBlocks(":::信息表\n没有冒号的一行")).toEqual([{ kind: "facts", items: [{ label: "没有冒号的一行", value: "" }] }]);
    expect(textToBlocks(":::引用")).toEqual([{ kind: "quote", title: "", text: "" }]);
    expect(textToBlocks(":::不认识的 名字\n照样是一段")).toEqual([{ kind: "paragraph", text: ":::不认识的 名字\n照样是一段" }]);
    expect(textToBlocks("  \n\n")).toEqual([]);
  });

  it("inserts the writing of a list, a fact table or a quote at the caret as its own part, with a blank line either side", () => {
    expect(insertFence("", null, "list")).toEqual({ value: ":::要点\n第一条\n第二条\n:::\n", caret: ":::要点\n".length });
    const middle = insertFence("上一段\n\n下一段", { start: 4, end: 4 }, "facts");
    expect(middle.value).toBe("上一段\n\n:::信息\n名称：内容\n名称：内容\n:::\n\n下一段");
    expect(middle.value.slice(middle.caret, middle.caret + 5)).toBe("名称：内容");
    expect(insertFence("只有一段", null, "quote").value).toBe("只有一段\n\n:::引用 标题\n引用的话\n:::\n");
    expect(textToBlocks(insertFence("上一段", null, "quote").value)).toEqual([
      { kind: "paragraph", text: "上一段" }, { kind: "quote", title: "标题", text: "引用的话" },
    ]);
  });
});

describe("inserting a variable (click-to-insert)", () => {
  it("puts the variable at the caret, replaces a selection, and appends when the caret is unknown", () => {
    expect(insertAtCaret("主题：", { start: 3, end: 3 }, "{{姓名}}")).toEqual({ value: "主题：{{姓名}}", caret: 3 + "{{姓名}}".length });
    expect(insertAtCaret("你好 X 同学", { start: 3, end: 4 }, "{{姓名}}")).toEqual({ value: "你好 {{姓名}} 同学", caret: 3 + "{{姓名}}".length });
    expect(insertAtCaret("你好", null, "{{姓名}}")).toEqual({ value: "你好{{姓名}}", caret: 2 + "{{姓名}}".length });
    expect(insertAtCaret("你好", { start: 99, end: 99 }, "{{姓名}}").value).toBe("你好{{姓名}}");
    expect(insertAtCaret("abc", { start: 2, end: 0 }, "X").value).toBe("Xc");
  });

  it("writes the variable as {{name}}", () => {
    expect(variableToken("面试时间")).toBe("{{面试时间}}");
  });

  it("inserts into the field that was last focused, whichever kind of field it is, and reports the new caret", () => {
    const draft = draftFromTemplate(template());
    expect(insertVariable(draft, { field: "subject", caret: { start: 0, end: 0 } }, "姓名")).toBe("{{姓名}}".length);
    expect(draft.subject).toBe("{{姓名}}极客班面试：{{面试时间}}");

    insertVariable(draft, { field: "body", caret: { start: 0, end: 0 } }, "官网");
    expect(draft.body.startsWith("{{官网}}请按下面的时间和地点来面试。")).toBe(true);
    expect(textToBlocks(draft.body)[0]).toEqual({ kind: "paragraph", text: "{{官网}}请按下面的时间和地点来面试。" });
    insertVariable(draft, { field: "body", caret: null }, "称呼");
    expect(draft.body.endsWith(":::{{称呼}}")).toBe(true);

    insertVariable(draft, { field: "button.label", caret: null }, "称呼");
    expect(draft.buttonLabel).toBe("去论坛看看{{称呼}}");
    insertVariable(draft, { field: "footer", caret: null }, "报名编号");
    expect(draft.footer.endsWith("{{报名编号}}")).toBe(true);
  });

  it("refuses a field that does not exist instead of writing somewhere else", () => {
    const draft = draftFromTemplate(template());
    const before = draftSnapshot(draft);
    expect(insertVariable(draft, { field: "blocks[0].text", caret: null }, "姓名")).toBeNull();
    expect(insertVariable(draft, { field: "nope", caret: null }, "姓名")).toBeNull();
    expect(fieldValue(draft, "nope")).toBeNull();
    expect(setFieldValue(draft, "nope", "x")).toBe(false);
    expect(draftSnapshot(draft)).toBe(before);
  });

  it("lists only the variables a kind of letter can use, grouped in the server's order", () => {
    const interview = variablesFor("interview", MOCK_MAIL_LIST.variables);
    expect(interview.map(group => group.label)).toEqual(["投递人", "改状态时填的", "整句"]);
    expect(interview[1].variables.map(item => item.name)).toEqual(["面试时间", "面试地点", "说明"]);
    const received = variablesFor("received", MOCK_MAIL_LIST.variables);
    expect(received.flatMap(group => group.variables).map(item => item.name)).not.toContain("面试时间");
    expect(received.flatMap(group => group.variables).map(item => item.name)).not.toContain("说明");
    expect(variablesFor("rejected", MOCK_MAIL_LIST.variables).flatMap(group => group.variables).map(item => item.name)).toContain("说明");
  });
});

describe("server problems shown at the field", () => {
  it("puts each problem on its own input, keeping several for one input, and every block problem on the body", () => {
    const placed = placeIssues([
      { path: "subject", message: "主题里的「部门」不是可用的变量" },
      { path: "subject", message: "主题最多 100 个字" },
      { path: "blocks[0].text", message: "第 1 块的段落不能为空" },
      { path: "blocks[1].items[1].value", message: "第 2 块第 2 行的内容不能为空" },
      { path: "blocks[2].items[1]", message: "第 3 块的第 2 条不能为空" },
      { path: "blocks[3]", message: "第 4 块多了不认识的内容" },
      { path: "blocks", message: "整份模板的文字最多 6000 个字" },
      { path: "button.path", message: "按钮的路径要从 / 开始" },
      { path: "name", message: "名称不能为空" },
    ]);
    expect(placed.byField.subject).toEqual(["主题里的「部门」不是可用的变量", "主题最多 100 个字"]);
    expect(placed.byField.body).toEqual([
      "第 1 块的段落不能为空", "第 2 块第 2 行的内容不能为空", "第 3 块的第 2 条不能为空", "第 4 块多了不认识的内容", "整份模板的文字最多 6000 个字",
    ]);
    expect(placed.byField["button.path"]).toHaveLength(1);
    expect(placed.byField.name).toHaveLength(1);
    expect(placed.general).toEqual([]);
    expect(issueCount(placed)).toBe(9);
  });

  it("keeps one copy of a problem that both the save and the preview pointed at", () => {
    const placed = placeIssues([
      { path: "blocks", message: "正文至少要有一块" }, { path: "blocks", message: "正文至少要有一块" },
      { path: "", message: "没有配置回信地址" }, { path: "", message: "没有配置回信地址" },
    ]);
    expect(placed.byField.body).toEqual(["正文至少要有一块"]);
    expect(placed.general).toEqual(["没有配置回信地址"]);
    expect(issueCount(placed)).toBe(2);
  });

  it("puts one footer line on the footer box, and keeps whole-template and unknown problems for the page to write out", () => {
    const placed = placeIssues([
      { path: "footer[1]", message: "页脚第 2 行最多 200 个字" },
      { path: "", message: "没有配置回信地址，信里不能请对方直接回复" },
      { path: "somewhere", message: "不认识的位置" },
    ]);
    expect(placed.byField.footer).toEqual(["页脚第 2 行最多 200 个字"]);
    expect(placed.general).toEqual(["没有配置回信地址，信里不能请对方直接回复", "不认识的位置"]);
  });

  it("reads the problems out of a 400 template_invalid and ignores anything else", () => {
    const issues = [{ path: "subject", message: "主题不能为空" }, { path: "blocks[0].text", message: "第 1 块的段落不能为空" }];
    const error = new ApiError(400, "template_invalid", "主题不能为空", undefined, { error: "template_invalid", issues });
    expect(issuesOf(error)).toEqual(issues);
    expect(issuesOf(new ApiError(500, "boom", "x", undefined, { issues: "nope" }))).toEqual([]);
    expect(issuesOf(new ApiError(400, "template_invalid", "x", undefined, { issues: [{ path: 1 }, { path: "a", message: "b" }] }))).toEqual([{ path: "a", message: "b" }]);
    expect(issuesOf(new Error("network"))).toEqual([]);
  });

  it("says the first problem and how many more there are, or that the network is gone", () => {
    const issues = [{ path: "subject", message: "主题不能为空" }, { path: "blocks[0].text", message: "第 1 块的段落不能为空" }];
    const many = previewFailure(new ApiError(400, "template_invalid", "主题不能为空", undefined, { issues }));
    expect(many.message).toBe("主题不能为空（另有 1 处，已标在对应的输入框下面）");
    expect(many.issues).toEqual(issues);
    expect(previewFailure(new ApiError(400, "preview_failed", "现在没有配置回信地址，信里不能请对方直接回复这封邮件，换个说法"))).toEqual({
      message: "现在没有配置回信地址，信里不能请对方直接回复这封邮件，换个说法", issues: [],
    });
    expect(previewFailure(new TypeError("Failed to fetch")).message).toBe("连不上服务器，预览没有更新");
  });
});

describe("preview request body", () => {
  it("sends the draft with its kind, and leaves out sample fields nobody filled in", () => {
    const draft = draftFromTemplate(template());
    const bare = previewPayload(draft);
    expect(bare.draft.kind).toBe("interview");
    expect(bare.draft.subject).toBe("极客班面试：{{面试时间}}");
    expect(bare).not.toHaveProperty("sample");
    expect(bare).not.toHaveProperty("letter");
    const filled = previewPayload(draft, { name: " 李四 ", class_name: "", strengths: "  " }, { time: "周五 19:00", place: "", notes: undefined });
    expect(filled.sample).toEqual({ name: " 李四 " });
    expect(filled.letter).toEqual({ time: "周五 19:00" });
  });
});

/** 手动走的时钟：不依赖真实时间，advance 到点才触发。 */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  const timers: Timers = {
    set: (run, ms) => { const id = ++seq; pending.set(id, { at: now + ms, run }); return id; },
    clear: handle => { pending.delete(handle as number); },
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...pending]) if (timer.at <= now) { pending.delete(id); timer.run(); }
    },
    waiting: () => pending.size,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const rendered = (subject: string): MailRendered => ({ subject, html: `<p>${subject}</p>`, text: subject });
const payloadOf = (subject: string): PreviewPayload => previewPayload(draftFromTemplate(template({ subject })));

describe("live preview", () => {
  function setup() {
    const clock = fakeTimers();
    const calls: { payload: PreviewPayload; reply: ReturnType<typeof deferred<MailRendered>> }[] = [];
    const states: PreviewState[] = [];
    const previewer = createPreviewer({
      run: payload => { const reply = deferred<MailRendered>(); calls.push({ payload, reply }); return reply.promise; },
      onState: state => states.push(state),
      timers: clock.timers,
    });
    return { clock, calls, states, previewer, last: () => states[states.length - 1] };
  }

  it("waits until typing stops for 400 ms, then asks once with the latest content", () => {
    const { clock, calls, previewer } = setup();
    previewer.request(payloadOf("a"));
    clock.advance(399);
    expect(calls).toHaveLength(0);
    previewer.request(payloadOf("ab"));
    clock.advance(399);
    expect(calls).toHaveLength(0);
    previewer.request(payloadOf("abc"));
    clock.advance(400);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.draft.subject).toBe("abc");
    expect(clock.waiting()).toBe(0);
  });

  it("does not ask again for content identical to the last request", () => {
    const { clock, calls, previewer } = setup();
    previewer.request(payloadOf("same"));
    clock.advance(400);
    previewer.request(payloadOf("same"));
    clock.advance(400);
    expect(calls).toHaveLength(1);
    previewer.request(payloadOf("different"));
    clock.advance(400);
    expect(calls).toHaveLength(2);
  });

  it("shows the result of the latest request, and drops an older response that arrives after it", async () => {
    const { clock, calls, previewer, last } = setup();
    previewer.request(payloadOf("old"));
    clock.advance(400);
    previewer.request(payloadOf("new"));
    clock.advance(400);
    expect(calls).toHaveLength(2);
    calls[1].reply.resolve(rendered("new"));
    await flush();
    expect(last()).toMatchObject({ phase: "ready", rendered: { subject: "new" } });
    calls[0].reply.resolve(rendered("old"));
    await flush();
    expect(last()).toMatchObject({ phase: "ready", rendered: { subject: "new" } });
  });

  it("does not let a slow old response replace the 'loading' of the newer request either", async () => {
    const { clock, calls, previewer, last } = setup();
    previewer.request(payloadOf("old"));
    clock.advance(400);
    previewer.request(payloadOf("new"));
    clock.advance(400);
    calls[0].reply.resolve(rendered("old"));
    await flush();
    expect(last().phase).toBe("loading");
    expect(last().rendered).toBeNull();
    calls[1].reply.resolve(rendered("new"));
    await flush();
    expect(last()).toMatchObject({ phase: "ready", rendered: { subject: "new" } });
  });

  it("keeps the last good render when the next version cannot be rendered, with the server's words and problems", async () => {
    const { clock, calls, previewer, last } = setup();
    previewer.request(payloadOf("good"));
    clock.advance(400);
    calls[0].reply.resolve(rendered("good"));
    await flush();
    previewer.request(payloadOf("bad"));
    clock.advance(400);
    expect(last()).toMatchObject({ phase: "loading", rendered: { subject: "good" } });
    const issues = [{ path: "subject", message: "主题里的「部门」不是可用的变量" }];
    calls[1].reply.reject(new ApiError(400, "template_invalid", "主题里的「部门」不是可用的变量", undefined, { issues }));
    await flush();
    expect(last()).toEqual({ phase: "error", rendered: rendered("good"), message: "主题里的「部门」不是可用的变量", issues });
    previewer.request(payloadOf("fixed"));
    clock.advance(400);
    calls[2].reply.resolve(rendered("fixed"));
    await flush();
    expect(last()).toEqual({ phase: "ready", rendered: rendered("fixed"), message: "", issues: [] });
  });

  it("asks right away on flush, even for content it has already asked about", async () => {
    const { clock, calls, previewer } = setup();
    const payload = payloadOf("x");
    previewer.request(payload);
    clock.advance(400);
    previewer.flush(payload);
    expect(calls).toHaveLength(2);
    previewer.request(payloadOf("y"));
    previewer.flush();
    expect(calls).toHaveLength(3);
    expect(calls[2].payload.draft.subject).toBe("y");
    expect(clock.waiting()).toBe(0);
  });

  it("forgets everything on reset: no pending ask, no late answer, and the same content can be asked again", async () => {
    const { clock, calls, previewer, last } = setup();
    previewer.request(payloadOf("a"));
    clock.advance(400);
    previewer.request(payloadOf("b"));
    previewer.reset();
    expect(clock.waiting()).toBe(0);
    expect(last()).toEqual(IDLE_PREVIEW);
    calls[0].reply.resolve(rendered("a"));
    await flush();
    expect(last()).toEqual(IDLE_PREVIEW);
    previewer.request(payloadOf("a"));
    clock.advance(400);
    expect(calls).toHaveLength(2);
  });
});

describe("test send", () => {
  it("checks the address before asking and says what is wrong", () => {
    expect(testAddressError("")).toMatch(/请填/);
    expect(testAddressError("   ")).toMatch(/请填/);
    expect(testAddressError("no-at-sign")).toMatch(/普通的邮箱地址/);
    expect(testAddressError("a b@example.com")).toMatch(/普通的邮箱地址/);
    expect(testAddressError("a@@example.com")).toMatch(/普通的邮箱地址/);
    expect(testAddressError("a@example")).toMatch(/普通的邮箱地址/);
    expect(testAddressError(`${"a".repeat(320)}@example.com`)).toMatch(/普通的邮箱地址/);
    expect(testAddressError(" name+tag@example.com ")).toBeNull();
  });

  it("tells the truth about each outcome: sent, queued, skipped and why, or failed with the provider's reason", () => {
    expect(testSendOutcome({ status: "sent", skip_reason: null, error: null, subject: "【测试】x", to: "te***@example.com" }))
      .toEqual({ text: "已发出，请到 te***@example.com 查收。", tone: "success" });
    expect(testSendOutcome({ status: "pending", skip_reason: null, error: null, subject: "x", to: "te***@example.com" }).text).toContain("发信队列");
    expect(testSendOutcome({ status: "skipped", skip_reason: "mail_disabled", error: null, subject: "x", to: "a***@b.c" })).toEqual({ text: "发信还没有配置，这封没有发出。", tone: "warning" });
    expect(testSendOutcome({ status: "skipped", skip_reason: "not_allowlisted", error: null, subject: "x", to: "a***@b.c" }).text).toContain("不在其中");
    expect(testSendOutcome({ status: "skipped", skip_reason: "weird", error: null, subject: "x", to: "a***@b.c" }).text).toContain("weird");
    expect(testSendOutcome({ status: "failed", skip_reason: null, error: "resend 422", subject: "x", to: "a***@b.c" })).toEqual({ text: "没有发出：resend 422", tone: "danger" });
    expect(testSendOutcome({ status: "failed", skip_reason: null, error: null, subject: "x", to: "a***@b.c" }).text).toContain("原因不明");
  });

  it("explains a refused request in its own words, and leaves login and permission errors to the error banner", () => {
    const limited = new ApiError(429, "rate_limited", "这个账号一小时内最多试发 10 封，过一会儿再试", undefined, { retry_after: 1800 });
    expect(testSendFailure(limited)).toBe("这个账号一小时内最多试发 10 封，过一会儿再试（约 30 分钟后恢复）");
    expect(testSendFailure(new ApiError(429, "rate_limited", "全站一小时内最多试发 30 封，过一会儿再试"))).toBe("全站一小时内最多试发 30 封，过一会儿再试");
    expect(testSendFailure(new ApiError(400, "invalid_address", "测试邮箱要是一个普通的邮箱地址，例如 name@example.com"))).toContain("name@example.com");
    expect(testSendFailure(new ApiError(400, "template_invalid", "主题不能为空"))).toBe("这套模板现在还发不出去：主题不能为空");
    expect(testSendFailure(new ApiError(400, "preview_failed", "信里的链接只能指向官网"))).toContain("信里的链接");
    expect(testSendFailure(new ApiError(403, "step_up_required", "x"))).toBeNull();
    expect(testSendFailure(new ApiError(403, "forbidden", "x"))).toBeNull();
    expect(testSendFailure(new Error("network"))).toBeNull();
  });
});

describe("template list", () => {
  it("groups by the server's order of kinds and keeps the server's order inside a kind", () => {
    const groups = groupByKind(MOCK_MAIL_LIST.templates, MOCK_MAIL_LIST.kinds);
    expect(groups.map(group => group.label)).toEqual(["已收到", "待面试", "已录取", "未通过"]);
    expect(groups[1].templates.map(item => item.id)).toEqual(["default-interview", "interview-short"]);
    expect(groups[3].templates.map(item => item.id)).toEqual(["default-rejected", "sample-rejected-short"]);
    expect(groupByKind([], MOCK_MAIL_LIST.kinds).every(group => group.templates.length === 0)).toBe(true);
  });
  it("marks a default and a disabled template", () => {
    expect(templateFlags({ is_default: true, enabled: true })).toEqual(["默认"]);
    expect(templateFlags({ is_default: false, enabled: false })).toEqual(["已停用"]);
    expect(templateFlags({ is_default: false, enabled: true })).toEqual([]);
  });
});

describe("status and template", () => {
  it("lists, for each status, the enabled templates to choose from and the default now in use", () => {
    const groups = groupByKind(MOCK_MAIL_TEMPLATES, MOCK_MAIL_LIST.kinds);
    const routes = statusRoutes(groups);
    expect(routes.map(route => route.label)).toEqual(MOCK_MAIL_LIST.kinds.map(kind => kind.label));
    for (const route of routes) {
      expect(route.current?.is_default).toBe(true);
      expect(route.choices.every(choice => choice.enabled && choice.kind === route.kind)).toBe(true);
      expect(route.choices).toContain(route.current);
      expect(route.total).toBe(groups.find(group => group.kind === route.kind)?.templates.length);
    }
    const off = MOCK_MAIL_TEMPLATES.find(item => !item.enabled);
    expect(off).toBeDefined();
    expect(routes.find(route => route.kind === off?.kind)?.choices.map(choice => choice.id)).not.toContain(off?.id);
  });

  it("has no current template for a status with none, and still shows the status", () => {
    const routes = statusRoutes(groupByKind([], MOCK_MAIL_LIST.kinds));
    expect(routes).toHaveLength(MOCK_MAIL_LIST.kinds.length);
    expect(routes.every(route => route.current === null && route.choices.length === 0 && route.total === 0)).toBe(true);
  });
});

describe("development preview data (mock)", () => {
  it("serves the template list only to whoever holds mail.template.manage", () => {
    as("owner");
    const list = get<MailTemplateList>("/api/console/mail-templates");
    expect(list.templates).toHaveLength(6);
    expect(list.variables.map(item => item.name)).toContain("面试时间");
    expect(list.test_send).toEqual({ per_hour_per_account: 10, per_hour_site: 30 });
    as("ai_head");
    expect(() => get("/api/console/mail-templates")).toThrow(expect.objectContaining({ status: 403, payload: expect.objectContaining({ node: "mail.template.manage" }) }));
  });

  it("keeps exactly one default per kind, every default enabled, and the sample has a disabled template and a second interview style", () => {
    for (const kind of ["received", "interview", "accepted", "rejected"] as const) {
      const defaults = MOCK_MAIL_TEMPLATES.filter(item => item.kind === kind && item.is_default);
      expect(defaults, kind).toHaveLength(1);
      expect(defaults[0].enabled).toBe(true);
    }
    expect(MOCK_MAIL_TEMPLATES.filter(item => item.kind === "interview")).toHaveLength(2);
    expect(MOCK_MAIL_TEMPLATES.some(item => !item.enabled)).toBe(true);
    expect(MOCK_MAIL_TEMPLATES.every(item => !item.is_default || item.enabled)).toBe(true);
  });

  it("offers the application page only the enabled templates, by name", () => {
    expect(mockLetterTemplates()).toEqual({
      interview: [{ id: "default-interview", name: "默认", is_default: true }, { id: "interview-short", name: "面试邀请 · 简短", is_default: false }],
      accepted: [{ id: "default-accepted", name: "默认", is_default: true }],
      rejected: [{ id: "default-rejected", name: "默认", is_default: true }],
    });
    as("owner");
    const detail = get<{ letter_templates: unknown }>("/api/console/applications/2f9d6b1a-8e3c-4d7f-a1b2-c3d4e5f6a7b8");
    expect(detail.letter_templates).toEqual(mockLetterTemplates());
  });

  it("previews an unsaved draft with the sample person, and a different template reads differently", async () => {
    as("owner");
    const long = await post("/api/console/mail-templates/preview", { template_id: "default-interview" }) as MailRendered;
    const short = await post("/api/console/mail-templates/preview", { template_id: "interview-short" }) as MailRendered;
    expect(long.subject).toBe("极客班面试安排：9 月 30 日（周三）19:00");
    expect(short.subject).toBe("极客班面试：9 月 30 日（周三）19:00");
    expect(long.html).toContain("张同学，你好：");
    expect(long.html).not.toBe(short.html);

    const edited = await post("/api/console/mail-templates/preview", {
      draft: { ...content({ subject: "你好 {{姓名}}" }), kind: "interview" }, sample: { name: "李四" },
    }) as MailRendered;
    expect(edited.subject).toBe("你好 李四");
  });

  it("escapes what it puts into the preview, so a sample value cannot inject markup", async () => {
    as("owner");
    const draft = { ...content({ blocks: [{ kind: "paragraph", text: "报名人：{{姓名}}" }, { kind: "facts", items: [{ label: "地点", value: "{{面试地点}}" }] }] }), kind: "interview" };
    const out = await post("/api/console/mail-templates/preview", {
      draft, sample: { name: "<script>alert(1)</script>" }, letter: { place: "<img src=x onerror=alert(1)>" },
    }) as MailRendered;
    expect(out.html).not.toContain("<script>");
    expect(out.html).not.toContain("<img src=x");
    expect(out.html).toContain("报名人：&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("answers an unusable draft with the same 400 template_invalid and issues the server gives", async () => {
    as("owner");
    const bad = { ...content({ subject: "{{部门}}", greeting: "{{面试时间}}" }), kind: "received" };
    await expect(post("/api/console/mail-templates/preview", { draft: bad })).rejects.toMatchObject({
      status: 400, code: "template_invalid",
      payload: { issues: expect.arrayContaining([expect.objectContaining({ path: "subject" }), expect.objectContaining({ path: "greeting" })]) },
    });
    await expect(post("/api/console/mail-templates/preview", { draft: { ...content({ subject: "  " }), kind: "interview" } })).rejects.toMatchObject({
      payload: { issues: [expect.objectContaining({ path: "subject", message: "主题不能为空" })] },
    });
    await expect(post("/api/console/mail-templates/preview", {})).rejects.toMatchObject({ status: 400, code: "template_required" });
    await expect(post("/api/console/mail-templates/preview", { template_id: "nope" })).rejects.toMatchObject({ status: 404 });
  });

  it("previews the letter of a real application with the page's own fields, and fills in placeholders for what is not typed yet", async () => {
    as("owner");
    const id = "2f9d6b1a-8e3c-4d7f-a1b2-c3d4e5f6a7b8";
    const empty = await post(`/api/console/applications/${id}/letter-preview`, { status: "interview", letter: {} }) as MailRendered;
    expect(empty.subject).toContain("【面试时间待填】");
    expect(empty.html).toContain("周同学，你好：");
    const typed = await post(`/api/console/applications/${id}/letter-preview`, { status: "interview", template_id: "interview-short", letter: { time: "周五 19:00", place: "三教 301" } }) as MailRendered;
    expect(typed.subject).toBe("极客班面试：周五 19:00");
    expect(typed.html).toContain("三教 301");
    await expect(post(`/api/console/applications/${id}/letter-preview`, { status: "received", letter: {} })).rejects.toMatchObject({ status: 400, code: "no_letter" });
    await expect(post(`/api/console/applications/${id}/letter-preview`, { status: "interview", template_id: "default-accepted", letter: {} })).rejects.toMatchObject({ status: 400, code: "template_invalid" });
    await expect(post(`/api/console/applications/${id}/letter-preview`, { status: "rejected", template_id: "sample-rejected-short", letter: {} })).rejects.toMatchObject({ status: 400, code: "template_invalid" });
    as("ai_staff");
    await expect(post(`/api/console/applications/${id}/letter-preview`, { status: "interview", letter: {} })).rejects.toMatchObject({ status: 403 });
  });

  it("is read-only for writes: no permission is 403, a stale login is 403 step_up_required, otherwise 501 mock_read_only", async () => {
    as("ai_head");
    await expect(post("/api/console/mail-templates", { name: "x" })).rejects.toMatchObject({ status: 403, payload: expect.objectContaining({ node: "mail.template.manage" }) });
    as("owner_stale");
    await expect(post("/api/console/mail-templates/test-send", { to: "a@example.test" })).rejects.toMatchObject({ status: 403, code: "step_up_required" });
    as("owner");
    await expect(post("/api/console/mail-templates", { name: "x" })).rejects.toMatchObject({ status: 501, code: "mock_read_only" });
    await expect(mockApi("/api/console/mail-templates/default-interview", { method: "DELETE" })).rejects.toMatchObject({ status: 501, code: "mock_read_only" });
    await expect(post("/api/console/mail-templates/test-send", { to: "a@example.test" })).rejects.toMatchObject({ status: 501, code: "mock_read_only" });
  });

  it("rejects a status change that picks a template of another kind, as the server does", async () => {
    as("owner");
    const id = "2f9d6b1a-8e3c-4d7f-a1b2-c3d4e5f6a7b8";
    const patch = (template_id: string) => mockApi(`/api/console/applications/${id}`, {
      method: "PATCH", body: JSON.stringify({ status: "interview", expected_status: "received", expected_review_id: 0, notify: true, template_id, letter: { time: "周五", place: "三教" } }),
    });
    await expect(patch("default-accepted")).rejects.toMatchObject({ status: 400, code: "template_invalid" });
    await expect(patch("interview-short")).rejects.toMatchObject({ status: 501, code: "mock_read_only" });
  });
});
