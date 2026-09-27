import { formatMailDateTime, oneLine, required, safeMailLink, type EnvelopeBlock, type EnvelopeMessage } from "./envelope.js";

/**
 * 招新流程的四封信（#148）：投递成功、待面试、已录取、未通过。
 * 只拼内容（EnvelopeMessage），版式和转义由 renderEnvelope 负责；什么时候发、发给谁由发信模块决定。
 * 状态与控制台的投递状态一一对应（lib/roles.ts 的 APPLICATION_STATUSES：received / interview / accepted / rejected）。
 *
 * 每封信都附上「你的报名信息」（姓名、班级、邮箱、投递时间、报名编号），已收到的信另外原样引用特长与优点；
 * 抬头按姓称呼（「张同学，你好：」，greetingFor）。时间一律按北京时间写（formatMailDateTime）。
 *
 * 回信：给了 replyTo，信里才请对方「直接回复这封邮件」，没给就指向官网意见箱（待面试的信也一样）。
 * renderEnvelope 会拒绝请人回复却没有 replyTo 的信。
 */

export type RecruitmentKind = "received" | "interview" | "accepted" | "rejected";

type Common = {
  /** 投递人填写的姓名 */
  name: string;
  /** 投递人填写的班级 */
  className: string;
  /** 投递人填写的邮箱，也就是收件地址 */
  email: string;
  /** 投递时间（applications.created_at） */
  submittedAt: Date | number;
  /** applications.id */
  applicationId: string;
  /** 站点首页：https://yangtzeu.work 或 https://prev.yangtzeu.work */
  siteOrigin: string;
  /** 这封信的落款时间 */
  sentAt: Date | number;
  /** 回信地址：有人在看的邮箱，发信模块写进 Reply-To */
  replyTo?: string;
};

export type ReceivedInput = Common & {
  /** 投递人写的特长与优点，信里原样引用 */
  strengths: string;
};
export type InterviewInput = Common & {
  /** 面试时间，写成给人看的样子，例如「9 月 30 日（周三）19:00」 */
  time: string;
  place: string;
  /** 面试说明，一条一行 */
  notes?: readonly string[];
};
export type AcceptedInput = Common & {
  /** 接下来要做的事，一条一行 */
  steps?: readonly string[];
  /** 按钮，例如组织邀请链接；只能指向 yangtzeu.work / prev.yangtzeu.work */
  action?: { label: string; url: string };
};
export type RejectedInput = Common & {
  /** 这一轮没请对方加入的原因，由改状态的人写；不写信里就不提原因 */
  reason?: string;
};

export type RecruitmentInput = {
  received: ReceivedInput;
  interview: InterviewInput;
  accepted: AcceptedInput;
  rejected: RejectedInput;
};

const FOOTER = "你在长江大学极客班官网报名时填写了这个邮箱，所以会收到这封信。";

/** 没有回信地址时，有问题去哪里问 */
const ASK_ON_FEEDBACK = "可以到官网的意见箱留言，联系方式一栏填这个邮箱。";

/** 「你的报名信息」：每封信都带，收信人能核对是哪一份报名。投递时间按北京时间写，并写明是北京时间。 */
function applicationFacts(input: Common): EnvelopeBlock {
  return {
    kind: "facts",
    title: "你的报名信息",
    items: [
      { label: "姓名", value: input.name },
      { label: "班级", value: input.className },
      { label: "邮箱", value: input.email },
      { label: "投递时间", value: `${formatMailDateTime(input.submittedAt)}（北京时间）` },
      { label: "报名编号", value: input.applicationId, mono: true },
    ],
  };
}

const CJK_END = /[㐀-鿿豈-﫿]$/;
const HAN = /^\p{Script=Han}$/u;

/** 复姓：名字以其中一个开头、并且至少三个字时，按复姓称呼（欧阳娜娜 → 欧阳同学）。 */
export const COMPOUND_SURNAMES: readonly string[] = [
  "欧阳", "司马", "上官", "诸葛", "东方", "皇甫", "尉迟", "公孙", "慕容", "长孙", "宇文", "司徒", "夏侯",
  "轩辕", "令狐", "钟离", "闻人", "澹台", "公冶", "太叔", "申屠", "赫连", "端木", "呼延", "南宫", "西门",
  "独孤", "万俟", "百里", "东郭", "拓跋", "第五", "左丘", "濮阳", "淳于", "仲孙", "叱干",
];

/**
 * 抬头按姓称呼（所有者 2026-09-27）：汉字开头的名字取姓，张三 →「张同学，你好：」，欧阳娜娜 →「欧阳同学，你好：」；
 * 只有两个字的名字一律按单姓（欧阳 →「欧同学」），分不清是复姓还是姓加名。
 * 清单里不放「单于」：它是称号，几乎没有人姓单于，而姓单、名字以「于」开头的人不少（单于洋 →「单同学」）。
 * 不是汉字开头的名字（拉丁字母等）照写全名，以字母结尾时中间空一格（「Alice 同学，你好：」）；没有名字时只写「你好：」。
 * 事实栏里仍写全名。
 */
export function greetingFor(name: string): string {
  const clean = oneLine(name);
  if (!clean) return "你好：";
  const chars = Array.from(clean);
  if (HAN.test(chars[0])) {
    const two = chars.slice(0, 2).join("");
    const surname = chars.length >= 3 && COMPOUND_SURNAMES.includes(two) ? two : chars[0];
    return `${surname}同学，你好：`;
  }
  return `${clean}${CJK_END.test(clean) ? "" : " "}同学，你好：`;
}

