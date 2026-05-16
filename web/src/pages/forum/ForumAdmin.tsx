import { Link, Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
            { value: "mod", label: "协管" },
            { value: "member", label: "成员" },
            { value: "banned", label: "已封禁" },
          ]} />
        </div>
        <div className="text-sm text-ink-400 ml-auto">{list.data?.total ?? "—"} 用户</div>
      </div>
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

function RoleBadge({ role }: { role: string }) {
  if (role === "admin") return <span className="tag-blue text-[10px]">负责人</span>;
  if (role === "mod") return <span className="tag-yellow text-[10px]">协管</span>;
  if (role === "banned") return <span className="tag-red text-[10px]">已封禁</span>;
  return <span className="tag-gray text-[10px]">成员</span>;
}

function GroupsPanel() {
  const list = useQuery({ queryKey: ["forum-groups"], queryFn: () => api<{ groups: Group[] }>("/api/forum/groups") });
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {list.data?.groups.map((g) => (
        <div key={g.id} className="card p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-ink-50">{g.name}</div>
            {g.is_default ? <span className="tag-gray text-[10px]">默认</span> : null}
          </div>
          {g.description && <div className="text-xs text-ink-400 mb-3">{g.description}</div>}
          <div className="flex items-center gap-4 text-xs text-ink-300">
            <div>{g.member_count} 成员</div>
            <div>{g.permission_count} 权限</div>
          </div>
        </div>
      ))}
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
