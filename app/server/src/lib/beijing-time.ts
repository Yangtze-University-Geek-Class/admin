// 北京时间（UTC+8，中国不用夏令时）。服务器容器跑在 UTC，给人看的时间一律按这里算，不依赖运行环境的时区与 ICU。
// 用在信里的日期（lib/mail/envelope.ts）和控制台导出的 CSV（routes/console/applications.ts）。

const OFFSET_MS = 8 * 3600_000;
const pad = (value: number) => String(value).padStart(2, "0");

/** 北京时间的年月日时分秒；时间不合法时抛 RangeError。 */
export function beijingParts(at: Date | number) {
  const ms = typeof at === "number" ? at : at.getTime();
  if (!Number.isFinite(ms)) throw new RangeError("invalid time");
  const d = new Date(ms + OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), ss: d.getUTCSeconds() };
}

/** 2026-09-27 01:05:00，表格软件能直接当时间读 */
export function beijingDateTime(at: Date | number): string {
  const p = beijingParts(at);
  return `${p.y}-${pad(p.m)}-${pad(p.day)} ${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}`;
}

/** 20260927，给文件名用 */
export function beijingCompactDate(at: Date | number): string {
  const p = beijingParts(at);
  return `${p.y}${pad(p.m)}${pad(p.day)}`;
}
