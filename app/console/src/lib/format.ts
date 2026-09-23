// 时间与数字格式。控制台只显示北京时间习惯的 24 小时制。

type Instant = string | number | null | undefined;

const toDate = (value: Instant) => (value === null || value === undefined || value === "" ? null : new Date(value));

export function fmtDate(value: Instant): string {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtDay(value: Instant): string {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function fmtRelative(value: Instant, now = Date.now()): string {
  const date = toDate(value);
  if (!date || Number.isNaN(date.getTime())) return "-";
  const diff = now - date.getTime();
  const suffix = diff >= 0 ? "前" : "后";
  const seconds = Math.round(Math.abs(diff) / 1000);
  if (seconds < 60) return diff >= 0 ? "刚刚" : "马上";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟${suffix}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时${suffix}`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天${suffix}`;
  return fmtDay(date.getTime());
}
