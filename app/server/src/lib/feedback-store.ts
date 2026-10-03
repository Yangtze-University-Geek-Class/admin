import type Database from "better-sqlite3";

export const FEEDBACK_STATUSES = ["open", "triaged", "in_progress", "done", "wont_do", "spam"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** 管理列表 DTO：只下发意见箱页面需要的列；提交者 IP、UA 与数字账号 id 留在服务端。 */
export type AdminFeedbackItem = {
  id: number; category: string | null; content: string; contact: string | null; submitter_login: string | null;
  status: string; reply: string | null; replied_by: string | null; replied_at: number | null; created_at: number;
};
const ADMIN_FEEDBACK_COLUMNS = "id, category, content, contact, submitter_login, status, reply, replied_by, replied_at, created_at";

/**
 * 本部署的意见箱只收 `CONSOLE_ORG` 的意见（#129）：组织名不分大小写认它，并统一成配置里的写法；
 * 不是本组织的一律返回 null，调用方据此拒绝或返回空列表。GitHub 组织名只用 ASCII，`toLowerCase()` 足够。
 */
export function normalizeFeedbackOrg(org: string, consoleOrg: string): string | null {
  return org.toLowerCase() === consoleOrg.toLowerCase() ? consoleOrg : null;
}

/** 意见箱的 SQL（管理端与控制台共用）。只接收普通参数，授权由调用方完成。 */
export function createFeedbackStore(db: Database.Database) {
  function listFeedback(org: string, options: { status?: string; limit?: number } = {}) {
    const limit = Math.min(options.limit ?? 200, 500);
    let sql = `SELECT ${ADMIN_FEEDBACK_COLUMNS} FROM feedback WHERE org = ?`;
    const params: unknown[] = [org];
    if (options.status) { sql += " AND status = ?"; params.push(options.status); }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    const items = db.prepare(sql).all(...params) as AdminFeedbackItem[];
    const counts = db.prepare("SELECT status, COUNT(*) as n FROM feedback WHERE org = ? GROUP BY status").all(org) as { status: string; n: number }[];
    return { items, counts: Object.fromEntries(counts.map(c => [c.status, c.n])) as Record<string, number> };
  }
  function countFeedback(org: string) {
    const row = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open FROM feedback WHERE org = ?").get(org) as { total: number; open: number | null };
    return { total: row.total, open: row.open ?? 0 };
  }
  /** 返回 false 表示该组织下没有这条意见。 */
  function updateFeedback(org: string, id: number, patch: { status?: string; reply?: string }, actor: string): boolean {
    const row = db.prepare("SELECT id FROM feedback WHERE id = ? AND org = ?").get(id, org);
    if (!row) return false;
    const updates: string[] = ["updated_at = ?"];
    const args: unknown[] = [Date.now()];
    if (patch.status) { updates.push("status = ?"); args.push(patch.status); }
    if (patch.reply !== undefined) {
      updates.push("reply = ?", "replied_by = ?", "replied_at = ?");
      args.push(patch.reply.trim() || null, actor, Date.now());
    }
    args.push(id);
    db.prepare(`UPDATE feedback SET ${updates.join(", ")} WHERE id = ?`).run(...args);
    return true;
  }
  function deleteFeedback(org: string, id: number): boolean {
    return db.prepare("DELETE FROM feedback WHERE id = ? AND org = ?").run(id, org).changes > 0;
  }
  /**
   * 一次性归一（#129）：把 org 只是大小写不同的历史行改成配置里的写法，重复启动安全（第二轮没有匹配行）。
   * 别的组织的旧数据不动：不猜它本来想发给谁。
   */
  function normalizeOrgSpelling(consoleOrg: string) {
    return db.transaction(() => {
      const rows = db.prepare("SELECT DISTINCT org FROM feedback").all() as { org: string }[];
      const update = db.prepare("UPDATE feedback SET org = ? WHERE org = ?");
      for (const row of rows) {
        const normalized = normalizeFeedbackOrg(row.org, consoleOrg);
        if (normalized && normalized !== row.org) update.run(normalized, row.org);
      }
    })();
  }
  return { listFeedback, countFeedback, updateFeedback, deleteFeedback, normalizeOrgSpelling };
}
export type FeedbackStore = ReturnType<typeof createFeedbackStore>;
