import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requirePermission } from "../../middleware/require-permission.js";
import { requireScopedPermission } from "../../lib/console-scope.js";
import { beijingDayStart } from "../../lib/beijing-time.js";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";
import { csvCell, escapeLike } from "../../lib/sql-text.js";

/** IPv4 映射的 IPv6（`::ffff:a.b.c.d`）按 IPv4 处理，和 lib/forum-rules.ts 的 ipSubject 同一条规则——
 * 否则这种地址会先命中下面的「包含冒号」分支，打码成乱码（`::ffff:1.2.3.4::*`），露出比打码后的 IPv4
 * 更多的信息，也不符合「IPv4 只留前两段」的既定规则。 */
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
/** 没有 activity.read.ip 时打码：IPv4 只留前两段，IPv6 只留前 4 组（CONTRACT-274 §4）。 */
function maskIp(ip: string | null): string | null {
  if (!ip) return ip;
  const mapped = IPV4_MAPPED.exec(ip)?.[1];
  const ipv4 = mapped ?? (ip.includes(":") ? null : ip);
  if (ipv4) {
    const parts = ipv4.split(".");
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : ip;
  }
  return `${ip.split(":").slice(0, 4).join(":")}::*`;
}

type Row = {
  id: number; at: number; account_id: string | null; visitor_id: string | null; surface: string; action: string;
  target_type: string | null; target_id: string | null; outcome: string; ip: string | null; ua: string | null; request_id: string | null; meta: string;
  username: string | null; display_name: string | null;
};

type Cursor = { at: number; id: number };
const isCursor = (value: unknown): value is Cursor =>
  typeof (value as Cursor)?.at === "number" && typeof (value as Cursor)?.id === "number";

const PAGE_SIZE = 50;

/** 操作记录（CONTRACT-274 §4）：读 activity_events，取代旧的「审计日志」。写入口 recordActivity() 在 Phase D 做，
 * 这里只读；迁移时已经把 audit_logs 的历史数据一次性复制进了 activity_events（见 migrations/2026-10-yugc-v2.ts）。 */
