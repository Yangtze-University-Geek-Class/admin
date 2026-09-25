import type Database from "better-sqlite3";
import {
  CAPABILITY_IDS, CAPTAIN_ONLY, DEFAULT_DEPARTMENTS, DEFAULT_TITLE_CONFIGS, TITLE_IDS, isCapability, normalizeBundle,
  type AssignableRole, type AssignmentRow, type Capability, type Department, type DepartmentIcon, type TitleConfigs, type TitleId, type Tone,
} from "./roles.js";

type DepartmentRecord = {
  id: string; name: string; tag: string; icon: string; tone: string; description: string;
  head_capabilities: string; member_capabilities: string; sort_order: number; archived: number;
  created_at: number; updated_at: number;
};
export type DepartmentInput = {
  id: string; name: string; tag: string; icon: DepartmentIcon; tone: Tone; description?: string;
  head_capabilities: Capability[]; member_capabilities?: Capability[]; sort_order?: number;
};
export type DepartmentPatch = Partial<Omit<DepartmentInput, "id">> & { archived?: boolean };
export type TitlePatch = Partial<{ label: string; tag: string; icon: string; tone: Tone; description: string; capabilities: Capability[] }>;
type TitleRecord = { id: TitleId; label: string; tag: string; icon: string; tone: string; description: string; capabilities: string; updated_by: string | null; updated_at: number };
export type AssignmentInput = {
  github_login: string; github_user_id: number | null; role: AssignableRole; department_id: string;
  note: string | null; granted_by: string;
};
export type AssignmentFilter = { role?: AssignableRole; department_id?: string; departments?: string[] };

const ASSIGNMENT_COLUMNS = "id, github_login, github_user_id, role, department_id, note, granted_by, created_at";

function parseBundle(raw: string): Capability[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? normalizeBundle(value.filter(isCapability)) : [];
  } catch { return []; }
}
/** 称号的权限包可以含仅舰长能力（roles.manage 只能在舰长包里，由路由检查），所以不走 normalizeBundle。 */
function parseTitleBundle(raw: string): Capability[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? CAPABILITY_IDS.filter(id => value.includes(id)) : [];
  } catch { return []; }
}
function toDepartment(row: DepartmentRecord): Department & { created_at: number; updated_at: number } {
  return {
    id: row.id, name: row.name, tag: row.tag, icon: row.icon as DepartmentIcon, tone: row.tone as Tone, description: row.description,
    head_capabilities: parseBundle(row.head_capabilities), member_capabilities: parseBundle(row.member_capabilities),
    sort_order: row.sort_order, archived: row.archived === 1, created_at: row.created_at, updated_at: row.updated_at,
  };
}

