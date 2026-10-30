import type { FastifyInstance } from "fastify";
import { requirePermission } from "../../middleware/require-permission.js";
import { requireStepUp } from "../../middleware/require-step-up.js";
import { requireScopedPermission } from "../../lib/console-scope.js";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";
import { isSiteOwner, levelGroupId, levelSuffix, setExclusiveGroupMembership, siteOwnerCount, SITE_OWNER_GROUP_ID } from "../../lib/permissions.js";
import { escapeLike } from "../../lib/sql-text.js";
import { beijingDayStart } from "../../lib/beijing-time.js";
import { normalizeRealName } from "../../lib/account-profiles.js";
import { GRADE_LABELS, enrollmentYearFor, gradeOf, type SelectableGrade } from "../../lib/grade.js";

const PAGE_SIZE = 50;

type Cursor = { created_at: number; id: string };
const isCursor = (value: unknown): value is Cursor =>
  typeof (value as Cursor)?.created_at === "number" && typeof (value as Cursor)?.id === "string";

type GitlabRow = { gitlab_user_id: number; state: string; last_error: string | null };
function gitlabView(row: GitlabRow | undefined) {
  if (!row) return { state: "none" as const, gitlab_user_id: null };
  if (row.last_error) return { state: "failed" as const, gitlab_user_id: row.gitlab_user_id };
  return { state: (row.state === "active" ? "synced" : row.state) as "synced" | "pending" | "blocked", gitlab_user_id: row.gitlab_user_id };
}

type UserRow = {
  account_id: string; status: "active" | "disabled"; created_at: number; username: string | null; display_name: string | null;
  real_name: string | null; enrollment_year: number | null;
  github_login: string | null; providers: string | null; last_login_at: number | null; level_id: string | null;
  department_id: string | null; department_name: string | null; department_tone: string | null;
  gitlab_user_id: number | null; gitlab_state: string | null; gitlab_last_error: string | null;
};
type TitleView = { id: string; name: string; department_id: string | null };

/** 列表每一行与 PATCH 响应共用同一份 SELECT（#274 残留修复 D：PATCH 要回和列表一样形状的完整行，
 * 不能各写一份、字段慢慢长歪）；`lvl.id`/`dept.id` 给完整 id，不在 SQL 里用 SUBSTR 切前缀（残留修复 P）。 */
const USER_ROW_SQL = `
  SELECT u.id AS account_id, u.status AS status, u.created_at AS created_at,
    p.username AS username, p.display_name AS display_name,
    p.real_name AS real_name, p.enrollment_year AS enrollment_year,
    g.login AS github_login,
    (SELECT group_concat(i.provider) FROM identities i WHERE i.user_id = u.id) AS providers,
    (SELECT MAX(i.last_login_at) FROM identities i WHERE i.user_id = u.id) AS last_login_at,
    lvl.id AS level_id, dept.id AS department_id, dept.name AS department_name, dept.tone AS department_tone,
    ga.gitlab_user_id AS gitlab_user_id, ga.state AS gitlab_state, ga.last_error AS gitlab_last_error
  FROM users u
  LEFT JOIN account_profiles p ON p.account_id = u.id
  LEFT JOIN identities g ON g.user_id = u.id AND g.provider = 'github'
  LEFT JOIN (SELECT pm.account_id, pg.id FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pg.kind = 'level') lvl ON lvl.account_id = u.id
  LEFT JOIN (SELECT pm.account_id, pg.id, pg.name, pg.tone FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pg.kind = 'department') dept ON dept.account_id = u.id
  LEFT JOIN gitlab_accounts ga ON ga.account_id = u.id
`;

/**
 * `withRealName`：调用者有 `users.manage` 时才带真实姓名（#280），没有时不回这个键；年级只有用户管理的查看权限也能看。
 * `avatarUrl`：统一头像（lib/avatars.ts，#343），调用方按一页账号批量取。
 */
function userItemView(row: UserRow, titles: TitleView[], withRealName: boolean, avatarUrl: string) {
  const grade = gradeOf(row.enrollment_year);
  return {
    account_id: row.account_id, username: row.username, display_name: row.display_name,
    ...(withRealName ? { real_name: row.real_name || null } : {}),
    grade, grade_label: grade === null ? null : GRADE_LABELS[grade],
    avatar_url: avatarUrl,
    status: row.status, level: row.level_id ? levelSuffix(row.level_id) : "registered",
    department: row.department_id ? { id: row.department_id, name: row.department_name, tone: row.department_tone } : null,
    titles,
    providers: (row.providers ? row.providers.split(",") : []) as ("email" | "google" | "github")[],
    gitlab: gitlabView(row.gitlab_user_id !== null ? { gitlab_user_id: row.gitlab_user_id, state: row.gitlab_state!, last_error: row.gitlab_last_error } : undefined),
    last_login_at: row.last_login_at, created_at: row.created_at,
  };
}