export default async function consoleActivityRoutes(app: FastifyInstance) {
  const { storage, avatars } = app.services;
  const db = storage.db;
  app.addHook("preHandler", requireAuth);

  /** `useCursor: false`：不加游标条件——按页读取（`offset`）与数总条数时用。 */
  function buildQuery(req: { query: Record<string, string | undefined> }, departmentScope: string[] | null | undefined, accountId?: string, useCursor = true) {
    const { account, visitor, action, surface, outcome, from, to, cursor: cursorParam } = req.query;
    const cursor = useCursor ? decodeCursor(cursorParam, isCursor) : null;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (accountId) { conditions.push("e.account_id = ?"); params.push(accountId); }
    else if (account) { conditions.push("e.account_id = ?"); params.push(account); }
    if (visitor) { conditions.push("e.visitor_id = ?"); params.push(visitor); }
    if (action) { conditions.push("e.action LIKE ? ESCAPE '\\'"); params.push(`${escapeLike(action)}%`); }
    if (surface) { conditions.push("e.surface = ?"); params.push(surface); }
    if (outcome) { conditions.push("e.outcome = ?"); params.push(outcome); }
    if (from) { conditions.push("e.at >= ?"); params.push(Number(from)); }
    if (to) { conditions.push("e.at <= ?"); params.push(Number(to)); }
    if (departmentScope) {
      const placeholders = departmentScope.map(() => "?").join(",");
      if (departmentScope.includes("dept.none")) conditions.push(`(e.account_id IN (SELECT pm.account_id FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pg.kind = 'department' AND pg.id IN (${placeholders})) OR e.account_id IN (SELECT u.id FROM users u WHERE u.id NOT IN (SELECT account_id FROM perm_members pm2 JOIN perm_groups pg2 ON pg2.id = pm2.group_id WHERE pg2.kind = 'department')))`);
      else conditions.push(`e.account_id IN (SELECT pm.account_id FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pg.kind = 'department' AND pg.id IN (${placeholders}))`);
      params.push(...departmentScope);
    }
    if (cursor) { conditions.push("(e.at < ? OR (e.at = ? AND e.id < ?))"); params.push(cursor.at, cursor.at, cursor.id); }
    return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
  }

  function fetchRows(where: string, params: unknown[], limit: number, offset = 0): Row[] {
    return db.prepare(`
      SELECT e.id, e.at, e.account_id, e.visitor_id, e.surface, e.action, e.target_type, e.target_id, e.outcome, e.ip, e.ua, e.request_id, e.meta,
        p.username AS username, p.display_name AS display_name
      FROM activity_events e
      LEFT JOIN account_profiles p ON p.account_id = e.account_id
      ${where}
      ORDER BY e.at DESC, e.id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Row[];
  }

  /** `avatarUrls`：这一页账号的统一头像（lib/avatars.ts，#343），按页批量取。 */
  function itemView(row: Row, fullIp: boolean, avatarUrls: Map<string, string>) {
    return {
      id: row.id, at: row.at,
      account: row.account_id ? { id: row.account_id, username: row.username, display_name: row.display_name, avatar_url: avatarUrls.get(row.account_id)! } : null,
      visitor_id: row.visitor_id, surface: row.surface, action: row.action, target_type: row.target_type, target_id: row.target_id,
      outcome: row.outcome, ip: fullIp ? row.ip : maskIp(row.ip), ua: row.ua, request_id: row.request_id, meta: JSON.parse(row.meta || "{}"),
    };
  }

  app.get("/api/console/activity", { preHandler: requireScopedPermission("activity.read") }, async (req) => {
    const fullIp = app.services.permissions.check(req.session!.account_id, "activity.read.ip");
    // 控制台按页翻（`offset`，#370）：带了 offset 就不看游标；`total` 是筛选条件下的总条数，不受游标与页码影响。
    const offsetParam = (req.query as { offset?: string }).offset;
    const { where, params } = buildQuery(req as never, req.departmentScope, undefined, !offsetParam);
    const rows = fetchRows(where, params, PAGE_SIZE + 1, offsetParam ? Number(offsetParam) : 0);
    const page = rows.slice(0, PAGE_SIZE);
    const counted = buildQuery(req as never, req.departmentScope, undefined, false);
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM activity_events e ${counted.where}`).get(...counted.params) as { n: number }).n;
    const nextCursor = rows.length > PAGE_SIZE ? encodeCursor({ at: page[page.length - 1]!.at, id: page[page.length - 1]!.id }) : null;
    const todayStart = beijingDayStart(Date.now());
    // 被拦下的请求按 (subject, action, 方法/路由模板/状态码, 分钟) 合并成一行、累加 meta.count（lib/activity.ts 的 recordDenial，
    // #274 残留修复 F、#333），这里要按合并后的次数求和，不能直接数行——数行只会数出「合并成了多少行」，不是真实拦截次数。
    const blockedRows = db.prepare(
      "SELECT json_extract(meta, '$.bucket') AS bucket, SUM(COALESCE(json_extract(meta, '$.count'), 1)) AS n FROM activity_events WHERE outcome = 'limited' AND at >= ? AND json_extract(meta, '$.bucket') IS NOT NULL GROUP BY bucket",
    ).all(todayStart) as { bucket: string; n: number }[];
    const avatarUrls = avatars.urlsOf(page.flatMap(row => row.account_id ? [row.account_id] : []));
    return { items: page.map(row => itemView(row, fullIp, avatarUrls)), next_cursor: nextCursor, total, blocked_today: blockedRows.map(row => ({ bucket: row.bucket, count: row.n })) };
  });

  app.get("/api/console/activity.csv", { preHandler: requirePermission("activity.export") }, async (req, reply) => {
    const fullIp = app.services.permissions.check(req.session!.account_id, "activity.read.ip");
    const { where, params } = buildQuery(req as never, null);
    const rows = fetchRows(where, params, 5000);
    const header = ["id", "at", "account_id", "username", "visitor_id", "surface", "action", "target_type", "target_id", "outcome", "ip", "request_id"];
    const lines = rows.map(row => [
      row.id, row.at, row.account_id ?? "", row.username ?? "", row.visitor_id ?? "", row.surface, row.action,
      row.target_type ?? "", row.target_id ?? "", row.outcome, fullIp ? row.ip ?? "" : maskIp(row.ip) ?? "", row.request_id ?? "",
    ].map(csvCell).join(","));
    app.services.activity.recordActivity(req, { action: "activity.export", surface: "console", outcome: "ok", meta: { rows: rows.length } });
    reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", "attachment; filename=\"activity.csv\"");
    return `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`;
  });

  app.get<{ Params: { id: string } }>("/api/console/accounts/:id/activity", { preHandler: requireScopedPermission("activity.read") }, async (req, reply) => {
    if (req.departmentScope && !db.prepare(
      "SELECT 1 FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pg.kind = 'department' AND pm.account_id = ? AND pg.id IN (" + req.departmentScope.map(() => "?").join(",") + ")",
    ).get(req.params.id, ...req.departmentScope)) {
      return reply.code(403).send({ error: "forbidden", node: "activity.read", message: "这个账号不在你的范围内" });
    }
    const fullIp = app.services.permissions.check(req.session!.account_id, "activity.read.ip");
    const { where, params } = buildQuery(req as never, null, req.params.id);
    const rows = fetchRows(where, params, PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const nextCursor = rows.length > PAGE_SIZE ? encodeCursor({ at: page[page.length - 1]!.at, id: page[page.length - 1]!.id }) : null;
    const avatarUrls = avatars.urlsOf(page.flatMap(row => row.account_id ? [row.account_id] : []));
    return { items: page.map(row => itemView(row, fullIp, avatarUrls)), next_cursor: nextCursor };
  });
}