/** 称号设置、部门与称号指派的持久化。只接收普通参数；授权判断在调用方。 */
export function createRoleStore(db: Database.Database) {
  // 称号：代码里的默认值只在第一次启动写入，之后以数据库为准（提督在控制台改的不会被覆盖）。
  const seedTitle = db.prepare(`INSERT OR IGNORE INTO titles(id, label, tag, icon, tone, description, capabilities, updated_by, updated_at)
    VALUES(@id, @label, @tag, @icon, @tone, @description, @capabilities, NULL, @now)`);
  db.transaction(() => {
    for (const id of TITLE_IDS) {
      const title = DEFAULT_TITLE_CONFIGS[id];
      seedTitle.run({ ...title, capabilities: JSON.stringify(title.capabilities), now: Date.now() });
    }
  })();

  /** 全部称号设置。提督的权限包不管库里存了什么都是全部能力，乘客没有权限包。 */
  function titleConfigs(): TitleConfigs {
    const rows = db.prepare("SELECT * FROM titles").all() as TitleRecord[];
    const result = structuredClone(DEFAULT_TITLE_CONFIGS);
    for (const row of rows) {
      if (!(row.id in result)) continue;
      result[row.id] = {
        id: row.id, label: row.label, tag: row.tag, icon: row.icon, tone: row.tone as Tone, description: row.description,
        capabilities: row.id === "admin" ? [...CAPABILITY_IDS] : row.id === "guest" ? []
          // 仅舰长能力只认舰长那一行：路由已经挡住，这里读出时再兜一层，库被别处改过也不会放大权限
          : parseTitleBundle(row.capabilities).filter(capability => row.id === "captain" || !CAPTAIN_ONLY.includes(capability)),
      };
    }
    return result;
  }
  /** 返回实际改动的字段名；称号不存在时返回 null。权限包规则（titleBundleError）由调用方先查。 */
  function updateTitle(id: TitleId, patch: TitlePatch, actor: string): string[] | null {
    const current = titleConfigs()[id];
    if (!current) return null;
    const columns: string[] = [];
    const values: unknown[] = [];
    const changed: string[] = [];
    for (const key of ["label", "tag", "icon", "tone", "description"] as const) {
      // 名字和说明去掉首尾空白再存：控制台已经 trim，直接调接口也不会存进「 舰长 」
      const next = typeof patch[key] === "string" ? patch[key]!.trim() : patch[key];
      if (next === undefined || next === current[key]) continue;
      columns.push(`${key} = ?`); values.push(next); changed.push(key);
    }
    if (patch.capabilities !== undefined) {
      const next = CAPABILITY_IDS.filter(capability => patch.capabilities!.includes(capability));
      if (JSON.stringify(next) !== JSON.stringify(current.capabilities)) {
        columns.push("capabilities = ?"); values.push(JSON.stringify(next)); changed.push("capabilities");
      }
    }
    if (columns.length === 0) return [];
    db.prepare(`UPDATE titles SET ${columns.join(", ")}, updated_by = ?, updated_at = ? WHERE id = ?`).run(...values, actor, Date.now(), id);
    return changed;
  }

  const seed = db.prepare(`INSERT OR IGNORE INTO departments(id, name, tag, icon, tone, description, head_capabilities, member_capabilities, sort_order, archived, created_at, updated_at)
    VALUES(@id, @name, @tag, @icon, @tone, @description, @head_capabilities, @member_capabilities, @sort_order, 0, @now, @now)`);
  const now = Date.now();
  // 默认部门只在第一次启动写入：部门可以在控制台删除，重启时不能把删掉的默认部门补回来。
  // 这条标记之前就已经有部门的库（本功能上线前的数据）只补记标记，不再写默认部门。
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM console_seeds WHERE name = 'departments'").get()) return;
    const existing = (db.prepare("SELECT COUNT(*) AS n FROM departments").get() as { n: number }).n;
    if (existing === 0) {
      for (const department of DEFAULT_DEPARTMENTS) {
        seed.run({
          ...department, now,
          head_capabilities: JSON.stringify(department.head_capabilities),
          member_capabilities: JSON.stringify(department.member_capabilities),
        });
      }
    }
    db.prepare("INSERT INTO console_seeds(name, seeded_at) VALUES('departments', ?)").run(now);
  })();

  function listDepartments() {
    const rows = db.prepare("SELECT * FROM departments ORDER BY archived ASC, sort_order ASC, created_at ASC").all() as DepartmentRecord[];
    return rows.map(toDepartment);
  }
  function getDepartment(id: string) {
    const row = db.prepare("SELECT * FROM departments WHERE id = ?").get(id) as DepartmentRecord | undefined;
    return row ? toDepartment(row) : null;
  }
  /** 返回 false 表示 id 已存在。 */
  function insertDepartment(input: DepartmentInput): boolean {
    const at = Date.now();
    const result = db.prepare(`INSERT OR IGNORE INTO departments(id, name, tag, icon, tone, description, head_capabilities, member_capabilities, sort_order, archived, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
      input.id, input.name, input.tag, input.icon, input.tone, input.description ?? "",
      JSON.stringify(normalizeBundle(input.head_capabilities)), JSON.stringify(normalizeBundle(input.member_capabilities ?? [])),
      input.sort_order ?? 100, at, at,
    );
    return result.changes === 1;
  }
  /**
   * 删除部门，同一事务里撤掉这个部门的全部队长与舰员指派。返回被撤掉的指派；部门不存在时返回 null。
   */
  function deleteDepartment(id: string): AssignmentRow[] | null {
    return db.transaction(() => {
      if (!getDepartment(id)) return null;
      const removed = db.prepare(`SELECT ${ASSIGNMENT_COLUMNS} FROM role_assignments WHERE department_id = ? ORDER BY id`).all(id) as AssignmentRow[];
      db.prepare("DELETE FROM role_assignments WHERE department_id = ?").run(id);
      db.prepare("DELETE FROM departments WHERE id = ?").run(id);
      return removed;
    })();
  }
  /** 返回实际改动的字段名；部门不存在时返回 null。 */
  function updateDepartment(id: string, patch: DepartmentPatch): string[] | null {
    const current = getDepartment(id);
    if (!current) return null;
    const columns: string[] = [];
    const values: unknown[] = [];
    const changed: string[] = [];
    const set = (column: string, next: unknown, previous: unknown, stored: unknown = next) => {
      if (JSON.stringify(next) === JSON.stringify(previous)) return;
      columns.push(`${column} = ?`); values.push(stored); changed.push(column);
    };
    if (patch.name !== undefined) set("name", patch.name, current.name);
    if (patch.tag !== undefined) set("tag", patch.tag, current.tag);
    if (patch.icon !== undefined) set("icon", patch.icon, current.icon);
    if (patch.tone !== undefined) set("tone", patch.tone, current.tone);
    if (patch.description !== undefined) set("description", patch.description, current.description);
    if (patch.sort_order !== undefined) set("sort_order", patch.sort_order, current.sort_order);
    if (patch.archived !== undefined) set("archived", patch.archived, current.archived, patch.archived ? 1 : 0);
    if (patch.head_capabilities !== undefined) {
      const next = normalizeBundle(patch.head_capabilities);
      set("head_capabilities", next, current.head_capabilities, JSON.stringify(next));
    }
    if (patch.member_capabilities !== undefined) {
      const next = normalizeBundle(patch.member_capabilities);
      set("member_capabilities", next, current.member_capabilities, JSON.stringify(next));
    }
    if (columns.length === 0) return [];
    db.prepare(`UPDATE departments SET ${columns.join(", ")}, updated_at = ? WHERE id = ?`).run(...values, Date.now(), id);
    return changed;
  }

  /** 当前用户的指派：优先按 GitHub 数字 id 匹配（抗改名），尚未记录 id 的行按小写 login 匹配。 */
  function assignmentsFor(login: string, userId: number | null): AssignmentRow[] {
    return db.prepare(`SELECT ${ASSIGNMENT_COLUMNS} FROM role_assignments
      WHERE (github_user_id IS NOT NULL AND github_user_id = ?) OR (github_user_id IS NULL AND github_login = ?)
      ORDER BY created_at ASC, id ASC`).all(userId ?? -1, login.toLowerCase()) as AssignmentRow[];
  }
  function listAssignments(filter: AssignmentFilter = {}): AssignmentRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.role) { where.push("role = ?"); params.push(filter.role); }
    if (filter.department_id !== undefined) { where.push("department_id = ?"); params.push(filter.department_id); }
    if (filter.departments) {
      if (filter.departments.length === 0) return [];
      where.push(`department_id IN (${filter.departments.map(() => "?").join(", ")})`);
      params.push(...filter.departments);
    }
    const sql = `SELECT ${ASSIGNMENT_COLUMNS} FROM role_assignments${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
      ORDER BY CASE role WHEN 'captain' THEN 0 WHEN 'head' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, department_id, created_at`;
    return db.prepare(sql).all(...params) as AssignmentRow[];
  }
  function getAssignment(id: number): AssignmentRow | null {
    return (db.prepare(`SELECT ${ASSIGNMENT_COLUMNS} FROM role_assignments WHERE id = ?`).get(id) as AssignmentRow | undefined) ?? null;
  }
  function findAssignment(login: string, role: AssignableRole, departmentId: string): AssignmentRow | null {
    return (db.prepare(`SELECT ${ASSIGNMENT_COLUMNS} FROM role_assignments WHERE github_login = ? AND role = ? AND department_id = ?`)
      .get(login.toLowerCase(), role, departmentId) as AssignmentRow | undefined) ?? null;
  }
  /** 插入一条指派；唯一约束冲突返回 null。captain 行请走 transferCaptain。 */
  function insertAssignment(input: AssignmentInput): AssignmentRow | null {
    try {
      const result = db.prepare(`INSERT INTO role_assignments(github_login, github_user_id, role, department_id, note, granted_by, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?)`).run(input.github_login.toLowerCase(), input.github_user_id, input.role, input.department_id, input.note, input.granted_by, Date.now());
      return getAssignment(Number(result.lastInsertRowid));
    } catch (error) {
      if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return null;
      throw error;
    }
  }
  /** 在一个事务里删掉旧 captain 行并插入新行；返回旧行（没有则 null）与新行。 */
  function transferCaptain(input: Omit<AssignmentInput, "role" | "department_id">) {
    return db.transaction(() => {
      const previous = (db.prepare(`SELECT ${ASSIGNMENT_COLUMNS} FROM role_assignments WHERE role = 'captain'`).get() as AssignmentRow | undefined) ?? null;
      if (previous) db.prepare("DELETE FROM role_assignments WHERE id = ?").run(previous.id);
      const result = db.prepare(`INSERT INTO role_assignments(github_login, github_user_id, role, department_id, note, granted_by, created_at)
        VALUES(?, ?, 'captain', '', ?, ?, ?)`).run(input.github_login.toLowerCase(), input.github_user_id, input.note, input.granted_by, Date.now());
      return { previous, assignment: getAssignment(Number(result.lastInsertRowid))! };
    })();
  }
  function deleteAssignment(id: number): boolean {
    return db.prepare("DELETE FROM role_assignments WHERE id = ?").run(id).changes === 1;
  }
  function captain(): AssignmentRow | null {
    return (db.prepare(`SELECT ${ASSIGNMENT_COLUMNS} FROM role_assignments WHERE role = 'captain'`).get() as AssignmentRow | undefined) ?? null;
  }
  const captainExists = () => captain() !== null;
  function crewCounts(): Map<string, { heads: string[]; crew: number }> {
    const rows = db.prepare("SELECT department_id, role, github_login FROM role_assignments WHERE department_id <> '' ORDER BY created_at").all() as { department_id: string; role: string; github_login: string }[];
    const result = new Map<string, { heads: string[]; crew: number }>();
    for (const row of rows) {
      const entry = result.get(row.department_id) ?? { heads: [], crew: 0 };
      if (row.role === "head") entry.heads.push(row.github_login); else entry.crew += 1;
      result.set(row.department_id, entry);
    }
    return result;
  }
  const countAssignments = () => (db.prepare("SELECT COUNT(*) AS n FROM role_assignments").get() as { n: number }).n;

  return {
    titleConfigs, updateTitle,
    listDepartments, getDepartment, insertDepartment, updateDepartment, deleteDepartment,
    assignmentsFor, listAssignments, getAssignment, findAssignment, insertAssignment, transferCaptain, deleteAssignment,
    captain, captainExists, crewCounts, countAssignments,
  };
}
export type RoleStore = ReturnType<typeof createRoleStore>;