function page(origin: string, path: string): string {
  return new URL(path, safeMailLink(origin)).href;
}

function frame(input: Common, parts: Pick<EnvelopeMessage, "subject" | "preheader" | "kicker" | "blocks" | "action">): EnvelopeMessage {
  return {
    ...parts,
    greeting: greetingFor(input.name),
    signedAt: input.sentAt,
    footer: [FOOTER, `报名编号 ${oneLine(input.applicationId)}`],
    siteUrl: page(input.siteOrigin, "/"),
    replyTo: input.replyTo,
  };
}

export function receivedMessage(input: ReceivedInput): EnvelopeMessage {
  const ask = input.replyTo ? "有问题直接回复这封邮件。" : `有问题${ASK_ON_FEEDBACK}`;
  const blocks: EnvelopeBlock[] = [
    { kind: "paragraph", text: "你寄给极客班的报名信，我们已经收到了。3 个工作日内会有人看完，并用这个邮箱联系你。" },
    applicationFacts(input),
    { kind: "quote", title: "你写的特长与优点", text: input.strengths },
    { kind: "paragraph", text: `官网上查不到进度，面试安排和结果都会发到这个邮箱，记得也看一眼垃圾邮件。${ask}` },
    { kind: "paragraph", text: "等消息的这几天，可以先去论坛逛逛，看看大家在做什么。" },
  ];
  return frame(input, {
    subject: "极客班收到了你的报名信",
    preheader: "3 个工作日内我们会用这个邮箱联系你，报名编号在信里。",
    kicker: "招新进度 · 已收到",
    blocks,
    action: { label: "去论坛看看", url: page(input.siteOrigin, "/forum/") },
  });
}

export function interviewMessage(input: InterviewInput): EnvelopeMessage {
  const time = required(oneLine(input.time), "面试时间");
  const place = required(oneLine(input.place), "面试地点");
  const notes = (input.notes ?? []).filter(note => note.trim());
  const blocks: EnvelopeBlock[] = [
    { kind: "paragraph", text: "你的报名信我们看过了，想请你来当面聊一聊。" },
    {
      kind: "facts",
      items: [
        { label: "时间", value: time },
        { label: "地点", value: place },
      ],
    },
  ];
  if (notes.length) blocks.push({ kind: "list", title: "面试说明", items: notes });
  blocks.push({
    kind: "paragraph",
    text: input.replyTo
      ? "这个时间来不了的话，直接回复这封邮件说一声，我们再约。"
      : "这个时间来不了的话，到官网的意见箱留言，联系方式一栏填这个邮箱，我们再约。",
  });
  blocks.push(applicationFacts(input));
  return frame(input, {
    subject: `极客班面试安排：${time}`,
    preheader: `${time}，${place}。${notes.length ? "面试说明在信里。" : ""}`,
    kicker: "招新进度 · 待面试",
    blocks,
  });
}

export function acceptedMessage(input: AcceptedInput): EnvelopeMessage {
  const blocks: EnvelopeBlock[] = [
    { kind: "paragraph", text: "你通过了这一轮招新，欢迎加入长江大学极客班。" },
  ];
  const steps = (input.steps ?? []).filter(step => step.trim());
  if (steps.length) blocks.push({ kind: "list", title: "接下来", items: steps });
  else blocks.push({ kind: "paragraph", text: "接下来的安排我们会另外发邮件告诉你。" });
  blocks.push({ kind: "paragraph", text: input.replyTo ? "有不清楚的地方，直接回复这封邮件问我们。" : `有不清楚的地方，${ASK_ON_FEEDBACK}` });
  blocks.push(applicationFacts(input));
  return frame(input, {
    subject: "你已通过极客班招新",
    preheader: "欢迎加入长江大学极客班，接下来的安排在信里。",
    kicker: "招新进度 · 已录取",
    blocks,
    action: input.action,
  });
}

export function rejectedMessage(input: RejectedInput): EnvelopeMessage {
  const blocks: EnvelopeBlock[] = [
    { kind: "paragraph", text: "谢谢你给极客班写信，把做过的事和想做的事讲给我们听。" },
    { kind: "paragraph", text: "这一轮没能请你加入极客班。" },
  ];
  if (input.reason?.trim()) blocks.push({ kind: "paragraph", text: input.reason });
  blocks.push({ kind: "paragraph", text: "论坛不登录也能看帖，也可以用昵称回复。下一轮招新开始时，欢迎你再写信来。" });
  blocks.push(applicationFacts(input));
  return frame(input, {
    subject: "极客班招新结果",
    preheader: "谢谢你给极客班写信，这一轮的结果在信里。",
    kicker: "招新进度 · 结果",
    blocks,
    action: { label: "去论坛看看", url: page(input.siteOrigin, "/forum/") },
  });
}

const BUILDERS: { [K in RecruitmentKind]: (input: RecruitmentInput[K]) => EnvelopeMessage } = {
  received: receivedMessage,
  interview: interviewMessage,
  accepted: acceptedMessage,
  rejected: rejectedMessage,
};

/** 按投递状态取信的内容。 */
export function recruitmentMessage<K extends RecruitmentKind>(kind: K, input: RecruitmentInput[K]): EnvelopeMessage {
  return BUILDERS[kind](input);
}
