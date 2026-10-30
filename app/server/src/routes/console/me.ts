import type { FastifyInstance } from "fastify";
import { DEFAULT_CONSOLE_ORG } from "../../config.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { emailRequired, profileRequired } from "../../lib/email-gate.js";
import { entriesForAccount, levelSuffix } from "../../lib/permissions.js";
import { departmentScopedAccess } from "../../lib/console-scope.js";
import { beijingDayStart } from "../../lib/beijing-time.js";

const LEVEL_NAME: Record<string, string> = { visitor: "访客", registered: "注册用户", member: "极客班成员", alumni: "往届成员" };
/** 没有全站 allow、只有部门范围 allow 的节点也要算「有」：#274 的 permissions 字段给前端判断导航显隐用，
 * 部长看不到全站数据，但应该看到「用户」「操作记录」这些导航项（范围由各接口自己再收窄）。
 * 不含 `dept.manage`（#274 残留修复 J）：这个节点种子里发给了部门部长，但目前没有任何接口按它判定——
 * 部门成员的任免、资料改动都走 users.manage/perm.manage，不是这个节点；放在这里只会让前端露出一个没有
 * 对应功能的导航项，所以从这张「扫一遍要不要显示导航」的清单里去掉。节点本身留着（给控制台权限页展示、
 * 给以后真的要做部门自助管理时用），只是不再参与这张导航清单。 */
const SCOPE_AWARE_NODES = ["users.view", "apply.view", "apply.review", "activity.read"];

/**
 * 控制台身份与概览（CONTRACT-274 §5、§7）：按新权限节点体系重写，取代旧的站内角色/能力形状。
 * 旧控制台前端（site_role、capabilities、head_of、github 字段）随这次改动一起下线，由新控制台
 * （权限节点驱动的 permissions 数组）接手，两边不再共存——旧形状没有调用方了（人工审查确认：
 * 旧的 people/departments/titles/assignments/catalogue/audit 路由已删，是唯一读过旧形状的地方）。
 */
export default async function consoleMeRoutes(app: FastifyInstance) {
  const { permissions, profiles, storage } = app.services;
  const db = storage.db;
  app.addHook("preHandler", requireAuth);

  app.get("/api/console/me", async (req) => {
    const accountId = req.session!.account_id;
    const profile = profiles.get(accountId);
    const row = db.prepare(`
      SELECT lvl.id AS level_id, dept.id AS department_id, dept.name AS department_name, dept.tone AS department_tone
      FROM users u
      LEFT JOIN (SELECT pm.account_id, pg.id FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pg.kind = 'level') lvl ON lvl.account_id = u.id
      LEFT JOIN (SELECT pm.account_id, pg.id, pg.name, pg.tone FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pg.kind = 'department') dept ON dept.account_id = u.id
      WHERE u.id = ?
    `).get(accountId) as { level_id: string | null; department_id: string | null; department_name: string | null; department_tone: string | null } | undefined;
    // #274 残留修复 P：不用 SUBSTR(pg.id, 7) 这种假设「level.」正好 6 个字符的魔术数字，改成拿完整 id
    // 再用 lib/permissions.ts 的 levelSuffix() 剥前缀——前缀名字一变，这里不用跟着改魔术数字。
    const level = row?.level_id ? levelSuffix(row.level_id) : "registered";
    const titles = (db.prepare(
      "SELECT pg.id AS id, pg.name AS name, pg.department_id AS department_id FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pg.kind = 'title' AND pm.account_id = ?",
    ).all(accountId) as { id: string; name: string; department_id: string | null }[]);

    const effective = permissions.effective(accountId);
    const entries = entriesForAccount(db, accountId, Date.now());
    const extra = SCOPE_AWARE_NODES.filter(node => !effective.allow.includes(node) && departmentScopedAccess(entries, node).kind === "scoped");

    return {
      account_id: accountId, login: req.session!.login, username: profile.username, display_name: profile.display_name,
      avatar_url: app.services.avatars.urlOf(accountId), level, level_name: LEVEL_NAME[level] ?? level,
      department: row?.department_id ? { id: row.department_id, name: row.department_name, tone: row.department_tone } : null,
      titles, permissions: [...effective.allow, ...extra],
      provider: req.session!.provider, email_required: emailRequired(app.services, accountId), profile_required: profileRequired(app.services, accountId),
    };
  });

  /** 概览（CONTRACT-274 §7）：去掉所有 GitHub 字段，只回调用者有权看的键；candidates_pending 是还没定榜的比赛里待确认的 GitLab 贡献数（#278）。 */
  app.get("/api/console/summary", async (req) => {
    const accountId = req.session!.account_id;
    const check = (node: string) => permissions.check(accountId, node);
    const result: Record<string, unknown> = {};

    if (check("apply.view")) {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const rows = db.prepare("SELECT status, COUNT(*) AS n FROM applications GROUP BY status").all() as { status: string; n: number }[];
      const byStatus: Record<string, number> = {};
      for (const row of rows) byStatus[row.status] = row.n;
      const lastWeek = db.prepare("SELECT COUNT(*) AS n FROM applications WHERE created_at >= ?").get(Date.now() - 7 * DAY_MS) as { n: number };
      result.applications = { total: rows.reduce((sum, row) => sum + row.n, 0), by_status: byStatus, last_7d: lastWeek.n };
    }
    if (check("competition.score.review")) result.candidates_pending = app.services.competitionCandidates.pendingCount();
    const todayStart = beijingDayStart(Date.now());
    if (check("users.view")) {
      const registrations = db.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?").get(todayStart) as { n: number };
      result.registrations_today = registrations.n;
    }
    if (check("activity.read")) {
      // 按合并后的 meta.count 求和，不是数行——lib/activity.ts 的 recordDenial 把同一 (subject, action,
      // 方法/路由模板/状态码, 分钟) 的拦截合并成一行累加计数（#274 残留修复 F、#333），这里要和那边的统计口径一致。
      const blocked = db.prepare("SELECT SUM(COALESCE(json_extract(meta, '$.count'), 1)) AS n FROM activity_events WHERE outcome = 'limited' AND at >= ?").get(todayStart) as { n: number | null };
      result.blocked_today = blocked.n ?? 0;
    }
    if (check("gitlab.view")) {
      const { healthy } = await app.services.gitlab.health();
      result.gitlab = { mode: app.services.gitlab.mode, healthy, last_run: app.services.gitlab.lastRun() };
    }
    if (check("feedback.view")) result.feedback = app.services.feedback.countFeedback(DEFAULT_CONSOLE_ORG);
    return result;
  });
}
