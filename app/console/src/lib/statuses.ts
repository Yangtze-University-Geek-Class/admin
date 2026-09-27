// 投递与意见的状态名和色调。色调取自 catalogue 的 tones（与称号徽章同一套）。
import type { ApplicationStatus, FeedbackStatus, Tone } from "./types";

type StatusMeta = { label: string; tone: Tone };

/** 投递能选的四种状态，顺序就是下拉框和筛选的顺序。 */
export const APPLICATION_STATUS: Record<ApplicationStatus, StatusMeta> = {
  received: { label: "已收到", tone: "slate" },
  interview: { label: "待面试", tone: "amber" },
  accepted: { label: "已录取", tone: "jade" },
  rejected: { label: "未通过", tone: "rose" },
};
export const APPLICATION_STATUSES = Object.keys(APPLICATION_STATUS) as ApplicationStatus[];
export const isApplicationStatus = (value: unknown): value is ApplicationStatus =>
  typeof value === "string" && (APPLICATION_STATUSES as string[]).includes(value);

/** 已退役、不能再选的状态：旧的审核记录里还有，照原来的名字显示。 */
const LEGACY_APPLICATION_STATUS = new Map<string, StatusMeta>([
  ["reviewing", { label: "评估中", tone: "sky" }],
]);

/** 任意状态 id 的名字和色调；不认识的原样显示 id，不让页面出错。 */
export function statusMeta(id: string): StatusMeta {
  if (isApplicationStatus(id)) return APPLICATION_STATUS[id];
  return LEGACY_APPLICATION_STATUS.get(id) ?? { label: id, tone: "slate" };
}

export const FEEDBACK_STATUS: Record<FeedbackStatus, { label: string; tone: Tone }> = {
  open: { label: "待处理", tone: "amber" },
  triaged: { label: "已查看", tone: "sky" },
  in_progress: { label: "处理中", tone: "cobalt" },
  done: { label: "已完成", tone: "jade" },
  wont_do: { label: "不处理", tone: "slate" },
  spam: { label: "垃圾信息", tone: "rose" },
};
export const FEEDBACK_STATUSES = Object.keys(FEEDBACK_STATUS) as FeedbackStatus[];
