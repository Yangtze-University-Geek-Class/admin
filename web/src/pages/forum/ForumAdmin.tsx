import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, fmtRelative } from "../../lib/api";
import { Avatar } from "./ForumLayout";
import Select from "../../components/Select";
import { useConfirm } from "../../components/ConfirmDialog";

type Me = { signed_in: boolean; user?: { id: number; username: string; role: string } };
type ForumAdminUser = {
  id: number; username: string; display_name: string | null; avatar_url: string | null; email: string | null;
  role: string; github_login: string | null; legacy_mbbs_id: number | null;
  thread_count: number; post_count: number; last_seen_at: number | null; created_at: number;
};
type Group = { id: number; name: string; description: string | null; is_default: number; member_count: number; permission_count: number };
type Category = { id: number; slug: string; name: string; description: string | null; is_legacy: number; thread_count: number };

export default function ForumAdmin() {
  const me = useQuery({ queryKey: ["forum-me"], queryFn: () => api<Me>("/api/forum/me") });
  const [tab, setTab] = useState<"users" | "groups" | "categories">("users");

  if (me.isLoading) return <div className="max-w-5xl mx-auto px-6 py-12 text-ink-400">…</div>;
  const u = me.data?.user;
  if (!u) return <Navigate to="/login?return_to=/admin" replace />;
  if (u.role !== "admin" && u.role !== "mod") return <NoAccess />;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <nav className="text-sm text-ink-400 mb-3">
        <Link to="/" className="hover:text-brand-500">论坛</Link>
        <span className="mx-2">/</span>
        <span className="text-ink-100">论坛管理</span>
      </nav>
      <h1 className="text-2xl font-bold text-ink-50 mb-1">论坛管理</h1>
      <p className="text-ink-300 text-sm mb-6">当前身份：<span className="text-brand-500 font-medium">负责人</span> · @{u.username}</p>

      <div className="flex items-center gap-1 border-b border-brand-500/15 mb-6">
        <TabBtn active={tab === "users"} onClick={() => setTab("users")}>用户</TabBtn>
        <TabBtn active={tab === "groups"} onClick={() => setTab("groups")}>用户组</TabBtn>
        <TabBtn active={tab === "categories"} onClick={() => setTab("categories")}>分类</TabBtn>
      </div>

      {tab === "users" && <UsersPanel />}
      {tab === "groups" && <GroupsPanel />}
      {tab === "categories" && <CategoriesPanel />}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm transition border-b-2 -mb-px ${active ? "text-brand-500 border-brand-500 font-medium" : "text-ink-300 border-transparent hover:text-ink-100"}`}>
      {children}
    </button>
  );
}

function NoAccess() {
  return (
    <div className="max-w-md mx-auto px-6 py-16 text-center">
      <div className="card p-8">
        <h1 className="text-lg font-semibold text-ink-50 mb-2">无权访问</h1>
        <p className="text-ink-300 text-sm mb-5">仅论坛负责人可访问此页面</p>
        <Link to="/" className="btn-ghost text-sm px-4 py-2">返回论坛</Link>
      </div>
    </div>
  );
}

function UsersPanel() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const list = useQuery({
    queryKey: ["forum-admin-users", { q, role }],
    queryFn: () => api<{ users: ForumAdminUser[]; total: number }>(
      `/api/forum/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(role ? { role } : {}) }).toString()}`,
    ),
  });
  const setRoleMut = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) =>
      api(`/api/forum/admin/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forum-admin-users"] }),
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input className="input flex-1 max-w-sm" placeholder="按用户名 / 昵称 / GitHub 搜…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="w-40">
          <Select value={role} onChange={setRole} options={[
            { value: "", label: "全部角色" },
            { value: "admin", label: "负责人" },
            { value: "teacher", label: "老师" },
            { value: "mod", label: "协管" },
            { value: "member", label: "成员" },
            { value: "banned", label: "已封禁" },
          ]} />
        </div>
        <div className="text-sm text-ink-400 ml-auto">{list.data?.total ?? "—"} 用户</div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm px-4 py-2">新建老师账号</button>
      </div>
      {createOpen && <CreateTeacherDialog onClose={() => { setCreateOpen(false); qc.invalidateQueries({ queryKey: ["forum-admin-users"] }); }} />}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900/40 text-ink-300 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">用户</th>
              <th className="text-left px-4 py-3">角色</th>
              <th className="text-left px-4 py-3">GitHub</th>
              <th className="text-left px-4 py-3">来源</th>
              <th className="text-right px-4 py-3">活跃</th>
              <th className="text-right px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-500/10">
            {list.data?.users.map((u) => (
              <tr key={u.id} className="hover:bg-brand-500/5">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar user={u} size={28} />
                    <Link to={`/u/${u.username}`} className="text-ink-100 hover:text-brand-500">
                      {u.display_name ?? u.username}
                    </Link>
                    <span className="text-xs text-ink-400">@{u.username}</span>
                  </div>
                </td>
                <td className="px-4 py-2">
                  <RoleBadge role={u.role} />
                </td>
                <td className="px-4 py-2 text-ink-300 text-xs">
                  {u.github_login ? `@${u.github_login}` : "—"}
                </td>
                <td className="px-4 py-2 text-xs text-ink-400">
                  {u.legacy_mbbs_id ? "老论坛迁入" : u.github_login ? "GitHub 登录" : "账号密码"}
                </td>
                <td className="px-4 py-2 text-xs text-ink-400 text-right whitespace-nowrap">
                  {u.last_seen_at ? fmtRelative(u.last_seen_at) : "—"}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <div className="inline-flex gap-1">
                    {u.role !== "admin" && (
                      <button onClick={async () => {
                        const ok = await confirm({ title: "提为负责人", body: `授予 ${u.display_name ?? u.username} 负责人权限？`, confirmText: "授予" });
                        if (ok) setRoleMut.mutate({ id: u.id, role: "admin" });
                      }} className="text-xs px-2 py-1 rounded border border-brand-500/40 text-brand-500 hover:bg-brand-500/10">提为负责人</button>
                    )}
                    {u.role !== "teacher" && u.role !== "admin" && (
                      <button onClick={async () => {
                        const ok = await confirm({ title: "设为老师", body: `授予 ${u.display_name ?? u.username} 老师身份（可看全部状态，不可改设置）？`, confirmText: "授予" });
                        if (ok) setRoleMut.mutate({ id: u.id, role: "teacher" });
                      }} className="text-xs px-2 py-1 rounded border border-violet-500/40 text-violet-400 hover:bg-violet-500/10">设为老师</button>
                    )}
                    {u.role === "admin" && (
                      <button onClick={async () => {
                        const ok = await confirm({ title: "降为成员", body: `撤销 ${u.display_name ?? u.username} 的负责人权限？`, confirmText: "降级", variant: "danger" });
                        if (ok) setRoleMut.mutate({ id: u.id, role: "member" });
                      }} className="text-xs px-2 py-1 rounded border border-ink-700/60 text-ink-300 hover:bg-ink-800/60">降为成员</button>
                    )}
                    {u.role !== "banned" && (
                      <button onClick={async () => {
                        const ok = await confirm({ title: "封禁用户", body: `封禁 ${u.display_name ?? u.username}？被封禁后该用户无法登录或发帖。`, confirmText: "封禁", variant: "danger" });
                        if (ok) setRoleMut.mutate({ id: u.id, role: "banned" });
                      }} className="text-xs px-2 py-1 rounded border border-rose-500/40 text-rose-500 hover:bg-rose-500/10">封禁</button>
                    )}
                    {u.role === "banned" && (
                      <button onClick={() => setRoleMut.mutate({ id: u.id, role: "member" })}
                        className="text-xs px-2 py-1 rounded border border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10">解封</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateTeacherDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ username: "", display_name: "", email: "", password: "" });
  const [showPwd, setShowPwd] = useState(false);
  const submit = useMutation({
    mutationFn: () => api<{ ok: boolean; user_id: number; username: string }>(`/api/forum/admin/teachers`, { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => onClose(),
  });
  const generatePwd = () => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let p = "";
    for (let i = 0; i < 12; i++) p += chars[Math.floor(Math.random() * chars.length)];
    setForm({ ...form, password: p });
    setShowPwd(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 backdrop-blur-sm">
      <div className="card p-6 max-w-md w-full mx-4 bg-ink-950">
        <h3 className="text-lg font-semibold text-ink-50 mb-1">新建老师账号</h3>
        <p className="text-xs text-ink-400 mb-5">老师可看到全部组织状态，但不能改设置或发管理操作</p>
        <form onSubmit={(e) => { e.preventDefault(); submit.mutate(); }} className="space-y-3">
          <div>
            <label className="label text-sm">用户名 · 2-32 字符</label>
            <input autoFocus className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required minLength={2} maxLength={32} placeholder="如 teacher-zhao" />
          </div>
          <div>
            <label className="label text-sm">显示名</label>
            <input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="如 赵老师" />
          </div>
          <div>
            <label className="label text-sm">邮箱（可选）</label>
            <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label text-sm flex items-center justify-between">
              <span>初始密码 · 至少 6 位</span>
              <button type="button" onClick={generatePwd} className="text-xs text-brand-500 hover:underline">随机生成</button>
            </label>
            <div className="flex gap-2">
              <input type={showPwd ? "text" : "password"} className="input flex-1 font-mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
              <button type="button" onClick={() => setShowPwd(!showPwd)} className="btn-ghost text-xs px-3">{showPwd ? "隐" : "显"}</button>
            </div>
            {form.password && showPwd && (
              <p className="text-xs text-amber-500 mt-1.5">把账号 + 密码发给老师后让他立即修改</p>
            )}
          </div>
          {submit.error && <div className="text-rose-500 text-sm">{(submit.error as Error).message}</div>}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">取消</button>
            <button type="submit" disabled={submit.isPending || !form.username || form.password.length < 6} className="btn-primary text-sm px-5 py-2 disabled:opacity-50">
              {submit.isPending ? "创建中…" : "创建账号"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") return <span className="tag-blue text-[10px]">负责人</span>;
  if (role === "mod") return <span className="tag-yellow text-[10px]">协管</span>;
  if (role === "teacher") return <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-violet-500/15 text-violet-400 border border-violet-500/30">老师</span>;
  if (role === "banned") return <span className="tag-red text-[10px]">已封禁</span>;
  return <span className="tag-gray text-[10px]">成员</span>;
}

type PermissionDef = { key: string; label: string; category: string; enforced: boolean };

function GroupsPanel() {
  const list = useQuery({ queryKey: ["forum-groups"], queryFn: () => api<{ groups: Group[] }>("/api/forum/groups") });
  const [editing, setEditing] = useState<Group | null>(null);
  return (
    <div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.data?.groups.map((g) => (
          <div key={g.id} className="card p-5 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-ink-50">{g.name}</div>
              {g.is_default ? <span className="tag-gray text-[10px]">默认</span> : null}
            </div>
            {g.description && <div className="text-xs text-ink-400 mb-3">{g.description}</div>}
            <div className="flex items-center gap-4 text-xs text-ink-300 mb-4">
              <div>{g.member_count} 成员</div>
              <div>{g.permission_count} 权限</div>
            </div>
            <button onClick={() => setEditing(g)} className="btn-ghost text-xs px-3 py-1.5 mt-auto self-start">配置权限</button>
          </div>
        ))}
      </div>
      {editing && <GroupPermsDialog group={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GroupPermsDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["forum-permissions"], queryFn: () => api<{ permissions: PermissionDef[] }>("/api/forum/permissions") });
  const detail = useQuery({ queryKey: ["forum-group", group.id], queryFn: () => api<{ permissions: string[] }>(`/api/forum/groups/${group.id}`) });
  const [selected, setSelected] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (detail.data && selected === null) setSelected(new Set(detail.data.permissions));
  }, [detail.data, selected]);

  const save = useMutation({
    mutationFn: () => api(`/api/forum/groups/${group.id}/permissions`, { method: "PUT", body: JSON.stringify({ permissions: Array.from(selected ?? []) }) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["forum-groups"] });
      await qc.invalidateQueries({ queryKey: ["forum-group", group.id] });
      onClose();
    },
  });

  const perms = catalog.data?.permissions ?? [];
  const categories = perms.reduce<string[]>((acc, p) => (acc.includes(p.category) ? acc : [...acc, p.category]), []);
  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const loading = catalog.isLoading || detail.isLoading || selected === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 backdrop-blur-sm p-4">
      <div className="card p-6 max-w-lg w-full bg-ink-950 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-ink-50 mb-1">配置权限 · {group.name}</h3>
        <p className="text-xs text-ink-400 mb-4">勾选该用户组拥有的权限。当前仅「发主题 / 回帖」实际生效，其余为预留位，暂不影响行为。</p>
        {loading ? (
          <div className="text-ink-400 text-sm py-8 text-center">载入中…</div>
        ) : (
          <div className="space-y-4">
            {categories.map((cat) => (
              <div key={cat}>
                <div className="text-xs font-semibold text-ink-300 uppercase tracking-wider mb-2">{cat}</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {perms.filter((p) => p.category === cat).map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-sm text-ink-100 cursor-pointer select-none">
                      <input type="checkbox" className="accent-brand-500 w-4 h-4" checked={selected!.has(p.key)} onChange={() => toggle(p.key)} />
                      <span>{p.label}</span>
                      {p.enforced ? <span className="tag-blue text-[10px]">生效</span> : <span className="tag-gray text-[10px]">预留</span>}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {save.error && <div className="text-rose-500 text-sm mt-3">{(save.error as Error).message}</div>}
        <div className="flex items-center justify-end gap-3 pt-5">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">取消</button>
          <button type="button" onClick={() => save.mutate()} disabled={loading || save.isPending} className="btn-primary text-sm px-5 py-2 disabled:opacity-50">
            {save.isPending ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoriesPanel() {
  const list = useQuery({ queryKey: ["forum-cats-all"], queryFn: () => api<{ categories: Category[] }>("/api/forum/categories?include_legacy=1") });
  const newCats = (list.data?.categories ?? []).filter((c) => !c.is_legacy);
  const legacyCats = (list.data?.categories ?? []).filter((c) => c.is_legacy);
  return (
    <div className="space-y-6">
      <section>
        <div className="text-sm font-semibold text-ink-100 mb-3">当前分类 (AI Native)</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {newCats.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="font-medium text-ink-50">{c.name}</div>
              <div className="text-xs text-ink-400 mt-1 line-clamp-2">{c.description}</div>
              <div className="text-xs text-brand-500 mt-2">{c.thread_count} 篇</div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <div className="text-sm font-semibold text-ink-100 mb-3">归档分类 (只读)</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {legacyCats.map((c) => (
            <div key={c.id} className="card p-3 opacity-70">
              <div className="text-sm text-ink-100">{c.name}</div>
              <div className="text-xs text-ink-400 mt-0.5">{c.thread_count} 篇</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
