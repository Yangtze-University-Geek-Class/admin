import { formatMailDateTime, oneLine, safeMailLink, type EnvelopeBlock, type EnvelopeMessage } from "./envelope.js";

/**
 * 招新流程的四封信（#148）：投递成功、待面试、已录取、未通过。
 * 只拼内容（EnvelopeMessage），版式和转义由 renderEnvelope 负责；什么时候发、发给谁由发信模块决定。
 * 状态与控制台的投递状态一一对应（lib/roles.ts 的 APPLICATION_STATUSES：received / interview / accepted / rejected）。
 */

export type RecruitmentKind = "received" | "interview" | "accepted" | "rejected";

type Common = {
  /** 投递人填写的姓名 */
  name: string;
  /** applications.id */
  applicationId: string;
  /** 站点首页：https://yangtzeu.work 或 https://prev.yangtzeu.work */
  siteOrigin: string;
  /** 这封信的落款时间 */
  sentAt: Date | number;
};

export type ReceivedInput = Common & { className: string; submittedAt: Date | number };
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
export type RejectedInput = Common;

export type RecruitmentInput = {
  received: ReceivedInput;
  interview: InterviewInput;
  accepted: AcceptedInput;
  rejected: RejectedInput;
};

const FOOTER = "你在长江大学极客班官网报名时填写了这个邮箱，所以会收到这封信。";

const CJK_END = /[㐀-鿿豈-﫿]$/;

/** 「小明同学，你好：」；名字以字母结尾时中间空一格（「Alice 同学」）；没有名字时只写「你好：」。 */
export function greetingFor(name: string): string {
  const clean = oneLine(name);
  if (!clean) return "你好：";
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
  };
}

export function receivedMessage(input: ReceivedInput): EnvelopeMessage {
  const blocks: EnvelopeBlock[] = [
    { kind: "paragraph", text: "你寄给极客班的报名信，我们已经收到了。3 个工作日内会有人看完，并用这个邮箱联系你。" },
    {
      kind: "facts",
      items: [
        { label: "报名编号", value: input.applicationId, mono: true },
        { label: "提交时间", value: formatMailDateTime(input.submittedAt) },
        { label: "班级", value: input.className },
      ],
    },
    { kind: "paragraph", text: "之后联系我们时报上编号就行。官网上查不到进度，面试安排和结果都会发到这个邮箱，记得也看一眼垃圾邮件。" },
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
  const time = oneLine(input.time);
  const blocks: EnvelopeBlock[] = [
    { kind: "paragraph", text: "你的报名信我们看过了，想请你来当面聊一聊。" },
    {
      kind: "facts",
      items: [
        { label: "时间", value: time },
        { label: "地点", value: input.place },
        { label: "报名编号", value: input.applicationId, mono: true },
      ],
    },
  ];
  if (input.notes?.length) blocks.push({ kind: "list", title: "面试说明", items: input.notes });
  blocks.push({ kind: "paragraph", text: "这个时间来不了的话，直接回复这封邮件说一声，我们再约。" });
  return frame(input, {
    subject: time ? `极客班面试安排：${time}` : "极客班面试安排",
    preheader: `${time}${time ? "，" : ""}地点和面试说明在信里。`,
    kicker: "招新进度 · 待面试",
    blocks,
  });
}

export function acceptedMessage(input: AcceptedInput): EnvelopeMessage {
  const blocks: EnvelopeBlock[] = [
    { kind: "paragraph", text: "你通过了这一轮招新，欢迎加入长江大学极客班。" },
  ];
  if (input.steps?.length) blocks.push({ kind: "list", title: "接下来", items: input.steps });
  else blocks.push({ kind: "paragraph", text: "接下来的安排我们会另外发邮件告诉你。" });
  blocks.push({ kind: "paragraph", text: "有不清楚的地方，直接回复这封邮件问我们。" });
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
    { kind: "paragraph", text: "这一轮我们没能给你发出邀请。报名的人比这一轮的名额多，没办法请每个人都来。" },
    { kind: "paragraph", text: "论坛对所有人开放，想提问、发帖或者看看大家在做什么，随时都可以来。下一轮招新开始时，官网和论坛都会发通知，到时候欢迎你再写信来。" },
  ];
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
