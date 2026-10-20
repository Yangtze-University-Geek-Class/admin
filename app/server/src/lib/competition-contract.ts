import { choices, integer, object, text } from "./http-contracts.js";

// Date 的有效上限须留出北京时间的八小时偏移，避免公开列表出现 NaN 日期。
const timestamp = integer(0, 8_640_000_000_000_000 - 8 * 3600_000);
export const competitionFields = {
  name: text(80, 2),
  kind: choices("internal", "external"),
  start_at: timestamp,
  end_at: timestamp,
  signup_deadline: { anyOf: [timestamp, { type: "null" }] },
  url: { anyOf: [{ ...text(500, 1), pattern: "^https://\\S+$" }, { type: "null" }] },
  description: text(1000),
};

const publicFields = {
  id: text(128, 1), ...competitionFields,
  status: choices("upcoming", "registering", "closed", "ongoing", "ended"),
};
const publicRecord = object(publicFields, Object.keys(publicFields));
const consoleFields = { ...publicFields, offline: { type: "boolean" } };
const consoleRecord = object(consoleFields, Object.keys(consoleFields));

export const publicCompetitionList = object({ competitions: { type: "array", items: publicRecord } }, ["competitions"]);
export const consoleCompetitionList = object({ competitions: { type: "array", items: consoleRecord } }, ["competitions"]);
export const consoleCompetitionResult = object({ competition: consoleRecord }, ["competition"]);
export const competitionDeleted = object({ ok: { type: "boolean", const: true } }, ["ok"]);

// 保留共同错误处理器的扩展字段（如 capability），不因成功响应补契约而改变拒绝路径。
const failure = object({
  error: { type: "string" }, message: { type: "string" },
  request_id: { type: "string" }, capability: { type: "string" },
}, ["error"], true);
export const competitionFailures = { "4xx": failure, "5xx": failure };