/**
 * 用户列表与改身份（CONTRACT-274 §5）：按新权限体系的 level/department/title 分组渲染，替代旧的
 * `/api/console/people`（旧接口暂时保留给旧控制台前端用，不在这次改动删除，见执行记录里的范围说明）。
 */
export default async function consoleUsersRoutes(app: FastifyInstance) {
  const { permissions, storage, avatars } = app.services;
  const db = storage.db;

  function titlesByIds(accountIds: string[]): Map<string, TitleView[]> {
    const titlesByAccount = new Map<string, TitleView[]>();
    if (!accountIds.length) return titlesByAccount;
    const placeholders = accountIds.map(() => "?").join(",");
    for (const row of db.prepare(`
      SELECT pm.account_id AS account_id, pg.id AS id, pg.name AS name, pg.department_id AS department_id
      FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id
      WHERE pg.kind = 'title' AND pm.account_id IN (${placeholders})
    `).all(...accountIds) as { account_id: string; id: string; name: string; department_id: string | null }[]) {
      const list = titlesByAccount.get(row.account_id);
      const title = { id: row.id, name: row.name, department_id: row.department_id };
      if (list) list.push(title); else titlesByAccount.set(row.account_id, [title]);
    }
    return titlesByAccount;
  }

  /** 按等级分组的计数：有部门范围时只数这个范围内的账号（#274 残留修复 J——以前不论调用者的范围，
   * 这张计数永远是全站的，部长能从这几个数字反推出全站规模）。`visitor_today` 不受部门范围影响：
   * 访客没有账号、也就没有部门。 */
  function levelCountsFor(effectiveDepartments: string[] | null): { level_id: string; n: number }[] {
    if (!effectiveDepartments) {
      return db.prepare(`
        SELECT pg.id AS level_id, COUNT(*) AS n FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id
        WHERE pg.kind = 'level' GROUP BY pg.id
      `).all() as { level_id: string; n: number }[];
    }
    const placeholders = effectiveDepartments.map(() => "?").join(",");
    const deptCond = effectiveDepartments.includes("dept.none") ? `(dept.id IN (${placeholders}) OR dept.id IS NULL)` : `dept.id IN (${placeholders})`;
    return db.prepare(`
      SELECT pg.id AS level_id, COUNT(*) AS n
      FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id
      LEFT JOIN (SELECT pm2.account_id, pg2.id FROM perm_members pm2 JOIN perm_groups pg2 ON pg2.id = pm2.group_id WHERE pg2.kind = 'department') dept ON dept.account_id = pm.account_id
      WHERE pg.kind = 'level' AND ${deptCond}
      GROUP BY pg.id
    `).all(...effectiveDepartments) as { level_id: string; n: number }[];
  }

  app.get("/api/console/users", { preHandler: requireScopedPermission("users.view") }, async (req) => {
    const { q, level, department, status, cursor: cursorParam } = req.query as { q?: string; level?: string; department?: string; status?: string; cursor?: string };
    const cursor = decodeCursor(cursorParam, isCursor);
    const withRealName = permissions.check(req.session!.account_id, "users.manage");
    const conditions: string[] = ["u.status <> 'merged'"];
    const params: unknown[] = [];
    if (q) {
      const like = `%${escapeLike(q)}%`;
      // 能看真实姓名的管理员也能按真实姓名搜
      const byRealName = withRealName ? " OR p.real_name LIKE ? ESCAPE '\\'" : "";
      conditions.push(`(p.username LIKE ? ESCAPE '\\' OR p.display_name LIKE ? ESCAPE '\\' OR g.login LIKE ? ESCAPE '\\'${byRealName})`);
      params.push(like, like, like, ...(withRealName ? [like] : []));
    }
    if (status) { conditions.push("u.status = ?"); params.push(status); }
    if (level) { conditions.push("lvl.id = ?"); params.push(levelGroupId(level)); }
    // 部门过滤：dept.none 和「没有任何部门成员资格」算同一回事——dept.none 本身只是迁移给旧「队长」兜底用的占位组。
    const effectiveDepartments = req.departmentScope ?? (department ? [department] : null);
    if (effectiveDepartments) {
      const placeholders = effectiveDepartments.map(() => "?").join(",");
      if (effectiveDepartments.includes("dept.none")) conditions.push(`(dept.id IN (${placeholders}) OR dept.id IS NULL)`);
      else conditions.push(`dept.id IN (${placeholders})`);
      params.push(...effectiveDepartments);
    }
    if (cursor) { conditions.push("(u.created_at > ? OR (u.created_at = ? AND u.id > ?))"); params.push(cursor.created_at, cursor.created_at, cursor.id); }

    const rows = db.prepare(`${USER_ROW_SQL} WHERE ${conditions.join(" AND ")} ORDER BY u.created_at ASC, u.id ASC LIMIT ?`)
      .all(...params, PAGE_SIZE + 1) as UserRow[];

    const page = rows.slice(0, PAGE_SIZE);
    const titlesByAccount = titlesByIds(page.map(row => row.account_id));
    const avatarUrls = avatars.urlsOf(page.map(row => row.account_id));
    const items = page.map(row => userItemView(row, titlesByAccount.get(row.account_id) ?? [], withRealName, avatarUrls.get(row.account_id)!));
    const nextCursor = rows.length > PAGE_SIZE ? encodeCursor({ created_at: page[page.length - 1]!.created_at, id: page[page.length - 1]!.account_id }) : null;

    const counts = { visitor_today: 0, registered: 0, member: 0, alumni: 0 };
    for (const row of levelCountsFor(effectiveDepartments)) {
      const suffix = levelSuffix(row.level_id);
      if (suffix in counts) (counts as Record<string, number>)[suffix] = row.n;
    }
    // 今天（北京时间零点起）去重访客数：按 activity_events 里不同的 visitor_id 数，不是部门范围能限定的维度。
    counts.visitor_today = (db.prepare("SELECT COUNT(DISTINCT visitor_id) AS n FROM activity_events WHERE visitor_id IS NOT NULL AND at >= ?")
      .get(beijingDayStart(Date.now())) as { n: number }).n;

    return { items, next_cursor: nextCursor, counts };
  });

  // `real_name`、`grade`（#280）：本人填过之后只能由这里改；传 null 清空，本人下次登录要重新填
  app.patch<{ Params: { id: string }; Body: { status?: "active" | "disabled"; level?: "registered" | "member" | "alumni"; department?: string | null; titles?: string[]; real_name?: string | null; grade?: SelectableGrade | null } }>(
    "/api/console/users/:id",
    { preHandler: [requirePermission("users.manage"), requireStepUp] },
    async (req, reply) => {
      const { id } = req.params;
      const { status, level, department, titles, grade } = req.body;
      const realName = typeof req.body.real_name === "string" ? normalizeRealName(req.body.real_name) : req.body.real_name;
      if (realName === null && typeof req.body.real_name === "string") {
        return reply.code(400).send({ error: "bad_real_name", message: "姓名填 2 到 32 个字，只能是文字、空格和「·」" });
      }
      if (status !== undefined && !req.server.services.permissions.check(req.session!.account_id, "users.disable")) {
        return reply.code(403).send({ error: "forbidden", node: "users.disable", message: "需要「users.disable」权限" });
      }
      const account = db.prepare("SELECT id, status FROM users WHERE id = ? AND status <> 'merged'").get(id) as { id: string; status: string } | undefined;
      if (!account) return reply.code(404).send({ error: "not_found", message: "没有这个账号" });

      const now = app.services.clock();
      const currentlyOwner = isSiteOwner(db, id, now);
      const restoringOwner = status === "active" && account.status !== "active" && !!db.prepare(
        "SELECT 1 FROM perm_members WHERE account_id = ? AND group_id = ? AND (expires_at IS NULL OR expires_at > ?)",
      ).get(id, SITE_OWNER_GROUP_ID, now);
      const ownerCount = siteOwnerCount(db, now);
      const losingOwnership = currentlyOwner && (status === "disabled" || (titles !== undefined && !titles.includes(SITE_OWNER_GROUP_ID)));
      if ((losingOwnership || restoringOwner) && !isSiteOwner(db, req.session!.account_id, now)) {
        return reply.code(403).send({ error: "forbidden", node: SITE_OWNER_GROUP_ID, message: "只有站长才能任免站长" });
      }
      if (losingOwnership && ownerCount <= 1) {
        return reply.code(409).send({ error: "last_owner", message: "至少要留一位站长" });
      }
      // #274 残留修复 B：只有站长自己才能任免站长——不然持有 users.manage 的人（比如管理部部长）能把自己
      // 或别人升成站长，或者把别的站长降掉，拿到全站最高权限不需要任何一位现任站长点头。
      if (titles !== undefined) {
        // titles 全量重写为永久资格；「保留」一个临时 owner 也会延长其权限，必须由现任站长批准。
        const addingOwner = titles.includes(SITE_OWNER_GROUP_ID);
        const removingOwner = !titles.includes(SITE_OWNER_GROUP_ID) && currentlyOwner;
        if ((addingOwner || removingOwner) && !isSiteOwner(db, req.session!.account_id, now)) {
          return reply.code(403).send({ error: "forbidden", node: SITE_OWNER_GROUP_ID, message: "只有站长才能任免站长" });
        }
      }

      if (department !== undefined && department !== null && !db.prepare("SELECT 1 FROM perm_groups WHERE id = ? AND kind = 'department'").get(department)) {
        return reply.code(400).send({ error: "invalid_department", message: "部门不存在" });
      }
      if (titles !== undefined) {
        for (const titleId of titles) {
          if (!db.prepare("SELECT 1 FROM perm_groups WHERE id = ? AND kind = 'title'").get(titleId)) {
            return reply.code(400).send({ error: "invalid_title", message: `称号不存在：${titleId}` });
          }
        }
      }

      // SPEC §3.7「写入前后的 JSON 都放进 meta」：这个接口改的是 level/department/titles，和权限组 CRUD 一样
      // 影响权限，改动前先拍一份快照，事务跑完再拍一份，两份都放进操作记录。真实姓名（#280）不进操作记录，
      // 只记有没有填、改没改；年级记入学年份。
      const realNameBefore = app.services.profiles.realInfo(id).real_name;
      const snapshot = () => {
        const real = app.services.profiles.realInfo(id);
        return {
          status: (db.prepare("SELECT status FROM users WHERE id = ?").get(id) as { status: string } | undefined)?.status ?? null,
          level: (db.prepare("SELECT pg.id AS id FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pm.account_id = ? AND pg.kind = 'level'").get(id) as { id: string } | undefined)?.id ?? null,
          department: (db.prepare("SELECT pg.id AS id FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pm.account_id = ? AND pg.kind = 'department'").get(id) as { id: string } | undefined)?.id ?? null,
          titles: (db.prepare("SELECT pg.id AS id FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pm.account_id = ? AND pg.kind = 'title' ORDER BY pg.id").all(id) as { id: string }[]).map(row => row.id),
          has_real_name: real.real_name !== null, enrollment_year: real.enrollment_year,
        };
      };
      const before = snapshot();
      db.transaction(() => {
        if (status !== undefined) db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
        if (realName !== undefined || grade !== undefined) {
          const real = app.services.profiles.realInfo(id);
          app.services.profiles.setRealInfo(id, realName !== undefined ? realName : real.real_name, grade !== undefined ? (grade === null ? null : enrollmentYearFor(grade, now)) : real.enrollment_year);
        }
        if (level !== undefined) setExclusiveGroupMembership(db, id, levelGroupId(level), now, req.session!.login);
        const finalDepartment = department !== undefined ? department : (db.prepare(
          "SELECT pg.id AS id FROM perm_members pm JOIN perm_groups pg ON pg.id = pm.group_id WHERE pm.account_id = ? AND pg.kind = 'department'",
        ).get(id) as { id: string } | undefined)?.id ?? null;
        if (department !== undefined) {
          if (department === null) db.prepare("DELETE FROM perm_members WHERE account_id = ? AND group_id IN (SELECT id FROM perm_groups WHERE kind = 'department')").run(id);
          else setExclusiveGroupMembership(db, id, department, now, req.session!.login);
        }
        if (titles !== undefined) {
          db.prepare("DELETE FROM perm_members WHERE account_id = ? AND group_id IN (SELECT id FROM perm_groups WHERE kind = 'title')").run(id);
          const insertTitle = db.prepare("INSERT INTO perm_members(account_id, group_id, expires_at, granted_by, created_at) VALUES (?, ?, NULL, ?, ?)");
          for (const titleId of titles) insertTitle.run(id, titleId, req.session!.login, now);
        } else if (department !== undefined) {
          // 部门变了，没有同时给新的称号列表：不属于新部门的称号自动去掉（CONTRACT-274 §5）；站长等无部门称号不受影响。
          const dropStmt = finalDepartment
            ? db.prepare("DELETE FROM perm_members WHERE account_id = ? AND group_id IN (SELECT id FROM perm_groups WHERE kind = 'title' AND department_id IS NOT NULL AND department_id <> ?)")
            : db.prepare("DELETE FROM perm_members WHERE account_id = ? AND group_id IN (SELECT id FROM perm_groups WHERE kind = 'title' AND department_id IS NOT NULL)");
          if (finalDepartment) dropStmt.run(id, finalDepartment); else dropStmt.run(id);
        }
      })();
      permissions.bump();
      const realNameChanged = app.services.profiles.realInfo(id).real_name !== realNameBefore;
      app.services.activity.recordActivity(req, { action: "users.update", surface: "console", target_type: "user", target_id: id, outcome: "ok", meta: { before, after: snapshot(), real_name_changed: realNameChanged } });
      // #274 残留修复 D：回和列表一样形状的完整行（不是只有 account_id），控制台改完不用再拉一次列表才能刷新这一行。
      const row = db.prepare(`${USER_ROW_SQL} WHERE u.id = ?`).get(id) as UserRow;
      return userItemView(row, titlesByIds([id]).get(id) ?? [], true, avatars.urlOf(id));
    },
  );
}
