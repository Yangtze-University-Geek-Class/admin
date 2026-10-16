// 比赛（#238）控制台页面的纯逻辑：状态文案、日期与时间戳的互相换算、表单校验。
// 不导入 Vue，tests/console/competitions.test.ts 直接测。状态由服务端按时间算好，这里只负责文案。
import type { CompetitionStatus } from "./types";

/**
 * 北京时间（UTC+8，中国不用夏令时）。服务器容器跑在 UTC，控制台一律按北京时间填与看（#148 起的口径），
 * 不跟浏览器所在的时区走，否则同一场比赛在两个人眼里差一天。
 */
const BEIJING_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 24 * 3600_000;
const pad = (value: number) => String(value).padStart(2, "0");

export const STATUS_TEXT: Record<CompetitionStatus, string> = {
  registering: "报名中", closed: "报名已截止", ongoing: "进行中", ended: "已结束",
};

export const KIND_TEXT = { internal: "内部", external: "外部" } as const;

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value.trim());

/** 时间戳 → 北京时间的 `YYYY-MM-DD`；空值给空串。 */
export function beijingDate(at: number | null | undefined): string {
  if (at === null || at === undefined || !Number.isFinite(at)) return "";
  const d = new Date(at + BEIJING_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * 北京时间的某一天 → 时间戳。`edge: "start"` 取当天 00:00:00.000，`edge: "end"` 取 23:59:59.999。
 * 日期不存在（例如 2 月 30 日）时按 null 返回，不交给 Date 悄悄进位到下个月。
 */
export function dateEdge(date: string, edge: "start" | "end"): number | null {
  const value = date.trim();
  if (!isDate(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const midnight = Date.UTC(y, m - 1, d) - BEIJING_OFFSET_MS;
  // 日期合法时，换算回北京时间应当还是同一天
  if (beijingDate(midnight) !== value) return null;
  return edge === "start" ? midnight : midnight + DAY_MS - 1;
}

/** 表单正在编辑的样子：日期是 `YYYY-MM-DD`，URL 与说明是普通文本。 */
export type CompetitionForm = {
  name: string; kind: "internal" | "external";
  startDate: string; endDate: string; deadlineDate: string; url: string; description: string;
};

export function emptyForm(): CompetitionForm {
  return { name: "", kind: "internal", startDate: "", endDate: "", deadlineDate: "", url: "", description: "" };
}

/** 从服务端返回的一条记录填出表单。截止时间取北京日期，不显示当天的最后一毫秒。 */
export function formFrom(record: {
  name: string; kind: "internal" | "external"; start_at: number; end_at: number;
  signup_deadline: number | null; url: string | null; description: string;
}): CompetitionForm {
  return {
    name: record.name, kind: record.kind,
    startDate: beijingDate(record.start_at), endDate: beijingDate(record.end_at),
    deadlineDate: beijingDate(record.signup_deadline),
    url: record.url ?? "", description: record.description,
  };
}

type Field = "name" | "startDate" | "endDate" | "deadlineDate" | "url";

/**
 * 表单校验。逐条报错，空对象表示可以提交。
 * 时间的关系（结束不早于开始、截止不晚于结束）在这里先判，服务端还有一道，不靠它兜底。
 */
export function formErrors(form: CompetitionForm): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  const name = form.name.trim();
  if (name.length < 2) errors.name = "请填比赛名称，至少 2 个字。";
  else if (name.length > 80) errors.name = "比赛名称最多 80 个字。";

  const start = dateEdge(form.startDate, "start");
  const end = dateEdge(form.endDate, "end");
  if (start === null) errors.startDate = "请选开始日期。";
  if (end === null) errors.endDate = "请选结束日期。";
  else if (start !== null && end < start) errors.endDate = "结束日期不能早于开始日期。";

  const deadline = form.deadlineDate.trim() ? dateEdge(form.deadlineDate, "end") : null;
  if (form.deadlineDate.trim() && deadline === null) errors.deadlineDate = "报名截止的日期不对。";
  else if (deadline !== null && end !== null && deadline > end) errors.deadlineDate = "报名截止不能晚于比赛结束。";
  // 内部比赛的表单不显示链接；用户先填了外部、又改成内部时，那个值必须不影响提交（字段是隐藏的，报错也改不了）
  const url = form.kind === "external" ? form.url.trim() : "";
  if (form.kind === "external" && !url) errors.url = "外部比赛要填官方链接。";
  else if (url && !/^https:\/\/\S+$/.test(url)) errors.url = "官方链接要以 https:// 开头。";
  return errors;
}

/**
 * 表单 → 提交给服务端的正文（UTC 时间戳）。
 * 开始取当天 00:00、结束取当天 23:59:59.999、截止取当天 23:59:59.999：
 * 「报名截止当天」整个白天都还能报，不会在当天零点就报不上名。
 * 内部比赛不带 url（服务端也会清掉，这里先不送）。
 */
export function formPayload(form: CompetitionForm) {
  return {
    name: form.name.trim(),
    kind: form.kind,
    start_at: dateEdge(form.startDate, "start") as number,
    end_at: dateEdge(form.endDate, "end") as number,
    signup_deadline: form.deadlineDate.trim() ? dateEdge(form.deadlineDate, "end") : null,
    url: form.kind === "external" ? form.url.trim() || null : null,
    description: form.description.trim(),
  };
}
